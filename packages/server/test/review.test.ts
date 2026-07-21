import { afterEach, describe, expect, it } from "vitest";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { ReviewDiffDto } from "../src/types.js";
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

describe("review diff route", () => {
  it("diff between the fixture DB's single snapshot and itself returns empty adds/removes/edges", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/review/diff?${new URLSearchParams({
        base: String(testDb.snapshotId),
        head: String(testDb.snapshotId)
      }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ReviewDiffDto;
    expect(body.nodesAdded).toEqual([]);
    expect(body.nodesRemoved).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.presentation).toBe("raw");
  });

  it("returns 400 bad_snapshot_ref when base/head are missing", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({ method: "GET", url: "/api/v1/review/diff" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_snapshot_ref");
  });

  it("returns 404 unknown_snapshot for a nonexistent snapshot id", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/review/diff?${new URLSearchParams({
        base: String(testDb.snapshotId),
        head: "999999"
      }).toString()}`
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("unknown_snapshot");
  });

  it("returns 501 coalesced_unsupported for coalesce=coalesced (never a silent raw substitution)", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/review/diff?${new URLSearchParams({
        base: String(testDb.snapshotId),
        head: String(testDb.snapshotId),
        coalesce: "coalesced"
      }).toString()}`
    });
    expect(response.statusCode).toBe(501);
    expect(response.json().code).toBe("coalesced_unsupported");
  });

  it("returns 400 bad_page for an invalid cursor", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/review/diff?${new URLSearchParams({
        base: String(testDb.snapshotId),
        head: String(testDb.snapshotId),
        cursor: "-5"
      }).toString()}`
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_page");
  });

  it("returns 400 bad_comparison_kind for an unknown kind", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/review/diff?${new URLSearchParams({
        base: String(testDb.snapshotId),
        head: String(testDb.snapshotId),
        kind: "bogus"
      }).toString()}`
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("bad_comparison_kind");
  });

  it("returns 501 for working_tree and staged kinds (honest, never a silent snapshot diff)", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    for (const kind of ["working_tree", "staged"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/v1/review/diff?${new URLSearchParams({ kind }).toString()}`
      });
      expect(response.statusCode).toBe(501);
      expect(response.json().code).toBe(`${kind}_comparison_unimplemented`);
    }
  });

  it("kind=snapshot is the default and behaves as before", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/review/diff?${new URLSearchParams({
        base: String(testDb.snapshotId),
        head: String(testDb.snapshotId),
        kind: "snapshot"
      }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as ReviewDiffDto).presentation).toBe("raw");
  });

  it("includes pagination fields; an empty diff reports zero omitted and a null cursor", async () => {
    testDb = buildTestDb();
    refresh = await ConcurrentRefreshController.start(testDb.db, testDb.repoRoot);
    app = await createServerApp({ db: testDb.db, repoRoot: testDb.repoRoot, refresh });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/review/diff?${new URLSearchParams({
        base: String(testDb.snapshotId),
        head: String(testDb.snapshotId)
      }).toString()}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ReviewDiffDto;
    expect(body.nodesAddedOmitted).toBe(0);
    expect(body.nodesRemovedOmitted).toBe(0);
    expect(body.edgesOmitted).toBe(0);
    expect(body.nextCursor).toBeNull();
  });
});
