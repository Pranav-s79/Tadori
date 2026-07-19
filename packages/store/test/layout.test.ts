import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@tadori/core";
import { MultiUndirectedGraph } from "graphology";
import * as forceAtlas2Module from "graphology-layout-forceatlas2";
import {
  CURRENT_LAYOUT_VERSION,
  computeLayout,
  deriveLayoutSeed,
  ensureLayout,
  insertSnapshotGraph,
  loadSnapshotGraph,
  openDatabase,
  readLayout,
  runMigrations,
  writeLayout,
  type Database,
  type LayoutEngineEdge,
  type LayoutEngineNode,
  type LayoutPosition
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

function graphWithFiles(paths: string[], root = "C:/virtual/layout-repo") {
  const pkg = makeNode("package", "test-pkg", null);
  const files = paths.map((path) => makeFile(path));
  const fileNodes = paths.map((path) => makeNode("file", path, path));
  const symbols = paths.map((path) => makeNode("function", `${path}.run`, path));
  const edges = [
    ...fileNodes.map((fileNode) => makeEdge(pkg, "contains", fileNode)),
    ...fileNodes.map((fileNode, index) => makeEdge(fileNode, "contains", symbols[index]!)),
    ...symbols.slice(1).map((symbol, index) => makeEdge(symbols[index]!, "calls", symbol))
  ];
  return makeGraph({ repoRootPath: root, files, nodes: [pkg, ...fileNodes, ...symbols], edges });
}

function storedGraph(paths = ["src/a.ts"], root?: string) {
  const result = insertSnapshotGraph(db, graphWithFiles(paths, root));
  return { result, graph: loadSnapshotGraph(db, result.snapshotId) };
}

function position(entityKey: string, x: number, y: number): LayoutPosition {
  return { entityKey, x, y, z: 0, pinned: false, anchorGroup: null };
}

function engineFixture(): { nodes: LayoutEngineNode[]; edges: LayoutEngineEdge[] } {
  const keys = ["a", "b", "c"].map(sha256Hex);
  return {
    nodes: keys.map((entityKey) => ({ entityKey, fixedPosition: null, initialPosition: null })),
    edges: [
      {
        entityKey: sha256Hex("edge-a-b"),
        relation: "calls",
        srcEntityKey: keys[0]!,
        dstEntityKey: keys[1]!
      },
      {
        entityKey: sha256Hex("edge-a-b-imports"),
        relation: "imports",
        srcEntityKey: keys[0]!,
        dstEntityKey: keys[1]!
      },
      {
        entityKey: sha256Hex("edge-b-c"),
        relation: "references",
        srcEntityKey: keys[1]!,
        dstEntityKey: keys[2]!
      }
    ]
  };
}

const options = {
  repoId: 1,
  level: "symbol" as const,
  viewKey: "base",
  layoutVersion: 1,
  iterations: 20
};
const forceAtlas2 = forceAtlas2Module.default as unknown as
  (typeof import("graphology-layout-forceatlas2"))["default"];

describe("deterministic layout engine", () => {
  it("derives stable, input-sensitive seeds", () => {
    const seed = deriveLayoutSeed(1, "package", "base", 1);
    expect(deriveLayoutSeed(1, "package", "base", 1)).toBe(seed);
    expect(new Set([
      seed,
      deriveLayoutSeed(2, "package", "base", 1),
      deriveLayoutSeed(1, "file", "base", 1),
      deriveLayoutSeed(1, "package", "detail", 1),
      deriveLayoutSeed(1, "package", "base", 2)
    ]).size).toBe(5);
  });

  it("is byte-deterministic across node and edge permutations while retaining multiedges", () => {
    const fixture = engineFixture();
    const first = computeLayout(fixture.nodes, fixture.edges, options);
    const second = computeLayout([...fixture.nodes].reverse(), [...fixture.edges].reverse(), options);
    expect([...first.keys()]).toEqual([...second.keys()]);
    for (const [key, point] of first) {
      expect(Object.is(point.x, second.get(key)!.x)).toBe(true);
      expect(Object.is(point.y, second.get(key)!.y)).toBe(true);
    }
  });

  it("uses fixed anchors but returns only free nodes", () => {
    const fixture = engineFixture();
    const anchored = fixture.nodes.map((node, index) =>
      index === 0 ? { ...node, fixedPosition: { x: 123.5, y: -44.25 } } : node
    );
    const result = computeLayout(anchored, fixture.edges, options);
    expect(result.has(anchored[0]!.entityKey)).toBe(false);
    expect(result.size).toBe(2);
  });

  it("makes fixed-anchor coordinates affect connected free-node output", () => {
    const fixture = engineFixture();
    const anchorKey = fixture.nodes[0]!.entityKey;
    const withAnchorAtLeft = computeLayout(fixture.nodes.map((node) =>
      node.entityKey === anchorKey
        ? { ...node, fixedPosition: { x: -100, y: 0 } }
        : node
    ), fixture.edges, options);
    const withAnchorAtRight = computeLayout(fixture.nodes.map((node) =>
      node.entityKey === anchorKey
        ? { ...node, fixedPosition: { x: 100, y: 0 } }
        : node
    ), fixture.edges, options);
    const connectedKey = fixture.nodes[1]!.entityKey;
    expect(withAnchorAtLeft.get(connectedKey)).not.toEqual(withAnchorAtRight.get(connectedKey));
  });

  it("keeps graphology 0.10.1 fixed coordinates bit-exact", () => {
    const graph = new MultiUndirectedGraph<{ x: number; y: number; fixed?: boolean }, { weight: number }>();
    const anchorX = 123.5;
    const anchorY = -44.25;
    graph.addNode("anchor", { x: anchorX, y: anchorY, fixed: true });
    graph.addNode("free", { x: 0, y: 0 });
    graph.addUndirectedEdgeWithKey("edge", "anchor", "free", { weight: 1 });
    forceAtlas2.assign(graph, {
      iterations: 50,
      settings: { ...({
        adjustSizes: false,
        barnesHutOptimize: false,
        edgeWeightInfluence: 1,
        gravity: 1,
        linLogMode: false,
        outboundAttractionDistribution: false,
        scalingRatio: 10,
        slowDown: 1,
        strongGravityMode: false
      }) },
      getEdgeWeight: () => 1
    });
    expect(Object.is(graph.getNodeAttribute("anchor", "x"), anchorX)).toBe(true);
    expect(Object.is(graph.getNodeAttribute("anchor", "y"), anchorY)).toBe(true);
  });

  it("handles empty, singleton, and all-fixed graphs", () => {
    expect(computeLayout([], [], options).size).toBe(0);
    const key = sha256Hex("single");
    const single = computeLayout([{
      entityKey: key, fixedPosition: null, initialPosition: { x: 4, y: 5 }
    }], [], options);
    expect(single.get(key)).toEqual({ x: 4, y: 5 });
    expect(
      computeLayout([{
        entityKey: key, fixedPosition: { x: 4, y: 5 }, initialPosition: null
      }], [], options).size
    ).toBe(0);
  });

  it("rejects malformed topology and coordinates", () => {
    const key = sha256Hex("node");
    expect(() => computeLayout([
      { entityKey: key, fixedPosition: { x: 0, y: 0 }, initialPosition: { x: 1, y: 1 } }
    ], [], options)).toThrow(/both fixed and initial/);
    expect(() => computeLayout([{
      entityKey: key, fixedPosition: null, initialPosition: { x: Number.NaN, y: 0 }
    }], [], options))
      .toThrow(/finite/);
    expect(() => computeLayout([{
      entityKey: key, fixedPosition: null, initialPosition: null
    }], [{
      entityKey: sha256Hex("bad-edge"), relation: "calls", srcEntityKey: key,
      dstEntityKey: sha256Hex("missing")
    }], options)).toThrow(/outside the node set/);
    expect(() => computeLayout([], [{
      entityKey: sha256Hex("edge-with-empty-node-set"),
      relation: "calls",
      srcEntityKey: key,
      dstEntityKey: sha256Hex("other-node")
    }], options)).toThrow(/outside the node set/);
    expect(() => computeLayout([
      { entityKey: key, fixedPosition: null, initialPosition: null },
      { entityKey: key, fixedPosition: null, initialPosition: null }
    ], [], options)).toThrow(/duplicate layout node/);
    const duplicateEdge = {
      entityKey: sha256Hex("duplicate-edge"),
      relation: "calls" as const,
      srcEntityKey: key,
      dstEntityKey: key
    };
    expect(() => computeLayout([
      { entityKey: key, fixedPosition: null, initialPosition: null }
    ], [duplicateEdge, duplicateEdge], options)).toThrow(/duplicate layout edge/);
  });

  it("ignores semantic self-edges without changing deterministic output", () => {
    const fixture = engineFixture();
    const baseline = computeLayout(fixture.nodes, fixture.edges, options);
    const selfEdge: LayoutEngineEdge = {
      entityKey: sha256Hex("self-edge"),
      relation: "calls",
      srcEntityKey: fixture.nodes[0]!.entityKey,
      dstEntityKey: fixture.nodes[0]!.entityKey
    };
    expect(computeLayout(fixture.nodes, [...fixture.edges, selfEdge], options)).toEqual(baseline);
  });
});

describe("layout persistence", () => {
  it("round-trips exact floats, metadata, and byte-identical reloads", () => {
    const { result, graph } = storedGraph();
    const file = graph.nodes.find((node) => node.kind === "file")!;
    const exact = {
      entityKey: file.entityKey,
      x: 1.23456789012345,
      y: -9.87654321098765,
      z: 0,
      pinned: true,
      anchorGroup: "primary"
    };
    writeLayout(db, result.repoId, result.snapshotId, "file", "base", 1, [exact], "replace");
    const first = readLayout(db, result.repoId, result.snapshotId, "file", "base")!;
    const second = readLayout(db, result.repoId, result.snapshotId, "file", "base")!;
    expect(first).toEqual({ positions: [exact], layoutVersion: 1 });
    expect(Object.is(first.positions[0]!.x, second.positions[0]!.x)).toBe(true);
    expect(Object.is(first.positions[0]!.y, second.positions[0]!.y)).toBe(true);
  });

  it("returns null before materialization and empty ensure without a marker row", () => {
    const empty = insertSnapshotGraph(db, makeGraph({ files: [], nodes: [], edges: [] }));
    const graph = loadSnapshotGraph(db, empty.snapshotId);
    expect(readLayout(db, empty.repoId, empty.snapshotId, "package", "base")).toBeNull();
    expect(ensureLayout(db, graph, "package")).toEqual({
      positions: [], layoutVersion: CURRENT_LAYOUT_VERSION
    });
    const count = db.prepare("SELECT COUNT(*) AS count FROM layout_positions").get() as { count: number };
    expect(count.count).toBe(0);
  });

  it("preserves historical positions when the current snapshot is empty or disjoint", () => {
    const first = storedGraph();
    const file = first.graph.nodes.find((node) => node.kind === "file")!;
    writeLayout(db, first.result.repoId, first.result.snapshotId, "file", "base", 1,
      [position(file.entityKey, 3, 4)], "replace");
    const emptyPayload = makeGraph({
      repoRootPath: "C:/virtual/layout-repo",
      workspaceHash: sha256Hex("empty-next-snapshot"),
      files: [], nodes: [], edges: []
    });
    const empty = insertSnapshotGraph(db, emptyPayload);
    expect(ensureLayout(db, loadSnapshotGraph(db, empty.snapshotId), "file")).toEqual({
      positions: [], layoutVersion: CURRENT_LAYOUT_VERSION
    });
    const count = db.prepare("SELECT COUNT(*) AS count FROM layout_positions WHERE repo_id = ?")
      .get(first.result.repoId) as { count: number };
    expect(count.count).toBe(1);

    const disjointPayload = graphWithFiles(["src/b.ts"]);
    disjointPayload.workspaceHash = sha256Hex("disjoint-next-snapshot");
    const disjoint = insertSnapshotGraph(db, disjointPayload);
    expect(ensureLayout(db, loadSnapshotGraph(db, disjoint.snapshotId), "file").positions)
      .toHaveLength(1);
    const afterDisjoint = db
      .prepare(
        `SELECT ne.entity_key
         FROM layout_positions AS lp
         JOIN node_entities AS ne ON ne.id = lp.node_id
         WHERE lp.repo_id = ? AND lp.abstraction_level = 'file'
         ORDER BY ne.entity_key`
      )
      .all(first.result.repoId) as Array<{ entity_key: string }>;
    expect(afterDisjoint.map((row) => row.entity_key).sort()).toEqual([
      file.entityKey,
      disjointPayload.nodes.find((node) => node.kind === "file")!.entityKey
    ].sort());
  });

  it("replace removes the prior slice while append_missing never overwrites", () => {
    const { result, graph } = storedGraph(["src/a.ts", "src/b.ts"]);
    const files = graph.nodes.filter((node) => node.kind === "file");
    writeLayout(db, result.repoId, result.snapshotId, "file", "base", 1, [
      position(files[0]!.entityKey, 1, 2), position(files[1]!.entityKey, 3, 4)
    ], "replace");
    const beforeConflict = readLayout(db, result.repoId, result.snapshotId, "file", "base")!;
    expect(() => writeLayout(db, result.repoId, result.snapshotId, "file", "base", 1, [
      position(files[0]!.entityKey, 99, 99)
    ], "append_missing")).toThrow(/UNIQUE constraint/);
    const afterConflict = readLayout(db, result.repoId, result.snapshotId, "file", "base")!;
    expect(afterConflict).toEqual(beforeConflict);
    for (let index = 0; index < beforeConflict.positions.length; index += 1) {
      expect(Object.is(afterConflict.positions[index]!.x, beforeConflict.positions[index]!.x)).toBe(true);
      expect(Object.is(afterConflict.positions[index]!.y, beforeConflict.positions[index]!.y)).toBe(true);
      expect(Object.is(afterConflict.positions[index]!.z, beforeConflict.positions[index]!.z)).toBe(true);
    }
    writeLayout(db, result.repoId, result.snapshotId, "file", "base", 2, [
      position(files[0]!.entityKey, 6, 7), position(files[1]!.entityKey, 8, 9)
    ], "replace");
    expect(readLayout(db, result.repoId, result.snapshotId, "file", "base")).toEqual({
      positions: [
        position(files[0]!.entityKey, 6, 7), position(files[1]!.entityKey, 8, 9)
      ].sort((left, right) => left.entityKey.localeCompare(right.entityKey)),
      layoutVersion: 2
    });
  });

  it("validates snapshot ownership, status, membership, level, and finite 2D positions", () => {
    const first = storedGraph(["src/a.ts"], "C:/virtual/first");
    const second = storedGraph(["src/b.ts"], "C:/virtual/second");
    const firstFile = first.graph.nodes.find((node) => node.kind === "file")!;
    const secondFile = second.graph.nodes.find((node) => node.kind === "file")!;
    expect(() => readLayout(db, second.result.repoId, first.result.snapshotId, "file", "base"))
      .toThrow(/does not belong/);
    expect(() => writeLayout(db, first.result.repoId, first.result.snapshotId, "file", "base", 1,
      [position(secondFile.entityKey, 0, 0)], "replace")).toThrow(/unknown entity key/);
    expect(() => writeLayout(db, first.result.repoId, first.result.snapshotId, "package", "base", 1,
      [position(firstFile.entityKey, 0, 0)], "replace")).toThrow(/unknown entity key/);
    expect(() => writeLayout(db, first.result.repoId, first.result.snapshotId, "file", "base", 1,
      [position(firstFile.entityKey, Number.POSITIVE_INFINITY, 0)], "replace")).toThrow(/finite/);
    expect(() => readLayout(
      db, first.result.repoId, first.result.snapshotId, "bogus" as "file", "base"
    )).toThrow(/invalid layout level/);
    db.prepare("UPDATE repository_snapshots SET status = 'pruned' WHERE id = ?")
      .run(first.result.snapshotId);
    expect(() => readLayout(db, first.result.repoId, first.result.snapshotId, "file", "base"))
      .toThrow(/not active/);
  });

  it("rolls back the complete replace batch on a bad member", () => {
    const { result, graph } = storedGraph();
    const file = graph.nodes.find((node) => node.kind === "file")!;
    writeLayout(db, result.repoId, result.snapshotId, "file", "base", 1,
      [position(file.entityKey, 1, 2)], "replace");
    expect(() => writeLayout(db, result.repoId, result.snapshotId, "file", "base", 2, [
      position(file.entityKey, 8, 9), position(sha256Hex("unknown"), 10, 11)
    ], "replace")).toThrow(/unknown entity key/);
    expect(readLayout(db, result.repoId, result.snapshotId, "file", "base")!.positions[0])
      .toEqual(position(file.entityKey, 1, 2));
  });

  it("rolls back deletion and earlier inserts when a later replace insert fails", () => {
    const { result, graph } = storedGraph(["src/a.ts", "src/b.ts"]);
    const files = graph.nodes.filter((node) => node.kind === "file");
    writeLayout(db, result.repoId, result.snapshotId, "file", "base", 1, [
      position(files[0]!.entityKey, 1, 2), position(files[1]!.entityKey, 3, 4)
    ], "replace");
    const baseline = readLayout(db, result.repoId, result.snapshotId, "file", "base")!;
    const failingNode = db.prepare("SELECT id FROM node_entities WHERE entity_key = ?")
      .get(files[1]!.entityKey) as { id: number };
    db.exec(
      `CREATE TRIGGER fail_second_layout_insert
       BEFORE INSERT ON layout_positions
       WHEN NEW.node_id = ${failingNode.id}
       BEGIN
         SELECT RAISE(ABORT, 'injected layout insert failure');
       END`
    );
    expect(() => writeLayout(db, result.repoId, result.snapshotId, "file", "base", 2, [
      position(files[0]!.entityKey, 8, 9), position(files[1]!.entityKey, 10, 11)
    ], "replace")).toThrow(/injected layout insert failure/);
    expect(readLayout(db, result.repoId, result.snapshotId, "file", "base")).toEqual(baseline);
  });

  it("rolls back an append batch when SQLite ignores a later insert", () => {
    const { result, graph } = storedGraph(["src/a.ts", "src/b.ts"]);
    const files = graph.nodes.filter((node) => node.kind === "file");
    const ignoredNode = db.prepare("SELECT id FROM node_entities WHERE entity_key = ?")
      .get(files[1]!.entityKey) as { id: number };
    db.exec(
      `CREATE TRIGGER ignore_second_layout_insert
       BEFORE INSERT ON layout_positions
       WHEN NEW.node_id = ${ignoredNode.id}
       BEGIN
         SELECT RAISE(IGNORE);
       END`
    );
    expect(() => writeLayout(db, result.repoId, result.snapshotId, "file", "base", 1, [
      position(files[0]!.entityKey, 1, 2), position(files[1]!.entityKey, 3, 4)
    ], "append_missing")).toThrow(/was not inserted/);
    expect(readLayout(db, result.repoId, result.snapshotId, "file", "base")).toBeNull();
  });

  it("detects mixed versions in the current snapshot slice", () => {
    const { result, graph } = storedGraph(["src/a.ts", "src/b.ts"]);
    const files = graph.nodes.filter((node) => node.kind === "file");
    writeLayout(db, result.repoId, result.snapshotId, "file", "base", 1,
      files.map((node, index) => position(node.entityKey, index, index)), "replace");
    const nodeId = db.prepare("SELECT id FROM node_entities WHERE entity_key = ?")
      .get(files[1]!.entityKey) as { id: number };
    db.prepare("UPDATE layout_positions SET layout_version = 2 WHERE node_id = ?").run(nodeId.id);
    expect(() => readLayout(db, result.repoId, result.snapshotId, "file", "base"))
      .toThrow(/mixed layout versions/);
  });

  it("rejects non-finite or non-planar coordinates read from corrupted storage", () => {
    const { result, graph } = storedGraph();
    ensureLayout(db, graph, "file");
    db.prepare("UPDATE layout_positions SET x = 9e999 WHERE repo_id = ?")
      .run(result.repoId);
    expect(() => readLayout(db, result.repoId, result.snapshotId, "file", "base"))
      .toThrow(/invalid coordinates/);
    expect(() => ensureLayout(db, graph, "file")).toThrow(/invalid coordinates/);
    db.prepare("UPDATE layout_positions SET x = 0, z = 7 WHERE repo_id = ?")
      .run(result.repoId);
    expect(() => readLayout(db, result.repoId, result.snapshotId, "file", "base"))
      .toThrow(/invalid coordinates/);
  });
});

describe("layout orchestration", () => {
  it("materializes all three representative levels with stable ordering", () => {
    const { graph } = storedGraph(["src/a.ts", "src/b.ts"]);
    expect(ensureLayout(db, graph, "package").positions).toHaveLength(1);
    expect(ensureLayout(db, graph, "file").positions).toHaveLength(2);
    expect(ensureLayout(db, graph, "symbol").positions).toHaveLength(2);
    const fileReload = ensureLayout(db, graph, "file");
    expect(fileReload.positions.map((entry) => entry.entityKey)).toEqual(
      [...fileReload.positions.map((entry) => entry.entityKey)].sort()
    );
  });

  it("replaces old and mixed versions with one current-version slice", () => {
    const { result, graph } = storedGraph(["src/a.ts", "src/b.ts"]);
    ensureLayout(db, graph, "file");
    const before = readLayout(db, result.repoId, result.snapshotId, "file", "base")!;
    const pinnedKey = before.positions[0]!.entityKey;
    const pinnedNode = db.prepare("SELECT id FROM node_entities WHERE repo_id = ? AND entity_key = ?")
      .get(result.repoId, pinnedKey) as { id: number };
    const pinnedX = 111.1234567890123;
    const pinnedY = -222.9876543210987;
    db.prepare(
      `UPDATE layout_positions
       SET x = ?, y = ?, pinned = 1, anchor_group = 'manual', layout_version = 0
       WHERE repo_id = ? AND node_id = ?`
    ).run(pinnedX, pinnedY, result.repoId, pinnedNode.id);
    const replaced = ensureLayout(db, graph, "file");
    expect(replaced.layoutVersion).toBe(CURRENT_LAYOUT_VERSION);
    const pinnedAfter = replaced.positions.find((position) => position.entityKey === pinnedKey)!;
    expect(Object.is(pinnedAfter.x, pinnedX)).toBe(true);
    expect(Object.is(pinnedAfter.y, pinnedY)).toBe(true);
    expect(pinnedAfter.pinned).toBe(true);
    expect(pinnedAfter.anchorGroup).toBe("manual");
    const versions = db.prepare("SELECT DISTINCT layout_version FROM layout_positions WHERE repo_id = ?")
      .all(result.repoId) as Array<{ layout_version: number }>;
    expect(versions).toEqual([{ layout_version: CURRENT_LAYOUT_VERSION }]);
  });

  it("adds new snapshot members without changing existing stored bytes", () => {
    const firstInsert = insertSnapshotGraph(db, graphWithFiles(["src/a.ts"]));
    const firstGraph = loadSnapshotGraph(db, firstInsert.snapshotId);
    const first = ensureLayout(db, firstGraph, "file");
    const secondPayload = graphWithFiles(["src/a.ts", "src/b.ts"]);
    secondPayload.workspaceHash = sha256Hex("expanded-layout-snapshot");
    const secondInsert = insertSnapshotGraph(db, secondPayload);
    const secondGraph = loadSnapshotGraph(db, secondInsert.snapshotId);
    const second = ensureLayout(db, secondGraph, "file");
    const oldKey = first.positions[0]!.entityKey;
    const oldAfter = second.positions.find((entry) => entry.entityKey === oldKey)!;
    expect(Object.is(first.positions[0]!.x, oldAfter.x)).toBe(true);
    expect(Object.is(first.positions[0]!.y, oldAfter.y)).toBe(true);
    expect(second.positions).toHaveLength(2);
    const added = second.positions.find((entry) => entry.entityKey !== oldKey)!;
    expect(Math.hypot(added.x - first.positions[0]!.x, added.y - first.positions[0]!.y))
      .toBeLessThanOrEqual(25 + Number.EPSILON * 100);
  });

  it("rejects a StoredSnapshotGraph whose membership was altered by the caller", () => {
    const { graph } = storedGraph();
    const altered = { ...graph, nodes: graph.nodes.slice(1) };
    expect(() => ensureLayout(db, altered, "file")).toThrow(/node membership/);
    expect(() => ensureLayout(db, {
      ...graph,
      snapshot: { ...graph.snapshot, label: "tampered" }
    }, "file")).toThrow(/metadata/);
  });

  it("rejects ambiguous file-node path ownership in an otherwise stored graph", () => {
    const path = "src/a.ts";
    const pkg = makeNode("package", "test-pkg", null);
    const firstFile = makeNode("file", path, path);
    const secondFile = makeNode("file", `${path}#alternate`, path);
    const inserted = insertSnapshotGraph(db, makeGraph({
      files: [makeFile(path)],
      nodes: [pkg, firstFile, secondFile],
      edges: []
    }));
    expect(() => ensureLayout(db, loadSnapshotGraph(db, inserted.snapshotId), "file"))
      .toThrow(/duplicate file-node path/);
  });

  it("refuses to materialize an active snapshot with dangling endpoints", () => {
    const { result, graph } = storedGraph();
    const symbol = graph.nodes.find((node) => node.kind === "function")!;
    const symbolId = db
      .prepare("SELECT id FROM node_entities WHERE repo_id = ? AND entity_key = ?")
      .get(result.repoId, symbol.entityKey) as { id: number };
    db.prepare("DELETE FROM snapshot_nodes WHERE snapshot_id = ? AND node_id = ?")
      .run(result.snapshotId, symbolId.id);

    const corrupted = loadSnapshotGraph(db, result.snapshotId);
    expect(() => ensureLayout(db, corrupted, "file")).toThrow(/dangling endpoints/);
    const count = db.prepare("SELECT COUNT(*) AS count FROM layout_positions").get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  });
});
