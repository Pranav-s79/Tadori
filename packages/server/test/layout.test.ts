import { afterEach, describe, expect, it, vi } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import { CURRENT_LAYOUT_VERSION } from "@tadori/store";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { LayoutDto } from "../src/types.js";
import { buildTestDb, cleanupTestDb, type TestDb } from "./fixtures/buildTestDb.js";

let testDb: TestDb | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

interface StoredLayoutRow {
  node_id: number;
  x: number;
  y: number;
  z: number;
  pinned: number;
  anchor_group: string | null;
  layout_version: number;
  last_snapshot_id: number | null;
  updated_at: string;
}

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

function storedPackageRows(): StoredLayoutRow[] {
  if (!testDb) {
    throw new Error("layout test database is not initialized");
  }
  return testDb.db
    .prepare(
      `SELECT node_id, x, y, z, pinned, anchor_group, layout_version,
              last_snapshot_id, updated_at
       FROM layout_positions
       WHERE repo_id = ? AND abstraction_level = 'package' AND view_key = 'base'
       ORDER BY node_id`
    )
    .all(app!.graphState.current().repoId) as StoredLayoutRow[];
}

describe("layout route", () => {
  it("materializes the package layout on first request and returns the public DTO", async () => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as LayoutDto;
    expect(body.layoutVersion).toBe(CURRENT_LAYOUT_VERSION);
    expect(body.positions.length).toBeGreaterThan(0);
    expect(body.positions.every((position) => position.z === 0)).toBe(true);
    for (const position of body.positions) {
      expect(position).not.toHaveProperty("anchorGroup");
    }
    expect(storedPackageRows()).toHaveLength(body.positions.length);
  });

  it("returns ordered package, file, and symbol representatives", async () => {
    const instance = await setup();
    const service = instance.graphState.current();
    const expectedByLevel = {
      package: service.graph.nodes.filter((node) => node.kind === "package"),
      file: service.graph.nodes.filter((node) => node.kind === "file"),
      symbol: service.graph.nodes.filter((node) => node.kind !== "package" && node.kind !== "file")
    };
    for (const level of ["package", "file", "symbol"] as const) {
      const response = await instance.inject({ method: "GET", url: `/api/v1/layout?level=${level}` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as LayoutDto;
      expect(body.positions.map((position) => position.entityKey)).toEqual(
        expectedByLevel[level].map((node) => node.entityKey).sort()
      );
    }
  });

  it("captures GraphState.current exactly once for a coherent request graph", async () => {
    const instance = await setup();
    const current = vi.spyOn(instance.graphState, "current");
    const response = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });
    expect(response.statusCode).toBe(200);
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("returns byte-identical JSON and leaves persisted rows unchanged on reload", async () => {
    const instance = await setup();
    const first = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });
    expect(first.statusCode).toBe(200);
    const rowsAfterFirstRequest = storedPackageRows();

    const second = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });
    expect(second.statusCode).toBe(200);
    const rowsAfterSecondRequest = storedPackageRows();

    expect(second.body).toBe(first.body);
    expect(rowsAfterSecondRequest).toEqual(rowsAfterFirstRequest);
    expect(rowsAfterSecondRequest.map((row) => row.updated_at)).toEqual(
      rowsAfterFirstRequest.map((row) => row.updated_at)
    );
  });

  it.each([
    ["/api/v1/layout?level=repository", "bad_level"],
    ["/api/v1/layout?level=package&viewKey=alternate", "bad_view_key"]
  ])("rejects unsupported layout query %s", async (url, code) => {
    const instance = await setup();
    const response = await instance.inject({ method: "GET", url });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(code);
  });

  it("returns an honest empty layout for a valid level with no matching nodes", async () => {
    const instance = await setup();
    const service = instance.graphState.current();
    testDb!.db
      .prepare("DELETE FROM snapshot_edges WHERE snapshot_id = ?")
      .run(service.snapshot.id);
    testDb!.db
      .prepare("DELETE FROM snapshot_nodes WHERE snapshot_id = ?")
      .run(service.snapshot.id);
    service.graph.nodes.splice(0, service.graph.nodes.length);
    service.graph.edges.splice(0, service.graph.edges.length);

    const response = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ positions: [], layoutVersion: CURRENT_LAYOUT_VERSION });
  });

  it("does not leak persisted positions for entities outside the active snapshot", async () => {
    const instance = await setup();
    const first = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });
    expect(first.statusCode).toBe(200);

    const service = instance.graphState.current();
    const staleEntityKey = "f".repeat(64);
    const staleNode = testDb!.db
      .prepare(
        `INSERT INTO node_entities
           (repo_id, entity_key, canonical_identity, collision_index, kind, qualified_name)
         VALUES (?, ?, ?, 0, 'package', ?)`
      )
      .run(service.repoId, staleEntityKey, "node|package|stale", "stale");
    testDb!.db
      .prepare(
        `INSERT INTO layout_positions
           (repo_id, abstraction_level, view_key, node_id, x, y, z, pinned,
            anchor_group, layout_version, last_snapshot_id)
         VALUES (?, 'package', 'base', ?, 999, 999, 0, 0, NULL, ?, ?)`
      )
      .run(service.repoId, Number(staleNode.lastInsertRowid), CURRENT_LAYOUT_VERSION, service.snapshot.id);

    const response = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as LayoutDto;
    expect(body.positions.some((position) => position.entityKey === staleEntityKey)).toBe(false);
    expect(body.positions.some((position) => position.x === 999 && position.y === 999)).toBe(false);
  });

  it("sanitizes layout engine failures", async () => {
    const instance = await setup();
    testDb!.db.exec(
      `CREATE TRIGGER test_reject_layout_insert
       BEFORE INSERT ON layout_positions
       BEGIN
         SELECT RAISE(ABORT, 'sensitive layout failure detail');
       END`
    );

    const response = await instance.inject({ method: "GET", url: "/api/v1/layout?level=package" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "layout_engine_error",
      code: "layout_engine_error"
    });
    expect(response.body).not.toContain("sensitive layout failure detail");
    expect(response.body).not.toContain(testDb!.repoRoot);
  });
});
