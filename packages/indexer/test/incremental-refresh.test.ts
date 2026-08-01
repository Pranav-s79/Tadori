import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  IncrementalRepositoryIndexer,
  indexRepository,
  type IncrementalRepositoryIndexerOptions
} from "@tadori/indexer";
import {
  findDanglingEndpoints,
  foreignKeyCheck,
  getActiveSnapshot,
  listSnapshots,
  loadSnapshotGraph,
  openDatabase,
  runMigrations,
  type Database
} from "@tadori/store";

let db: Database;
let repo: string;
const controllers: IncrementalRepositoryIndexer[] = [];

function git(args: readonly string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "ignore", windowsHide: true });
}

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
  repo = mkdtempSync(path.join(tmpdir(), "tadori-refresh-"));
  mkdirSync(path.join(repo, "src"), { recursive: true });
  writeFileSync(path.join(repo, "package.json"), '{"name":"refresh-fixture"}\n');
  writeFileSync(
    path.join(repo, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true},"include":["src"]}\n'
  );
  writeFileSync(
    path.join(repo, "src", "value.ts"),
    "export function value(): number { return 1; }\n"
  );
  writeFileSync(
    path.join(repo, "src", "consumer.ts"),
    'import { value } from "./value.js";\nexport function consume(): number { return value(); }\n'
  );
});

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    await controller.stop();
  }
  db.close();
  rmSync(repo, { recursive: true, force: true });
});

async function controller(
  options: IncrementalRepositoryIndexerOptions = {}
): Promise<IncrementalRepositoryIndexer> {
  const instance = new IncrementalRepositoryIndexer(db, repo, options);
  controllers.push(instance);
  await instance.initialize();
  await instance.waitForIdle();
  return instance;
}

function repositoryId(): number {
  return (db
    .prepare("SELECT id FROM repositories WHERE root_path = ?")
    .get(repo.split(path.sep).join("/")) as { id: number }).id;
}

function activeSnapshotId(): number {
  const active = getActiveSnapshot(db, repositoryId(), "working_tree");
  if (!active) {
    throw new Error("No active working-tree snapshot");
  }
  return active.id;
}

