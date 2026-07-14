import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexRepository, indexRepositoryIntoStore } from "@tadori/indexer";
import {
  findDanglingEndpoints,
  foreignKeyCheck,
  listSnapshots,
  loadSnapshotGraph,
  openDatabase,
  runMigrations
} from "@tadori/store";

const FIXTURE_ROOT = path.resolve(__dirname, "../../fixtures/04-diff-coalescing/before");

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "tadori-indexer-test-"));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("entity identity across edits and snapshots", () => {
  it("keeps node identity stable across an ordinary body edit", () => {
    const repo = path.join(workdir, "edit-repo");
    cpSync(FIXTURE_ROOT, repo, { recursive: true });

    const before = indexRepository(repo, { kind: "commit" });
    const beforeTask = before.graph.nodes.find(
      (n) => n.qualifiedName === "src/task.ts.processTask"
    );
    expect(beforeTask).toBeDefined();

    // Ordinary body edit: same file, same symbol, different body text.
    const taskPath = path.join(repo, "src", "task.ts");
    writeFileSync(
      taskPath,
      [
        'import { Audit } from "./audit.js";',
        'import { Formatter } from "./formatter.js";',
        'import { normalize } from "./legacy/helper.js";',
        'import { Resolver } from "./resolver.js";',
        "",
        "export function processTask(",
        "  input: string,",
        "  audit: Audit,",
        "  resolver: Resolver,",
        "  formatter: Formatter",
        "): string {",
        "  audit.record(input.trim());",
        "  const normalized = normalize(input.trim());",
        "  const formatted = formatter.formatValue(normalized);",
        "  return resolver.resolve(formatted);",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );

    const after = indexRepository(repo, { kind: "working_tree" });
    const afterTask = after.graph.nodes.find(
      (n) => n.qualifiedName === "src/task.ts.processTask"
    );

    expect(afterTask?.entityKey).toBe(beforeTask?.entityKey);
    expect(afterTask?.canonicalIdentity).toBe(beforeTask?.canonicalIdentity);
    expect(afterTask?.bodyHash).not.toBe(beforeTask?.bodyHash);
    expect(after.graph.workspaceHash).not.toBe(before.graph.workspaceHash);
  });

  it("stores commit and working-tree snapshots of one repo side by side", () => {
    const repo = path.join(workdir, "snapshot-repo");
    cpSync(FIXTURE_ROOT, repo, { recursive: true });

    const db = openDatabase(":memory:");
    runMigrations(db);
    try {
      const commit = indexRepositoryIntoStore(db, repo, {
        kind: "commit",
        baseCommitSha: "a1b2c3"
      });
      const workingTree = indexRepositoryIntoStore(db, repo, { kind: "working_tree" });

      expect(commit.repoId).toBe(workingTree.repoId);
      const snapshots = listSnapshots(db, commit.repoId);
      expect(snapshots.map((s) => s.kind).sort()).toEqual(["commit", "working_tree"]);

      const commitGraph = loadSnapshotGraph(db, commit.snapshotId);
      const workingGraph = loadSnapshotGraph(db, workingTree.snapshotId);
      expect(commitGraph.nodes.map((n) => n.entityKey)).toEqual(
        workingGraph.nodes.map((n) => n.entityKey)
      );

      // Stable entities are shared: one entity row per canonical identity.
      const entityCount = db.prepare("SELECT COUNT(*) AS c FROM node_entities").get() as {
        c: number;
      };
      expect(entityCount.c).toBe(commitGraph.nodes.length);

      expect(foreignKeyCheck(db)).toEqual([]);
      expect(findDanglingEndpoints(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("extracts type aliases as type nodes", () => {
    const repo = path.join(workdir, "type-repo");
    cpSync(FIXTURE_ROOT, repo, { recursive: true });
    writeFileSync(
      path.join(repo, "src", "kinds.ts"),
      'export type TaskKind = "one" | "two";\n',
      "utf8"
    );

    const result = indexRepository(repo, { kind: "commit" });
    const typeNode = result.graph.nodes.find(
      (n) => n.qualifiedName === "src/kinds.ts.TaskKind"
    );
    expect(typeNode?.kind).toBe("type");
    expect(typeNode?.exported).toBe(true);
  });
});
