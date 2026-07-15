import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureSnapshotFts,
  insertSnapshotGraph,
  openDatabase,
  pruneSnapshot,
  runMigrations,
  searchNodeFts,
  toFtsQuery,
  type Database
} from "@tadori/store";
import { makeFile, makeGraph, makeNode } from "./helpers.js";

let db: Database;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
});

afterEach(() => {
  db.close();
});

function searchableGraph(kind: "commit" | "working_tree" = "commit") {
  const file = makeFile("src/search.ts", "export function Alpha() {}\n");
  const exact = makeNode("function", "src/search.ts.Alpha", file.normalizedPath, {
    displayName: "Alpha",
    signature: "Alpha(): void"
  });
  const prefix = makeNode("function", "src/search.ts.Alphabet", file.normalizedPath, {
    displayName: "Alphabet",
    signature: "Alphabet(): void"
  });
  const classNode = makeNode("class", "src/search.ts.AlphaClass", file.normalizedPath, {
    displayName: "AlphaClass"
  });
  return makeGraph({ files: [file], nodes: [exact, prefix, classNode], edges: [] }, kind);
}

describe("snapshot FTS", () => {
  it("boosts exact matches, reports the total, and filters by kind", () => {
    const snapshot = insertSnapshotGraph(db, searchableGraph());

    const all = searchNodeFts(db, snapshot.snapshotId, "Alpha", 3);
    expect(all.total).toBe(3);
    expect(all.matches[0]?.display_name).toBe("Alpha");
    expect(all.matches.slice(1).map((row) => row.display_name).sort()).toEqual([
      "AlphaClass",
      "Alphabet"
    ]);
    expect(all.matches[0]?.exact_match).toBe(1);

    const classes = searchNodeFts(db, snapshot.snapshotId, "Alpha", 10, "class");
    expect(classes.total).toBe(1);
    expect(classes.matches[0]?.kind).toBe("class");
  });

  it("rebuilds a missing legacy FTS population and stays snapshot-isolated", () => {
    const first = insertSnapshotGraph(db, searchableGraph("commit"));
    const secondGraph = searchableGraph("working_tree");
    secondGraph.nodes = [
      makeNode("function", "src/search.ts.Beta", "src/search.ts", {
        displayName: "Beta",
        signature: "Beta(): void"
      })
    ];
    secondGraph.workspaceHash = `${secondGraph.workspaceHash.slice(0, -1)}0`;
    const second = insertSnapshotGraph(db, secondGraph);

    db.prepare("DELETE FROM node_fts WHERE snapshot_id = ?").run(first.snapshotId);
    ensureSnapshotFts(db, first.snapshotId);

    expect(searchNodeFts(db, first.snapshotId, "Alpha", 10).total).toBe(3);
    expect(searchNodeFts(db, first.snapshotId, "Beta", 10).total).toBe(0);
    expect(searchNodeFts(db, second.snapshotId, "Beta", 10).total).toBe(1);
  });

  it("repairs equal-count FTS corruption and supports deterministic offsets", () => {
    const snapshot = insertSnapshotGraph(db, searchableGraph());
    const deleted = db
      .prepare(
        `SELECT node_id FROM node_fts
         WHERE snapshot_id = ? AND display_name = 'Alpha'`
      )
      .get(snapshot.snapshotId) as { node_id: number };
    db.prepare("DELETE FROM node_fts WHERE snapshot_id = ? AND node_id = ?").run(
      snapshot.snapshotId,
      deleted.node_id
    );
    db.prepare(
      `INSERT INTO node_fts
         (snapshot_id, node_id, display_name, qualified_name, signature, path)
       VALUES (?, 999999, 'AlphaGhost', 'ghost.Alpha', '', '')`
    ).run(snapshot.snapshotId);

    ensureSnapshotFts(db, snapshot.snapshotId);
    expect(searchNodeFts(db, snapshot.snapshotId, "Alpha", 10).total).toBe(3);
    const first = searchNodeFts(db, snapshot.snapshotId, "Alpha", 1);
    const second = searchNodeFts(db, snapshot.snapshotId, "Alpha", 1, undefined, 1);
    expect(second.matches[0]?.entity_key).not.toBe(first.matches[0]?.entity_key);
  });

  it("escapes FTS syntax, validates limits, and removes rows when pruning", () => {
    const snapshot = insertSnapshotGraph(db, searchableGraph());
    insertSnapshotGraph(db, { ...searchableGraph(), workspaceHash: "0".repeat(64) });
    expect(toFtsQuery('Alpha" OR *')).toBe('"Alpha"* "OR"*');
    expect(() => searchNodeFts(db, snapshot.snapshotId, 'Alpha" OR *', 10)).not.toThrow();
    expect(() => searchNodeFts(db, snapshot.snapshotId, "Alpha", 0)).toThrow(/1 to 100/);

    pruneSnapshot(db, snapshot.snapshotId);
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM node_fts WHERE snapshot_id = ?")
      .get(snapshot.snapshotId) as { count: number };
    expect(count.count).toBe(0);
  });
});
