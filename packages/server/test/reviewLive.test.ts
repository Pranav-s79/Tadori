import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexRepositoryIntoStore } from "@tadori/indexer";
import { openDatabase, runMigrations, type Database } from "@tadori/store";
import { ConcurrentRefreshController } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { createServerApp } from "../src/app.js";
import type { ReviewDiffDto } from "../src/types.js";

/**
 * Real-git integration tests for the working_tree / staged review-diff paths.
 * Each test builds a genuine git repository on disk, commits a baseline,
 * indexes that baseline into a file-backed SQLite store as the ACTIVE snapshot,
 * then serves it and asserts the live comparison against real disk / git-index
 * state — no mocks, real SQLite, real git.
 */

let tempDir: string | null = null;
let db: Database | null = null;
let refresh: ConcurrentRefreshController | null = null;
let app: FastifyInstance | null = null;

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function write(dir: string, rel: string, contents: string): void {
  writeFileSync(path.join(dir, rel), contents);
}

interface Fixture {
  repoRoot: string;
  db: Database;
  snapshotId: number;
}

/**
 * A git repo with an identity, LF pinned, one committed TS file, indexed into a
 * fresh store as the active snapshot. Returns the pieces the server needs.
 */
function buildGitRepoFixture(baseline: Record<string, string>): Fixture {
  const root = path.join(tempDir!, "repo");
  mkdirSync(root, { recursive: true });
  git(root, ["init"]);
  git(root, ["config", "user.email", "t@example.com"]);
  git(root, ["config", "user.name", "T"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["config", "core.autocrlf", "false"]);
  for (const [rel, contents] of Object.entries(baseline)) {
    write(root, rel, contents);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "baseline"]);

  const dbPath = path.join(tempDir!, "tadori.sqlite");
  const database = openDatabase(dbPath);
  runMigrations(database);
  const indexed = indexRepositoryIntoStore(database, root, { kind: "working_tree" });
  return {
    repoRoot: root.split(path.sep).join("/"),
    db: database,
    snapshotId: indexed.snapshotId
  };
}

async function serve(fixture: Fixture): Promise<void> {
  db = fixture.db;
  refresh = await ConcurrentRefreshController.start(fixture.db, fixture.repoRoot);
  app = await createServerApp({ db: fixture.db, repoRoot: fixture.repoRoot, refresh });
}

async function diff(
  kind: "working_tree" | "staged"
): Promise<{ status: number; body: ReviewDiffDto }> {
  const response = await app!.inject({
    method: "GET",
    url: `/api/v1/review/diff?${new URLSearchParams({ kind }).toString()}`
  });
  return { status: response.statusCode, body: response.json() as ReviewDiffDto };
}

