import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex, type ExtractionProvenance } from "@tadori/core";
import {
  MIGRATIONS,
  diffSnapshotProjects,
  insertSnapshotGraph,
  loadSnapshotGraph,
  openDatabase,
  runMigrations,
  type Database
} from "@tadori/store";
import { makeEdge, makeFile, makeGraph, makeNode } from "./helpers.js";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

const pythonProvenance: ExtractionProvenance = {
  extractorId: "tadori-tree-sitter",
  extractorVersion: "1",
  capability: "structural",
  derivation: "parser-derived",
  unresolvedReason: null
};

describe("migration 7 multi-language persistence", () => {
  it("adds nullable attribution columns and the snapshot extractor inventory", () => {
    expect(MIGRATIONS.at(-1)?.version).toBe(8);
    const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
    expect(versions.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const nodeColumns = new Map(
      (db.prepare("PRAGMA table_info(snapshot_nodes)").all() as Array<{ name: string; notnull: number }>)
        .map((column) => [column.name, column.notnull])
    );
    for (const column of [
      "language", "extractor_id", "extractor_version", "capability", "derivation",
      "unresolved_reason"
    ]) {
      expect(nodeColumns.get(column), `missing nullable snapshot_nodes.${column}`).toBe(0);
    }
    expect(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'snapshot_extractors'"
    ).get()).toBeDefined();
  });

  it("round-trips per-item provenance and sorted extractor languages", () => {
    const file = { ...makeFile("src/main.py"), language: "python" };
    const source = makeNode("file", "python|src/main.py", "src/main.py", {
      language: "python", provenance: pythonProvenance
    });
    const fn = makeNode("function", "python|src/main.py|main", "src/main.py", {
      language: "python", provenance: pythonProvenance,
      bodyHash: sha256Hex("def main(): pass")
    });
    const contains = {
      ...makeEdge(source, "contains", fn), language: "python", provenance: pythonProvenance
    };
    const graph = makeGraph({
      files: [file], nodes: [source, fn], edges: [contains],
      extractors: [{
        id: "tadori-tree-sitter", version: "1", capability: "structural",
        languages: ["python", "cpp"]
      }]
    });

    const { snapshotId } = insertSnapshotGraph(db, graph);
    const stored = loadSnapshotGraph(db, snapshotId);
    expect(stored.nodes.every((node) => node.language === "python")).toBe(true);
    expect(stored.nodes.every((node) => node.provenance?.derivation === "parser-derived")).toBe(true);
    expect(stored.edges[0]?.provenance).toEqual(pythonProvenance);
    expect(stored.extractors).toEqual([{
      id: "tadori-tree-sitter", version: "1", capability: "structural",
      languages: ["cpp", "python"]
    }]);
  });

  it("reads legacy-style memberships with null attribution", () => {
    const graph = makeGraph({
      files: [makeFile("src/legacy.ts")],
      nodes: [makeNode("file", "src/legacy.ts", "src/legacy.ts")],
      edges: []
    });
    const { snapshotId } = insertSnapshotGraph(db, graph);
    const stored = loadSnapshotGraph(db, snapshotId);

    expect(stored.nodes[0]).not.toHaveProperty("language");
    expect(stored.nodes[0]).not.toHaveProperty("provenance");
    expect(stored.extractors).toEqual([]);
    expect(stored.projects).toEqual([]);
  });

  it("loads a snapshot created before migration 8 with an empty project inventory", () => {
    const legacy = openDatabase(":memory:");
    try {
      for (const migration of MIGRATIONS.slice(0, 7)) legacy.exec(migration.sql);
      const repoId = Number(
        legacy.prepare("INSERT INTO repositories(root_path) VALUES (?)").run("C:/legacy-projects")
          .lastInsertRowid
      );
      const snapshotId = Number(
        legacy.prepare(
          `INSERT INTO repository_snapshots(repo_id, kind, workspace_hash)
           VALUES (?, 'commit', ?)`
        ).run(repoId, "b".repeat(64)).lastInsertRowid
      );
      expect(runMigrations(legacy)).toEqual([8]);
      expect(loadSnapshotGraph(legacy, snapshotId).projects).toEqual([]);
    } finally {
      legacy.close();
    }
  });

  it("round-trips sorted discovered projects without requiring manifest file membership", () => {
    const projectId = sha256Hex("project|manifest|services/api/pyproject.toml");
    const graph = makeGraph({
      files: [],
      nodes: [],
      edges: [],
      projects: [{
        projectId,
        root: "services/api",
        manifest: "services/api/pyproject.toml",
        kind: "manifest",
        name: "api",
        languages: ["python", "toml"]
      }]
    });
    const { snapshotId } = insertSnapshotGraph(db, graph);
    expect(loadSnapshotGraph(db, snapshotId).projects).toEqual(graph.projects);
  });

  it("requires purge and re-index instead of mutating a pre-project immutable snapshot", () => {
    const legacy = makeGraph({ files: [], nodes: [], edges: [], projects: [] });
    insertSnapshotGraph(db, legacy);
    const current = {
      ...legacy,
      projects: [{
        projectId: sha256Hex("project|manifest|go.mod"),
        root: ".",
        manifest: "go.mod",
        kind: "manifest",
        name: null,
        languages: ["go"]
      }]
    };
    expect(() => insertSnapshotGraph(db, current)).toThrow(/purge and re-index/);
  });

  it("diffs project additions and metadata changes without inventing node or edge changes", () => {
    const projectId = sha256Hex("project|manifest|go.mod");
    const base = insertSnapshotGraph(db, makeGraph({
      files: [], nodes: [], edges: [], projects: []
    }, "commit"));
    const head = insertSnapshotGraph(db, {
      ...makeGraph({
        files: [], nodes: [], edges: [], projects: [{
          projectId, root: ".", manifest: "go.mod", kind: "manifest",
          name: "example.test/one", languages: ["go"]
        }]
      }, "working_tree"),
      workspaceHash: sha256Hex("project-head")
    });
    expect(diffSnapshotProjects(db, base.snapshotId, head.snapshotId)).toEqual([
      expect.objectContaining({ change_kind: "added", project_id: projectId, before: null })
    ]);

    const changed = insertSnapshotGraph(db, {
      ...makeGraph({
        files: [], nodes: [], edges: [], projects: [{
          projectId, root: ".", manifest: "go.mod", kind: "manifest",
          name: "example.test/two", languages: ["go"]
        }]
      }, "staged"),
      workspaceHash: sha256Hex("project-changed")
    });
    expect(diffSnapshotProjects(db, head.snapshotId, changed.snapshotId)).toEqual([
      expect.objectContaining({ change_kind: "metadata_changed", project_id: projectId })
    ]);
  });
});
