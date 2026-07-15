import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entityKey, nodeCanonicalIdentity, sha256Hex } from "@tadori/core";
import {
  DanglingEndpointError,
  ensureNodeEntity,
  findDanglingEndpoints,
  foreignKeyCheck,
  getActiveSnapshot,
  getSnapshotHead,
  insertSnapshotGraph,
  listSnapshots,
  loadSnapshotGraph,
  openDatabase,
  runMigrations,
  SnapshotActivationConflictError,
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

function smallGraph(kind: "commit" | "working_tree" = "commit", bodyHash?: string) {
  const file = makeFile("src/a.ts");
  const pkg = makeNode("package", "pkg-a", null);
  const fileNode = makeNode("file", "src/a.ts", "src/a.ts");
  const fn = makeNode("function", "src/a.ts.alpha", "src/a.ts", {
    exported: true,
    lineStart: 1,
    lineEnd: 3,
    spanStart: 0,
    spanEnd: 30,
    signature: "alpha(): void",
    bodyHash: bodyHash ?? sha256Hex("alpha-body"),
    evidence: [{ file: "src/a.ts", kind: "source", lineStart: 1, lineEnd: 3 }]
  });
  const edges = [
    makeEdge(pkg, "contains", fileNode, {
      evidence: [{ file: "src/a.ts", kind: "source", lineStart: 1, lineEnd: 1 }]
    }),
    makeEdge(fileNode, "contains", fn),
    makeEdge(fileNode, "exports", fn)
  ];
  return makeGraph({ files: [file], nodes: [pkg, fileNode, fn], edges }, kind);
}

describe("snapshot insertion", () => {
  it("inserts a graph and reads it back intact", () => {
    const { snapshotId } = insertSnapshotGraph(db, smallGraph());
    const stored = loadSnapshotGraph(db, snapshotId);

    expect(stored.files.map((f) => f.normalizedPath)).toEqual(["src/a.ts"]);
    expect(stored.nodes).toHaveLength(3);
    expect(stored.edges).toHaveLength(3);

    const fn = stored.nodes.find((n) => n.kind === "function");
    expect(fn?.exported).toBe(true);
    expect(fn?.lineStart).toBe(1);
    expect(fn?.signature).toBe("alpha(): void");
    expect(fn?.evidence).toEqual([
      { file: "src/a.ts", kind: "source", lineStart: 1, lineEnd: 3 }
    ]);

    expect(foreignKeyCheck(db)).toEqual([]);
    expect(findDanglingEndpoints(db, snapshotId)).toEqual([]);
  });

  it("lets commit and working-tree snapshots of the same content coexist", () => {
    const commit = insertSnapshotGraph(db, smallGraph("commit"));
    const workingTree = insertSnapshotGraph(db, smallGraph("working_tree"));

    expect(commit.repoId).toBe(workingTree.repoId);
    const snapshots = listSnapshots(db, commit.repoId);
    expect(snapshots.map((s) => s.kind).sort()).toEqual(["commit", "working_tree"]);
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("shares stable entities across snapshots while keeping per-snapshot state", () => {
    const first = insertSnapshotGraph(db, smallGraph("commit", sha256Hex("body-v1")));
    const second = insertSnapshotGraph(db, smallGraph("working_tree", sha256Hex("body-v2")));

    const nodeEntityCount = db
      .prepare("SELECT COUNT(*) AS c FROM node_entities")
      .get() as { c: number };
    expect(nodeEntityCount.c).toBe(3);
    const edgeEntityCount = db
      .prepare("SELECT COUNT(*) AS c FROM edge_entities")
      .get() as { c: number };
    expect(edgeEntityCount.c).toBe(3);

    const firstFn = loadSnapshotGraph(db, first.snapshotId).nodes.find(
      (n) => n.kind === "function"
    );
    const secondFn = loadSnapshotGraph(db, second.snapshotId).nodes.find(
      (n) => n.kind === "function"
    );
    expect(firstFn?.entityKey).toBe(secondFn?.entityKey);
    expect(firstFn?.bodyHash).toBe(sha256Hex("body-v1"));
    expect(secondFn?.bodyHash).toBe(sha256Hex("body-v2"));
  });

  it("rejects and rolls back a snapshot whose edge lacks endpoint membership", () => {
    const graph = smallGraph();
    // Drop the function node's membership while keeping edges that target it.
    const broken = { ...graph, nodes: graph.nodes.filter((n) => n.kind !== "function") };
    // Edge insertion cross-checks the payload first, so route around it by
    // pointing the edge at a node that IS a member of a different snapshot.
    insertSnapshotGraph(db, smallGraph("working_tree"));
    expect(() => insertSnapshotGraph(db, broken)).toThrow(DanglingEndpointError);

    // Nothing from the failed snapshot may persist.
    const commitCount = db
      .prepare("SELECT COUNT(*) AS c FROM repository_snapshots WHERE kind = 'commit'")
      .get() as { c: number };
    expect(commitCount.c).toBe(0);
    expect(foreignKeyCheck(db)).toEqual([]);
  });

  it("never serves a snapshot with dangling endpoint memberships", () => {
    const valid = insertSnapshotGraph(db, smallGraph("commit"));

    const graph = smallGraph("working_tree");
    const broken = { ...graph, nodes: graph.nodes.filter((n) => n.kind !== "function") };
    const invalid = insertSnapshotGraph(db, broken, { dangerouslySkipValidation: true });
    expect(findDanglingEndpoints(db, invalid.snapshotId).length).toBeGreaterThan(0);

    const active = getActiveSnapshot(db, valid.repoId);
    expect(active?.id).toBe(valid.snapshotId);
  });

  it("reactivates an existing A snapshot after A -> B -> A without violating uniqueness", () => {
    const graphA = { ...smallGraph("working_tree"), workspaceHash: sha256Hex("workspace-a") };
    const graphB = { ...smallGraph("working_tree"), workspaceHash: sha256Hex("workspace-b") };
    const firstA = insertSnapshotGraph(db, graphA);
    const b = insertSnapshotGraph(db, graphB, {
      expectedActivationId: firstA.activationId
    });
    const secondA = insertSnapshotGraph(db, graphA, {
      expectedActivationId: b.activationId
    });

    expect(secondA).toMatchObject({ snapshotId: firstA.snapshotId, reused: true });
    expect(secondA.activationId).not.toBe(firstA.activationId);
    expect(getSnapshotHead(db, firstA.repoId, "working_tree")).toMatchObject({
      activationId: secondA.activationId,
      snapshot: { id: firstA.snapshotId }
    });
    expect(listSnapshots(db, firstA.repoId)).toHaveLength(2);
  });

  it("uses activation generations to reject a stale writer even after an ABA cycle", () => {
    const graphA = { ...smallGraph("working_tree"), workspaceHash: sha256Hex("workspace-a") };
    const graphB = { ...smallGraph("working_tree"), workspaceHash: sha256Hex("workspace-b") };
    const graphC = { ...smallGraph("working_tree"), workspaceHash: sha256Hex("workspace-c") };
    const firstA = insertSnapshotGraph(db, graphA);
    const b = insertSnapshotGraph(db, graphB, { expectedActivationId: firstA.activationId });
    insertSnapshotGraph(db, graphA, { expectedActivationId: b.activationId });

    expect(() =>
      insertSnapshotGraph(db, graphC, { expectedActivationId: firstA.activationId })
    ).toThrow(SnapshotActivationConflictError);
    expect(getActiveSnapshot(db, firstA.repoId, "working_tree")?.id).toBe(firstA.snapshotId);
    expect(listSnapshots(db, firstA.repoId)).toHaveLength(2);
  });

  it("refuses to reuse a workspace hash when the immutable graph differs", () => {
    const firstGraph = {
      ...smallGraph("working_tree", sha256Hex("body-a")),
      workspaceHash: sha256Hex("same-workspace")
    };
    const conflictingGraph = {
      ...smallGraph("working_tree", sha256Hex("body-b")),
      workspaceHash: firstGraph.workspaceHash
    };
    const first = insertSnapshotGraph(db, firstGraph);

    expect(() => insertSnapshotGraph(db, conflictingGraph)).toThrow(/membership graph differs/);
    expect(getActiveSnapshot(db, first.repoId, "working_tree")?.id).toBe(first.snapshotId);
    expect(listSnapshots(db, first.repoId)).toHaveLength(1);
  });
});

describe("collision handling", () => {
  it("appends a collision index when a different canonical identity owns the key", () => {
    const repoId = insertSnapshotGraph(db, smallGraph()).repoId;
    const canonical = nodeCanonicalIdentity("function", "src/b.ts.beta");

    // Fabricate a true SHA-256 collision: another canonical identity already
    // holds this canonical identity's hash as its entity key.
    db.prepare(
      `INSERT INTO node_entities (repo_id, entity_key, canonical_identity, collision_index, kind, qualified_name)
       VALUES (?, ?, ?, 0, 'function', 'impostor')`
    ).run(repoId, entityKey(canonical), "node|function|impostor");

    const id = ensureNodeEntity(db, repoId, canonical, "function", "src/b.ts.beta");
    const row = db
      .prepare("SELECT entity_key, collision_index FROM node_entities WHERE id = ?")
      .get(id) as { entity_key: string; collision_index: number };

    expect(row.collision_index).toBe(1);
    expect(row.entity_key).toBe(entityKey(canonical, 1));
  });

  it("returns the existing entity for a repeated canonical identity", () => {
    const repoId = insertSnapshotGraph(db, smallGraph()).repoId;
    const canonical = nodeCanonicalIdentity("class", "src/c.ts.C");
    const first = ensureNodeEntity(db, repoId, canonical, "class", "src/c.ts.C");
    const second = ensureNodeEntity(db, repoId, canonical, "class", "src/c.ts.C");
    expect(second).toBe(first);
  });
});
