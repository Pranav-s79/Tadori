import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { BehaviorStory } from "../src/types.js";
import type { ToolNode } from "@tadori/mcp";
import { buildFixtureTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

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

/** Boots a server over the express-routes fixture (has route + routes_to). */
async function setup(): Promise<FastifyInstance> {
  testDb = buildFixtureTestDb("02-express-routes");
  refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
  app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
  return app;
}

/** The entityKey of the first route node whose displayName matches, from /routes. */
async function routeKey(instance: FastifyInstance, displayNameStartsWith: string): Promise<string> {
  const response = await instance.inject({ method: "GET", url: "/api/v1/routes" });
  const body = response.json() as { routes: ToolNode[] };
  const node = body.routes.find((r) => r.displayName.startsWith(displayNameStartsWith));
  if (!node) {
    throw new Error(
      `no route starting with ${displayNameStartsWith}; got ${body.routes.map((r) => r.displayName).join(", ")}`
    );
  }
  return node.entityKey;
}

/** A non-route entityKey (a function) from /nodes (a Page with `items`). */
async function anyFunctionKey(instance: FastifyInstance): Promise<string> {
  const response = await instance.inject({ method: "GET", url: "/api/v1/nodes?kind=function&limit=200" });
  const body = response.json() as { items: ToolNode[] };
  const node = body.items.find((n) => n.kind === "function");
  if (!node) {
    throw new Error("no function node in fixture");
  }
  return node.entityKey;
}

describe("GET /api/v1/story/route/:entityKey", () => {
  it("returns a static behavior story for a resolvable route (never a runtime claim)", async () => {
    const instance = await setup();
    const key = await routeKey(instance, "GET /users/:id");
    const response = await instance.inject({ method: "GET", url: `/api/v1/story/route/${key}` });
    expect(response.statusCode).toBe(200);

    const story = response.json() as BehaviorStory;
    expect(story.runtimeObserved).toBe(false);
    expect(story.branches).toEqual([]);
    expect(story.entryPoint).toBe(key);
    expect(story.id).toBe(`story:route:${key}:${story.snapshotId}`);
    expect(story.title).toBe("GET /users/:id");
    // The route routes_to a compiler/certain/resolved handler. The handler is
    // resolved; because it also has an incoming tests edge, the honest label is
    // "test-backed" (more informative than the default statically-resolved).
    const first = story.steps[0];
    expect(first).toBeDefined();
    expect(first?.resolved).toBe(true);
    expect(["statically-resolved", "test-backed"]).toContain(first?.label);
    // Every transition carries a real provenance origin.
    for (const t of story.transitions) {
      expect(["compiler", "heuristic", "git", "doc", "human", "llm"]).toContain(t.origin);
    }
  });

  it("surfaces an ambiguous (heuristic/partial) route link as an ambiguous step, not upgraded", async () => {
    const instance = await setup();
    // The computed admin path routes_to via heuristic/likely/partial.
    const key = await routeKey(instance, "POST <computed");
    const response = await instance.inject({ method: "GET", url: `/api/v1/story/route/${key}` });
    expect(response.statusCode).toBe(200);
    const story = response.json() as BehaviorStory;
    // The direct heuristic/partial route link is surfaced as an ambiguous step,
    // never upgraded. (Downstream compiler-resolved calls may still appear as
    // their own statically-resolved steps — that is honest, not a contradiction.)
    const directStep = story.steps.find((s) =>
      story.transitions.some((t) => t.from === story.entryPoint && t.to === s.entityKey && t.relation === "routes_to")
    );
    expect(directStep?.label).toBe("ambiguous");
    expect(["inferred", "likely", "certain"]).toContain(story.confidence);
  });

  it("is deterministic: two derivations of the same route are byte-identical", async () => {
    const instance = await setup();
    const key = await routeKey(instance, "GET /users/:id");
    const a = await instance.inject({ method: "GET", url: `/api/v1/story/route/${key}` });
    const b = await instance.inject({ method: "GET", url: `/api/v1/story/route/${key}` });
    expect(a.body).toBe(b.body);
  });

  it("404 unknown_entity for a nonexistent key", async () => {
    const instance = await setup();
    const response = await instance.inject({
      method: "GET",
      url: "/api/v1/story/route/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("unknown_entity");
  });

  it("400 not_a_route when the entity exists but is not a route node", async () => {
    const instance = await setup();
    const key = await anyFunctionKey(instance);
    const response = await instance.inject({ method: "GET", url: `/api/v1/story/route/${key}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("not_a_route");
  });
});
