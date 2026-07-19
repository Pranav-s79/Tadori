import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findDanglingEndpoints, openDatabase, runMigrations, type Database } from "@tadori/store";
import { indexRepositoryIntoStore } from "@tadori/indexer";
import { runServe } from "../src/serve.js";

const FIXTURE_REPO_ROOT = fileURLToPath(
  new URL("../../fixtures/01-core-symbols/repo", import.meta.url)
);

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function copyFixtureRepo(prefix = "tadori-cli-snap-"): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(tempDir);
  const repoRoot = path.join(tempDir, "repo");
  cpSync(FIXTURE_REPO_ROOT, repoRoot, { recursive: true });
  return repoRoot;
}

function openRepoDb(repoRoot: string): Database {
  const dbPath = path.join(repoRoot, ".tadori", "tadori.sqlite");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  runMigrations(db);
  return db;
}

/** Builds a real, valid snapshot in the repo's own DB and returns its id. */
function buildValidSnapshot(repoRoot: string): number {
  const db = openRepoDb(repoRoot);
  try {
    const result = indexRepositoryIntoStore(db, repoRoot, { kind: "working_tree" });
    return result.snapshotId;
  } finally {
    db.close();
  }
}

async function waitFor<T>(check: () => T | null, timeoutMs = 10_000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const result = check();
    if (result !== null) {
      return result;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("--snapshot hardening (§8/§10/§11 step 4)", () => {
  it("(a) a nonexistent id exits 3 with the exact 'does not exist' message", async () => {
    const repoRoot = copyFixtureRepo();
    const stderrLines: string[] = [];

    const exitCode = await runServe([repoRoot, "--snapshot", "999999"], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(3);
    expect(stderrLines.join("")).toBe("Snapshot #999999 does not exist.\n");
  });

  it("(b) an id belonging to a different repo in the same DB is not found for this repo", async () => {
    const repoA = copyFixtureRepo("tadori-cli-snap-a-");
    const repoB = copyFixtureRepo("tadori-cli-snap-b-");
    buildValidSnapshot(repoA);
    const db = openRepoDb(repoA);
    let idInB: number;
    try {
      idInB = indexRepositoryIntoStore(db, repoB, { kind: "working_tree" }).snapshotId;
    } finally {
      db.close();
    }
    const stderrLines: string[] = [];

    const exitCode = await runServe([repoA, "--snapshot", String(idInB)], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(3);
    expect(stderrLines.join("")).toBe(`Snapshot #${idInB} does not exist.\n`);
  });

  it("serves the requested snapshot rather than the newer active snapshot", async () => {
    const repoRoot = copyFixtureRepo();
    const requestedSnapshotId = buildValidSnapshot(repoRoot);
    writeFileSync(path.join(repoRoot, "newer.ts"), "export const newer = true;\n");
    const activeSnapshotId = buildValidSnapshot(repoRoot);
    expect(activeSnapshotId).not.toBe(requestedSnapshotId);

    const controller = new AbortController();
    const stdoutLines: string[] = [];
    const runPromise = runServe(
      [repoRoot, "--snapshot", String(requestedSnapshotId), "--port", "0"],
      {
        openBrowser: async () => undefined,
        signal: controller.signal,
        stdout: (text) => stdoutLines.push(text),
        stderr: () => undefined
      }
    );
    const url = await waitFor(() => {
      const match = stdoutLines.join("").match(/URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      return match ? match[1] : null;
    });
    expect(stdoutLines.join("")).toContain(`Snapshot:  #${requestedSnapshotId}`);

    const response = await fetch(`${url}api/v1/snapshot`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { context: { snapshotId: number } };
    expect(body.context.snapshotId).toBe(requestedSnapshotId);

    writeFileSync(path.join(repoRoot, "after_pin.ts"), "export const afterPin = true;\n");
    let refreshedSnapshotId: number | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const refreshResponse = await fetch(`${url}api/v1/refresh`);
      const refreshState = (await refreshResponse.json()) as { snapshotId: number | null };
      if (refreshState.snapshotId !== null && refreshState.snapshotId !== activeSnapshotId) {
        refreshedSnapshotId = refreshState.snapshotId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(refreshedSnapshotId).not.toBeNull();
    const afterRefreshResponse = await fetch(`${url}api/v1/snapshot`);
    const afterRefresh = (await afterRefreshResponse.json()) as { context: { snapshotId: number } };
    expect(afterRefresh.context.snapshotId).toBe(requestedSnapshotId);

    controller.abort();
    expect(await runPromise).toBe(0);
  });

  it("(c) a present-but-dangling-endpoint-invalid id exits 3 with the 'failed validation' message", async () => {
    // ASSUMPTION: a genuinely-invalid-but-present snapshot row cannot be built
    // through public APIs (insertSnapshotGraph validates endpoints), so this
    // test forces the condition with a direct SQL mutation in setup only
    // (permitted by §11 step 4c; never done in production code): delete one
    // snapshot_nodes membership row that an edge in the snapshot references,
    // which makes findDanglingEndpoints report a missing endpoint.
    const repoRoot = copyFixtureRepo();
    const snapshotId = buildValidSnapshot(repoRoot);

    const db = openRepoDb(repoRoot);
    let danglingCount: number;
    try {
      // Find a node that participates as an edge endpoint in this snapshot, then
      // drop its membership so that edge dangles.
      const victim = db
        .prepare(
          `SELECT sn.node_id AS node_id
           FROM snapshot_nodes AS sn
           JOIN snapshot_edges AS se ON se.snapshot_id = sn.snapshot_id
           JOIN edge_entities AS ee ON ee.id = se.edge_id
           WHERE sn.snapshot_id = ?
             AND (ee.src_node_id = sn.node_id OR ee.dst_node_id = sn.node_id)
           LIMIT 1`
        )
        .get(snapshotId) as { node_id: number } | undefined;
      expect(victim, "fixture must have at least one edge with an endpoint node").toBeDefined();
      db.prepare("DELETE FROM snapshot_nodes WHERE snapshot_id = ? AND node_id = ?").run(
        snapshotId,
        victim!.node_id
      );
      danglingCount = findDanglingEndpoints(db, snapshotId).length;
      expect(danglingCount).toBeGreaterThan(0);
    } finally {
      db.close();
    }

    const stderrLines: string[] = [];
    const exitCode = await runServe([repoRoot, "--snapshot", String(snapshotId)], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(3);
    expect(stderrLines.join("")).toBe(
      `Snapshot #${snapshotId} failed validation: ${danglingCount} dangling endpoint(s).\n`
    );
  });

  it("rejects a requested snapshot when the database has a foreign-key violation", async () => {
    const repoRoot = copyFixtureRepo();
    const snapshotId = buildValidSnapshot(repoRoot);
    const db = openRepoDb(repoRoot);
    try {
      const victim = db.prepare("SELECT file_id FROM snapshot_files WHERE snapshot_id = ? LIMIT 1")
        .get(snapshotId) as { file_id: number } | undefined;
      expect(victim).toBeDefined();
      db.pragma("foreign_keys = OFF");
      db.prepare("DELETE FROM file_entities WHERE id = ?").run(victim!.file_id);
      db.pragma("foreign_keys = ON");
    } finally {
      db.close();
    }

    const stderrLines: string[] = [];
    const exitCode = await runServe([repoRoot, "--snapshot", String(snapshotId)], {
      openBrowser: async () => undefined,
      stderr: (text) => stderrLines.push(text),
      stdout: () => undefined
    });

    expect(exitCode).toBe(3);
    expect(stderrLines.join("")).toBe(
      `Snapshot #${snapshotId} failed validation: 1 foreign-key violation(s).\n`
    );
  });
});

describe("--reindex under concurrent modification (§8 reindex note)", () => {
  it("reindex-then-serve reflects a modification made before the reindex (no missed change)", async () => {
    // §8: indexRepositoryIntoStore is not pausable mid-flight, so the honest
    // verification is the sequential outcome — a modification present at
    // reindex time is captured in the served snapshot.
    const repoRoot = copyFixtureRepo();
    const baselineSnapshotId = buildValidSnapshot(repoRoot);
    const markerFile = path.join(repoRoot, "reindex_marker.ts");
    writeFileSync(markerFile, "export function reindexMarker(): number { return 42; }\n");

    const controller = new AbortController();
    const stdoutLines: string[] = [];

    const runPromise = runServe([repoRoot, "--port", "0", "--reindex"], {
      openBrowser: async () => undefined,
      signal: controller.signal,
      stdout: (text) => stdoutLines.push(text),
      stderr: () => undefined
    });

    const url = await waitFor(() => {
      const match = stdoutLines.join("").match(/URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/);
      return match ? match[1] : null;
    });
    try {
      expect(stdoutLines.join("")).toContain("(rebuilt)");

      const snapshotResponse = await fetch(`${url}api/v1/snapshot`);
      expect(snapshotResponse.status).toBe(200);
      const snapshotBody = (await snapshotResponse.json()) as { context: { snapshotId: number } };
      expect(snapshotBody.context.snapshotId).not.toBe(baselineSnapshotId);

      const searchResponse = await fetch(`${url}api/v1/search?q=reindexMarker`);
      expect(searchResponse.status).toBe(200);
      const searchBody = (await searchResponse.json()) as {
        total: number;
        matches: Array<{ display_name: string; file_path: string }>;
      };
      expect(searchBody.total).toBeGreaterThanOrEqual(1);
      expect(searchBody.matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ display_name: "reindexMarker", file_path: "reindex_marker.ts" })
        ])
      );
    } finally {
      controller.abort();
      expect(await runPromise).toBe(0);
    }
  });
});
