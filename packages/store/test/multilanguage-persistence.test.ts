import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex, type ExtractionProvenance } from "@tadori/core";
import {
  MIGRATIONS,
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
    expect(MIGRATIONS.at(-1)?.version).toBe(7);
    const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>;
    expect(versions.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 7]);

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
  });
});
