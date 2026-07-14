import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@tadori/core";
import {
  collectOrphanEntities,
  diffSnapshotEdges,
  foreignKeyCheck,
  getSnapshot,
  insertSnapshotGraph,
  loadSnapshotGraph,
  openDatabase,
  pruneSnapshot,
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

/** Two-file graph; `variant` toggles one extra function/edge pair. */
function graphVariant(kind: "commit" | "working_tree", variant: "base" | "head") {
  const fileA = makeFile("src/a.ts");
  const fileB = makeFile("src/b.ts");
  const pkg = makeNode("package", "pkg-a", null);
  const fileNodeA = makeNode("file", "src/a.ts", "src/a.ts");
  const fileNodeB = makeNode("file", "src/b.ts", "src/b.ts");
  const alpha = makeNode("function", "src/a.ts.alpha", "src/a.ts", {
    bodyHash: sha256Hex("alpha")
  });
  const beta = makeNode("function", "src/b.ts.beta", "src/b.ts", {
    bodyHash: sha256Hex("beta")
  });

  const nodes = [pkg, fileNodeA, fileNodeB, alpha, beta];
  const edges = [
    makeEdge(pkg, "contains", fileNodeA),
    makeEdge(pkg, "contains", fileNodeB),
    makeEdge(fileNodeA, "contains", alpha),
    makeEdge(fileNodeB, "contains", beta),
    // Provenance upgrade candidate: heuristic in base, compiler in head.
    makeEdge(
      fileNodeA,
      "imports",
      fileNodeB,
      variant === "base"
        ? { origin: "heuristic", confidence: "likely", resolution: "partial" }
        : { origin: "compiler", confidence: "certain", resolution: "resolved" }
    )
  ];
  if (variant === "base") {
    edges.push(makeEdge(fileNodeA, "exports", alpha));
  } else {
    edges.push(makeEdge(fileNodeB, "exports", beta));
  }
  return makeGraph({ files: [fileA, fileB], nodes, edges }, kind);
}

describe("three-way snapshot edge diff", () => {
  it("reports added, removed, and resolution/provenance-changed rows", () => {
    const base = insertSnapshotGraph(db, graphVariant("commit", "base"));
    const head = insertSnapshotGraph(db, graphVariant("working_tree", "head"));

    const rows = diffSnapshotEdges(db, base.snapshotId, head.snapshotId);
    const ofKind = (kind: string) => rows.filter((r) => r.change_kind === kind);

    expect(ofKind("added").map((r) => `${r.source}|${r.relation}|${r.destination}`)).toEqual([
      "src/b.ts|exports|src/b.ts.beta"
    ]);
    expect(ofKind("removed").map((r) => `${r.source}|${r.relation}|${r.destination}`)).toEqual([
      "src/a.ts|exports|src/a.ts.alpha"
    ]);
    const changed = ofKind("resolution_or_provenance_changed");
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      source: "src/a.ts",
      relation: "imports",
      destination: "src/b.ts",
      before_origin: "heuristic",
      before_confidence: "likely",
      before_resolution: "partial",
      after_origin: "compiler",
      after_confidence: "certain",
      after_resolution: "resolved"
    });
  });
});

describe("pruning and orphan-entity garbage collection", () => {
  it("prunes an unpinned snapshot and collects only truly orphaned entities", () => {
    const base = insertSnapshotGraph(db, graphVariant("commit", "base"));
    const head = insertSnapshotGraph(db, graphVariant("working_tree", "head"));

    pruneSnapshot(db, base.snapshotId);
    expect(getSnapshot(db, base.snapshotId)?.status).toBe("pruned");

    const result = collectOrphanEntities(db);
    // The base-only exports edge (fileA exports alpha) is orphaned; every node
    // and file remains referenced by the head snapshot.
    expect(result.deletedEdgeEntities).toBe(1);
    expect(result.deletedNodeEntities).toBe(0);
    expect(result.deletedFileEntities).toBe(0);

    // Head snapshot is untouched and still fully valid.
    const stored = loadSnapshotGraph(db, head.snapshotId);
    expect(stored.nodes).toHaveLength(5);
    expect(stored.edges).toHaveLength(6);
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("collects nodes, files, and their edges once no snapshot references them", () => {
    const only = insertSnapshotGraph(db, graphVariant("commit", "base"));
    pruneSnapshot(db, only.snapshotId);

    const result = collectOrphanEntities(db);
    expect(result.deletedEdgeEntities).toBe(6);
    expect(result.deletedNodeEntities).toBe(5);
    expect(result.deletedFileEntities).toBe(2);

    const remaining = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM node_entities) AS n, (SELECT COUNT(*) FROM edge_entities) AS e, (SELECT COUNT(*) FROM file_entities) AS f"
      )
      .get() as { n: number; e: number; f: number };
    expect(remaining).toEqual({ n: 0, e: 0, f: 0 });
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("refuses to prune a pinned snapshot", () => {
    const pinned = insertSnapshotGraph(db, graphVariant("commit", "base"), { pinned: true });
    expect(() => pruneSnapshot(db, pinned.snapshotId)).toThrow(/pinned/);
    expect(loadSnapshotGraph(db, pinned.snapshotId).edges).toHaveLength(6);
  });
});