describe("incremental refresh coordinator", () => {
  it("publishes a body edit region with reverse-import dependents and exact full parity", async () => {
    const indexer = await controller();
    const before = activeSnapshotId();
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 2; }\n"
    );
    indexer.enqueue([{ path: "src/value.ts", kind: "change" }]);
    expect(indexer.state()).toMatchObject({
      phase: "dirty",
      dirtyPaths: ["src/value.ts"],
      affectedPaths: ["src/consumer.ts", "src/value.ts"]
    });
    await indexer.waitForIdle();
    const state = indexer.state();
    expect(state.phase).toBe("idle");
    expect(state.snapshotId).not.toBe(before);
    expect(state.lastRefresh).toMatchObject({
      mode: "regional",
      changedPaths: ["src/value.ts"],
      affectedPaths: ["src/consumer.ts", "src/value.ts"]
    });
    const stored = loadSnapshotGraph(db, state.snapshotId as number);
    const clean = indexRepository(repo, { kind: "working_tree" }).graph;
    expect(stored.files).toEqual(clean.files);
    expect([...stored.nodes].sort((a, b) => a.canonicalIdentity.localeCompare(b.canonicalIdentity)))
      .toEqual([...clean.nodes].sort((a, b) => a.canonicalIdentity.localeCompare(b.canonicalIdentity)));
    expect([...stored.edges].sort((a, b) => a.canonicalIdentity.localeCompare(b.canonicalIdentity)))
      .toEqual([...clean.edges].sort((a, b) => a.canonicalIdentity.localeCompare(b.canonicalIdentity)));
    expect(findDanglingEndpoints(db, state.snapshotId as number)).toEqual([]);
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("reconciles attributed git co-change edges after a regional source edit", async () => {
    git(["init"]);
    git(["config", "user.email", "tadori@example.com"]);
    git(["config", "user.name", "Tadori Test"]);
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "core.autocrlf", "false"]);
    git(["add", "."]);
    git(["commit", "-m", "first"]);
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 2; }\n"
    );
    writeFileSync(
      path.join(repo, "src", "consumer.ts"),
      'import { value } from "./value.js";\nexport function consume(): number { return value() + 1; }\n'
    );
    git(["add", "."]);
    git(["commit", "-m", "second"]);

    const indexer = await controller();
    const before = loadSnapshotGraph(db, activeSnapshotId());
    const beforeCoChange = before.edges.filter((edge) => edge.relation === "changed_with");
    expect(beforeCoChange).toHaveLength(1);
    const edge = beforeCoChange[0]!;
    const source = before.nodes.find((node) => node.entityKey === edge.srcEntityKey);
    if (source?.file !== "src/value.ts" && source?.file !== "src/consumer.ts") {
      throw new Error("Expected the co-change source to be one of the committed TypeScript files");
    }
    expect(edge.language).toBe("typescript");
    expect(edge.evidence[0]?.file).toBe(source.file);
    expect(edge.provenance).toEqual({
      extractorId: "tadori-git-co-change",
      extractorVersion: "1",
      capability: "repository",
      derivation: "repository-derived",
      unresolvedReason: null
    });
    const expectedInventory = {
      id: "tadori-git-co-change",
      version: "1",
      capability: "repository" as const,
      languages: ["typescript"]
    };
    expect(before.extractors).toContainEqual(expectedInventory);

    writeFileSync(
      path.join(repo, source.file),
      source.file === "src/value.ts"
        ? "export function value(): number { return 3; }\n"
        : 'import { value } from "./value.js";\nexport function consume(): number { return value() + 2; }\n'
    );
    const state = await indexer.refresh([{ path: source.file, kind: "change" }]);
    expect(state.lastRefresh).toMatchObject({ mode: "regional", changedPaths: [source.file] });
    const after = loadSnapshotGraph(db, state.snapshotId!);
    expect(after.edges.filter((candidate) => candidate.relation === "changed_with"))
      .toEqual(beforeCoChange);
    expect(after.extractors).toContainEqual(expectedInventory);
    expect(findDanglingEndpoints(db, state.snapshotId!)).toEqual([]);
    expect(foreignKeyCheck(db)).toEqual([]);
  }, 30_000);

  it("falls back to full extraction for additions, moves, and symbol renames", async () => {
    const indexer = await controller();
    writeFileSync(path.join(repo, "src", "added.ts"), "export const added = true;\n");
    let state = await indexer.refresh([{ path: "src/added.ts", kind: "rename" }]);
    expect(state.lastRefresh?.mode).toBe("full");
    expect(state.lastRefresh?.reason).toMatch(/addition|move/);

    renameSync(path.join(repo, "src", "added.ts"), path.join(repo, "src", "moved.ts"));
    state = await indexer.refresh([
      { path: "src/added.ts", kind: "rename" },
      { path: "src/moved.ts", kind: "rename" }
    ]);
    expect(state.lastRefresh?.mode).toBe("full");

    rmSync(path.join(repo, "src", "moved.ts"));
    state = await indexer.refresh([{ path: "src/moved.ts", kind: "rename" }]);
    expect(state.lastRefresh?.mode).toBe("full");
    expect(state.lastRefresh?.reason).toMatch(/deletion|move/);

    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function renamedValue(): number { return 1; }\n"
    );
    state = await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);
    expect(state.lastRefresh?.mode).toBe("full");
    expect(state.lastRefresh?.reason).toMatch(/full extraction|regional proof failed/);
  });

  it("publishes recovery-capable TypeScript edits with diagnostics and recovers deterministically", async () => {
    const indexer = await controller();
    const validSnapshot = activeSnapshotId();
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(: number { return 2; }\n"
    );
    let state = await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);
    expect(state.phase).toBe("idle");
    expect(state.lastError).toBeNull();
    expect(activeSnapshotId()).not.toBe(validSnapshot);
    expect(state.lastRefresh?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/value.ts" })
    ]));
    expect(loadSnapshotGraph(db, activeSnapshotId()).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "typescript-syntax",
        severity: "error",
        file: "src/value.ts",
        extractorId: "tadori-typescript",
        extractorVersion: "1"
      })
    ]));

    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 3; }\n"
    );
    state = await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);
    expect(state.phase).toBe("idle");
    expect(state.snapshotId).not.toBe(validSnapshot);
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("activates a recovery-capable initial snapshot with malformed source isolated", async () => {
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(: number { return 2; }\n"
    );
    const indexer = new IncrementalRepositoryIndexer(db, repo);
    controllers.push(indexer);

    await expect(indexer.initialize()).resolves.toBeDefined();
    const repoRow = db
      .prepare("SELECT id FROM repositories WHERE root_path = ?")
      .get(repo.split(path.sep).join("/")) as { id: number };
    expect(getActiveSnapshot(db, repoRow.id, "working_tree")).toBeDefined();
    expect(listSnapshots(db, repoRow.id)).toHaveLength(1);
    const graph = loadSnapshotGraph(db, activeSnapshotId());
    expect(graph.nodes.some((node) => node.file === "src/consumer.ts")).toBe(true);
    expect(graph.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "typescript-syntax", file: "src/value.ts" })
    ]));
  });

  it("treats lock and ignore files as captured full-invalidation inputs", async () => {
    const lockfile = path.join(repo, "pnpm-lock.yaml");
    const ignoreFile = path.join(repo, ".tadoriignore");
    writeFileSync(lockfile, "lockfileVersion: '9.0'\n");
    writeFileSync(ignoreFile, "generated/\n");
    const indexer = await controller();

    writeFileSync(lockfile, "lockfileVersion: '9.0'\nsettings: {}\n");
    let state = await indexer.refresh([{ path: "pnpm-lock.yaml", kind: "change" }]);
    expect(state.lastRefresh).toMatchObject({ mode: "full", changedPaths: ["pnpm-lock.yaml"] });

    writeFileSync(ignoreFile, "generated/\nfixtures/\n");
    state = await indexer.refresh([{ path: ".tadoriignore", kind: "change" }]);
    expect(state.lastRefresh).toMatchObject({ mode: "full", changedPaths: [".tadoriignore"] });
  });

  it("cancels a superseded build before activation and publishes only the newest generation", async () => {
    let firstPublish = true;
    const indexer = await controller({
      beforePublish: () => {
        if (!firstPublish) {
          return;
        }
        firstPublish = false;
        const oldHead = activeSnapshotId();
        writeFileSync(
          path.join(repo, "src", "value.ts"),
          "export function value(): number { return 3; }\n"
        );
        indexer.enqueue([{ path: "src/value.ts", kind: "change" }]);
        expect(activeSnapshotId()).toBe(oldHead);
      }
    });
    const initial = activeSnapshotId();
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 2; }\n"
    );
    const state = await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);

    expect(state.phase).toBe("idle");
    expect(state.generation).toBeGreaterThan(1);
    expect(state.snapshotId).not.toBe(initial);
    expect(listSnapshots(db, repositoryId())).toHaveLength(2);
    const graph = loadSnapshotGraph(db, state.snapshotId as number);
    expect(graph.nodes.find((node) => node.qualifiedName.endsWith(".value"))?.bodyHash).toBe(
      indexRepository(repo, { kind: "working_tree" }).graph.nodes.find(
        (node) => node.qualifiedName.endsWith(".value")
      )?.bodyHash
    );
  });

  it("supports explicit cancellation while a completed graph awaits publication", async () => {
    let releasePublish: () => void = () => undefined;
    let reportPublishReady: () => void = () => undefined;
    const publishReady = new Promise<void>((resolve) => {
      reportPublishReady = resolve;
    });
    const publicationGate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const indexer = await controller({
      beforePublish: async () => {
        reportPublishReady();
        await publicationGate;
      }
    });
    const initial = activeSnapshotId();
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 8; }\n"
    );
    const refreshing = indexer.refresh([{ path: "src/value.ts", kind: "change" }]);
    await publishReady;
    indexer.cancelPendingRefresh();
    releasePublish();
    const state = await refreshing;

    expect(state.phase).toBe("idle");
    expect(activeSnapshotId()).toBe(initial);
    expect(listSnapshots(db, repositoryId())).toHaveLength(1);
  });

  it("treats rapid revert-to-A as immutable reactivation and watcher restart hints as no-ops", async () => {
    const indexer = await controller();
    const snapshotA = activeSnapshotId();
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 2; }\n"
    );
    await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);
    const snapshotB = activeSnapshotId();
    expect(snapshotB).not.toBe(snapshotA);

    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 1; }\n"
    );
    const reverted = await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);
    expect(reverted.snapshotId).toBe(snapshotA);
    expect(reverted.lastRefresh?.reusedSnapshot).toBe(true);

    const generation = reverted.generation;
    const restarted = await indexer.refresh([{ path: ".", kind: "rescan" }]);
    expect(restarted.phase).toBe("idle");
    expect(restarted.snapshotId).toBe(snapshotA);
    expect(restarted.generation).toBe(generation + 1);
    expect(restarted.lastRefresh).toMatchObject({
      generation: generation + 1,
      mode: "noop"
    });
  });

  it("auto-initializes the public refresh lifecycle", async () => {
    const indexer = new IncrementalRepositoryIndexer(db, repo);
    controllers.push(indexer);
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 4; }\n"
    );
    const state = await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);
    expect(state.phase).toBe("idle");
    expect(state.snapshotId).not.toBeNull();
  });

  it("reconciles an offline edit on restart instead of accepting it as the baseline", async () => {
    const first = await controller();
    const snapshotA = activeSnapshotId();
    await first.stop();
    controllers.splice(controllers.indexOf(first), 1);
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 9; }\n"
    );

    const restarted = await controller();
    const state = restarted.state();
    expect(state.phase).toBe("idle");
    expect(state.snapshotId).not.toBe(snapshotA);
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      reason: "restart reconciliation found a workspace different from the served head"
    });
  });

  it("recaptures after the publication hook and rejects an unreported late write", async () => {
    let wroteLate = false;
    const indexer = await controller({
      beforePublish: () => {
        if (wroteLate) {
          return;
        }
        wroteLate = true;
        writeFileSync(
          path.join(repo, "src", "value.ts"),
          "export function value(): number { return 3; }\n"
        );
      }
    });
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 2; }\n"
    );
    const state = await indexer.refresh([{ path: "src/value.ts", kind: "change" }]);

    expect(state.phase).toBe("idle");
    expect(loadSnapshotGraph(db, state.snapshotId as number).snapshot.workspace_hash).toBe(
      indexRepository(repo, { kind: "working_tree" }).graph.workspaceHash
    );
    expect(listSnapshots(db, repositoryId())).toHaveLength(2);
  });
});
