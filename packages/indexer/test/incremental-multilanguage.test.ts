import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IncrementalRepositoryIndexer, indexRepository } from "@tadori/indexer";
import {
  getActiveSnapshot,
  loadSnapshotGraph,
  openDatabase,
  runMigrations,
  type Database
} from "@tadori/store";

const MIXED_FIXTURE = path.resolve("packages/bench/fixtures/mixed-oracle");

let container: string | null = null;
let db: Database | null = null;
let indexer: IncrementalRepositoryIndexer | null = null;

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
}

afterEach(async () => {
  await indexer?.stop();
  indexer = null;
  db?.close();
  db = null;
  if (container !== null) rmSync(container, { recursive: true, force: true });
  container = null;
});

describe("mixed-language incremental inventory", () => {
  it("retains the complete extractor inventory and matches a clean full index", async () => {
    container = mkdtempSync(path.join(tmpdir(), "tadori-mixed-incremental-"));
    const repo = path.join(container, "mixed-oracle");
    cpSync(MIXED_FIXTURE, repo, { recursive: true });
    db = openDatabase(":memory:");
    runMigrations(db);
    indexer = new IncrementalRepositoryIndexer(db, repo);
    await indexer.initialize();
    await indexer.waitForIdle();

    const repository = db.prepare("SELECT id FROM repositories WHERE root_path = ?").get(
      repo.split(path.sep).join("/")
    ) as { id: number };
    const beforeHead = getActiveSnapshot(db, repository.id, "working_tree");
    expect(beforeHead).toBeDefined();
    const before = loadSnapshotGraph(db, beforeHead!.id);
    expect(before.extractors.some((extractor) => extractor.id === "tadori-tree-sitter")).toBe(true);
    expect(before.extractors.some((extractor) => extractor.id === "tadori-interface-files")).toBe(true);

    const clientTestPath = path.join(repo, "src", "typescript", "client.test.ts");
    const source = readFileSync(clientTestPath, "utf8");
    expect(source).toContain("transform(1)");
    writeFileSync(clientTestPath, source.replace("transform(1)", "transform(2)"));

    const state = await indexer.refresh([{ path: "src/typescript/client.test.ts", kind: "change" }]);
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      reason: "cross-language boundary evidence change requires full extraction"
    });
    const stored = loadSnapshotGraph(db, state.snapshotId!);
    const clean = indexRepository(repo, { kind: "working_tree" }).graph;

    expect([...stored.files].sort((left, right) =>
      left.normalizedPath.localeCompare(right.normalizedPath)
    )).toEqual(clean.files);
    expect([...stored.nodes].sort((left, right) =>
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    )).toEqual(clean.nodes);
    expect([...stored.edges].sort((left, right) =>
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    )).toEqual(clean.edges);
    expect([...stored.projects].sort((left, right) =>
      left.projectId.localeCompare(right.projectId)
    )).toEqual(clean.projects);
    expect(stored.extractors).toEqual(clean.extractors);
    expect(stored.diagnostics).toEqual(clean.diagnostics);
    expect(stored.analyzerVersion).toBe(clean.analyzerVersion);
    expect(stored.extractors).toEqual(before.extractors);

    const clientPath = path.join(repo, "src", "typescript", "client.ts");
    const client = readFileSync(clientPath, "utf8");
    writeFileSync(clientPath, client.replace("return value + 1;", "return value + 2;"));
    const boundaryRefresh = await indexer.refresh([
      { path: "src/typescript/client.ts", kind: "change" }
    ]);
    expect(boundaryRefresh.lastRefresh).toMatchObject({
      mode: "full",
      reason: "cross-language boundary evidence change requires full extraction"
    });
  }, 120_000);

  it("removes a diagnostic-only extractor after its last contribution disappears", async () => {
    container = mkdtempSync(path.join(tmpdir(), "tadori-inventory-refresh-"));
    const repo = path.join(container, "repository");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src", "broken.ts"), "const answer = ;\n");
    db = openDatabase(":memory:");
    runMigrations(db);
    indexer = new IncrementalRepositoryIndexer(db, repo);
    await indexer.initialize();
    await indexer.waitForIdle();

    const repository = db.prepare("SELECT id FROM repositories WHERE root_path = ?").get(
      repo.split(path.sep).join("/")
    ) as { id: number };
    const beforeHead = getActiveSnapshot(db, repository.id, "working_tree");
    expect(beforeHead).toBeDefined();
    expect(loadSnapshotGraph(db, beforeHead!.id).extractors).toContainEqual(
      expect.objectContaining({ id: "tadori-typescript", languages: ["typescript"] })
    );

    writeFileSync(path.join(repo, "src", "broken.ts"), "const answer = 42;\n");
    const state = await indexer.refresh([{ path: "src/broken.ts", kind: "change" }]);
    expect(state.lastRefresh?.mode, state.lastRefresh?.reason).toBe("regional");
    const stored = loadSnapshotGraph(db, state.snapshotId!);
    const clean = indexRepository(repo, { kind: "working_tree" }).graph;

    expect(stored.extractors).toEqual(clean.extractors);
    expect(stored.extractors.some((extractor) => extractor.id === "tadori-typescript")).toBe(false);
    expect(stored.diagnostics).toEqual(clean.diagnostics);
    expect([...stored.nodes].sort((left, right) =>
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    )).toEqual(clean.nodes);
    expect([...stored.edges].sort((left, right) =>
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    )).toEqual(clean.edges);
  });

  it("forces full extraction when a TypeScript edit introduces the first boundary", async () => {
    container = mkdtempSync(path.join(tmpdir(), "tadori-first-boundary-refresh-"));
    const repo = path.join(container, "repository");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(
      path.join(repo, "src", "client.ts"),
      "export function check(): void {\n  console.log('idle');\n}\n"
    );
    writeFileSync(
      path.join(repo, "src", "server.py"),
      "@app.get('/health')\ndef health():\n    return 'ok'\n"
    );
    db = openDatabase(":memory:");
    runMigrations(db);
    indexer = new IncrementalRepositoryIndexer(db, repo);
    await indexer.initialize();
    await indexer.waitForIdle();

    const repository = db.prepare("SELECT id FROM repositories WHERE root_path = ?").get(
      repo.split(path.sep).join("/")
    ) as { id: number };
    const beforeHead = getActiveSnapshot(db, repository.id, "working_tree");
    expect(beforeHead).toBeDefined();
    expect(loadSnapshotGraph(db, beforeHead!.id).edges.some(
      (edge) => edge.provenance?.extractorId === "tadori-cross-language-boundaries"
    )).toBe(false);

    writeFileSync(
      path.join(repo, "src", "client.ts"),
      "export function check(): void {\n  void fetch('http://api/health');\n}\n"
    );
    const state = await indexer.refresh([{ path: "src/client.ts", kind: "change" }]);
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      reason: "cross-language boundary evidence change requires full extraction"
    });
    const stored = loadSnapshotGraph(db, state.snapshotId!);
    const clean = indexRepository(repo, { kind: "working_tree" }).graph;
    const boundaryEdges = stored.edges.filter(
      (edge) => edge.provenance?.extractorId === "tadori-cross-language-boundaries"
    );

    expect(boundaryEdges).toHaveLength(1);
    expect(boundaryEdges[0]).toMatchObject({ relation: "routes_to", resolution: "resolved" });
    expect([...stored.nodes].sort((left, right) =>
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    )).toEqual(clean.nodes);
    expect([...stored.edges].sort((left, right) =>
      left.canonicalIdentity.localeCompare(right.canonicalIdentity)
    )).toEqual(clean.edges);
    expect(stored.extractors).toEqual(clean.extractors);
    expect(stored.diagnostics).toEqual(clean.diagnostics);
  }, 120_000);

  it("preserves git co-change evidence across a mixed-language full refresh", async () => {
    container = mkdtempSync(path.join(tmpdir(), "tadori-cochange-refresh-"));
    const repo = path.join(container, "repository");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    git(repo, ["init"]);
    git(repo, ["config", "user.email", "tadori@example.com"]);
    git(repo, ["config", "user.name", "Tadori Test"]);
    git(repo, ["config", "commit.gpgsign", "false"]);
    git(repo, ["config", "core.autocrlf", "false"]);

    writeFileSync(path.join(repo, "package.json"), '{"name":"cochange-refresh"}\n');
    writeFileSync(
      path.join(repo, "src", "client.ts"),
      "export function client(): number { return 1; }\n"
    );
    writeFileSync(path.join(repo, "src", "worker.py"), "def worker():\n    return 1\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "first"]);

    writeFileSync(
      path.join(repo, "src", "client.ts"),
      "export function client(): number { return 2; }\n"
    );
    writeFileSync(path.join(repo, "src", "worker.py"), "def worker():\n    return 2\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "second"]);

    db = openDatabase(":memory:");
    runMigrations(db);
    indexer = new IncrementalRepositoryIndexer(db, repo);
    await indexer.initialize();
    await indexer.waitForIdle();
    const repository = db.prepare("SELECT id FROM repositories WHERE root_path = ?").get(
      repo.split(path.sep).join("/")
    ) as { id: number };
    const beforeHead = getActiveSnapshot(db, repository.id, "working_tree");
    expect(beforeHead).toBeDefined();
    const beforeEdges = loadSnapshotGraph(db, beforeHead!.id).edges.filter(
      (edge) => edge.relation === "changed_with"
    );
    expect(beforeEdges).toHaveLength(1);

    writeFileSync(
      path.join(repo, "src", "client.ts"),
      "export function client(): number { return 3; }\n"
    );
    const state = await indexer.refresh([{ path: "src/client.ts", kind: "change" }]);
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      reason: "cross-language boundary evidence change requires full extraction"
    });
    const afterEdges = loadSnapshotGraph(db, state.snapshotId!).edges.filter(
      (edge) => edge.relation === "changed_with"
    );
    expect(afterEdges).toEqual(beforeEdges);
  }, 120_000);
});
