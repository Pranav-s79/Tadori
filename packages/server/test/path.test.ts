import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController, EventLog, GraphService, TadoriTools } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  if (refresh) {
    await refresh.stop();
    refresh = null;
  }
  if (testDb) {
    cleanupTestDb(testDb);
    testDb = null;
  }
});

async function setup(): Promise<FastifyInstance> {
  testDb = buildTestDb();
  refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
  app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
  return app;
}

interface PathBody {
  status: string;
  from: unknown;
  to: unknown;
  paths: { nodes: { entityKey: string }[]; edges: unknown[] }[];
  nearestApproach: unknown[];
  message: string;
}

describe("path route (full path-tool output)", () => {
  it("finds a known two-hop fixture path with status ok", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/path?${new URLSearchParams({
        from: "src/runner.ts.Runner.execute",
        to: "src/strategy.ts.Strategy.run"
      }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PathBody;
    expect(body.status).toBe("ok");
    expect(body.paths.length).toBeGreaterThanOrEqual(1);
    expect(body.paths[0]!.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("returns status no_path for a resolvable-but-unreachable pair", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/path?${new URLSearchParams({
        from: "src/internal/secret.ts.readSecret",
        to: "src/math.ts.factorial"
      }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PathBody;
    expect(body.status).toBe("no_path");
    expect(body.paths).toEqual([]);
  });

  it("returns status not_found (200, not 404) for an unresolvable endpoint", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/path?${new URLSearchParams({ from: "does.not.exist", to: "also.missing" }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as PathBody;
    expect(body.status).toBe("not_found");
  });

  it("still 404s when the from/to query params are absent entirely", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/path" });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("unknown_endpoint");
  });

  it("PARITY: the HTTP body equals the in-process MCP path tool for the same query", async () => {
    const instance = await setup();
    // In-process tool call over the same served snapshot.
    const service = GraphService.open(testDb!.db, testDb!.repoRoot, refresh!, "working_tree");
    const eventLog = new EventLog(testDb!.db, service, "parity-test", "path parity");
    const tools = new TadoriTools(service, eventLog);
    const toolOutput = tools.path({
      from: "src/runner.ts.Runner.execute",
      to: "src/strategy.ts.Strategy.run"
    }) as unknown as Record<string, unknown>;

    const response = await instance.inject({
      method: "GET",
      url: `/api/v1/path?${new URLSearchParams({
        from: "src/runner.ts.Runner.execute",
        to: "src/strategy.ts.Strategy.run"
      }).toString()}`
    });
    const httpOutput = response.json() as Record<string, unknown>;

    // context carries wall-clock/session-independent fields; compare the rest.
    const strip = (o: Record<string, unknown>): Record<string, unknown> => {
      const { context: _context, ...rest } = o;
      return rest;
    };
    expect(strip(httpOutput)).toEqual(strip(toolOutput));
  });
});