/** Count of temp dirs this feature leaves in the OS temp dir (leak guard). */
function liveTempDirCount(): number {
  return readdirSync(tmpdir()).filter(
    (name) => name.startsWith("tadori-live-diff-") || name.startsWith("tadori-staged-")
  ).length;
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "tadori-review-live-"));
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  if (refresh) {
    await refresh.stop();
    refresh = null;
  }
  if (db) {
    db.close();
    db = null;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("review diff — working_tree comparison", () => {
  it("an unchanged working tree diffs empty against the active snapshot", async () => {
    await serve(buildGitRepoFixture({ "a.ts": "export const a = 1;\n" }));
    const { status, body } = await diff("working_tree");
    expect(status).toBe(200);
    expect(body.nodesAdded).toEqual([]);
    expect(body.nodesRemoved).toEqual([]);
    expect(body.edges).toEqual([]);
    expect(body.head.kind).toBe("working_tree");
    expect(body.head.status).toBe("live");
  });

  it("uses actual current working-tree contents (a new exported symbol appears)", async () => {
    // The analyzer extracts symbol nodes for functions/classes (not top-level
    // `const`), so fixtures use functions to exercise real symbol-level diffs.
    const fixture = buildGitRepoFixture({ "a.ts": "export function a() { return 1; }\n" });
    await serve(fixture);
    // Modify the working tree only (no add/commit).
    write(
      fixture.repoRoot,
      "a.ts",
      "export function a() { return 1; }\nexport function b() { return 2; }\n"
    );

    const { status, body } = await diff("working_tree");
    expect(status).toBe(200);
    expect(body.nodesAdded.map((n) => n.displayName)).toContain("b");
    expect(body.nodesRemoved).toEqual([]);
  });

  it("reports a removed symbol when the working tree deletes it", async () => {
    const fixture = buildGitRepoFixture({
      "a.ts": "export function a() { return 1; }\nexport function b() { return 2; }\n"
    });
    await serve(fixture);
    write(fixture.repoRoot, "a.ts", "export function a() { return 1; }\n");

    const { body } = await diff("working_tree");
    expect(body.nodesRemoved.map((n) => n.displayName)).toContain("b");
    expect(body.nodesAdded).toEqual([]);
  });
});

describe("review diff — staged comparison", () => {
  it("uses git-index contents: a staged addition appears", async () => {
    const fixture = buildGitRepoFixture({ "a.ts": "export function a() { return 1; }\n" });
    await serve(fixture);
    write(
      fixture.repoRoot,
      "a.ts",
      "export function a() { return 1; }\nexport function staged() { return 3; }\n"
    );
    git(fixture.repoRoot, ["add", "a.ts"]);

    const { status, body } = await diff("staged");
    expect(status).toBe(200);
    expect(body.nodesAdded.map((n) => n.displayName)).toContain("staged");
    expect(body.head.kind).toBe("staged");
  });

  it("a staged deletion appears as a removed symbol", async () => {
    const fixture = buildGitRepoFixture({
      "a.ts": "export function a() { return 1; }\n",
      "b.ts": "export function b() { return 2; }\n"
    });
    await serve(fixture);
    git(fixture.repoRoot, ["rm", "b.ts"]); // stages the deletion

    const { body } = await diff("staged");
    expect(body.nodesRemoved.map((n) => n.displayName)).toContain("b");
  });

  it("a working-tree-only change does NOT leak into the staged comparison", async () => {
    const fixture = buildGitRepoFixture({ "a.ts": "export function a() { return 1; }\n" });
    await serve(fixture);
    // Change the working tree but never stage it.
    write(
      fixture.repoRoot,
      "a.ts",
      "export function a() { return 1; }\nexport function unstaged() { return 9; }\n"
    );

    const { status, body } = await diff("staged");
    expect(status).toBe(200);
    // The staged tree still matches the committed baseline → empty diff.
    expect(body.nodesAdded).toEqual([]);
    expect(body.nodesRemoved).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it("staged uses staged content for a partially staged file (not the later unstaged edit)", async () => {
    const fixture = buildGitRepoFixture({ "a.ts": "export function a() { return 1; }\n" });
    await serve(fixture);
    // Stage one new symbol, then overwrite the working tree with a different one.
    write(
      fixture.repoRoot,
      "a.ts",
      "export function a() { return 1; }\nexport function stagedOnly() { return 1; }\n"
    );
    git(fixture.repoRoot, ["add", "a.ts"]);
    write(
      fixture.repoRoot,
      "a.ts",
      "export function a() { return 1; }\nexport function workingOnly() { return 2; }\n"
    );

    const { body } = await diff("staged");
    const added = body.nodesAdded.map((n) => n.displayName);
    expect(added).toContain("stagedOnly");
    expect(added).not.toContain("workingOnly");
  });
});

describe("review diff — live comparison hygiene", () => {
  it("returns 400 not_a_git_repository for staged in a non-git repo", async () => {
    const root = path.join(tempDir!, "nogit");
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "a.ts"), "export const a = 1;\n");
    const database = openDatabase(path.join(tempDir!, "tadori.sqlite"));
    runMigrations(database);
    const indexed = indexRepositoryIntoStore(database, root, { kind: "working_tree" });
    await serve({
      repoRoot: root.split(path.sep).join("/"),
      db: database,
      snapshotId: indexed.snapshotId
    });

    const response = await app!.inject({
      method: "GET",
      url: "/api/v1/review/diff?kind=staged"
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("not_a_git_repository");
  });

  it("does not leak temp dirs and never mutates the working tree / git index", async () => {
    const fixture = buildGitRepoFixture({ "a.ts": "export const a = 1;\n" });
    await serve(fixture);
    write(fixture.repoRoot, "a.ts", "export const a = 1;\nexport const b = 2;\n");
    git(fixture.repoRoot, ["add", "a.ts"]);
    const statusBefore = execFileSync("git", ["status", "--porcelain"], {
      cwd: fixture.repoRoot,
      encoding: "utf8"
    });
    const before = liveTempDirCount();

    await diff("staged");
    await diff("working_tree");

    // No orphaned temp dirs.
    expect(liveTempDirCount()).toBe(before);
    // Working tree + index untouched by the comparison.
    const statusAfter = execFileSync("git", ["status", "--porcelain"], {
      cwd: fixture.repoRoot,
      encoding: "utf8"
    });
    expect(statusAfter).toBe(statusBefore);
  });
});
