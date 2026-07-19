import { mkdtempSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import path from "node:path";
import {
  edgeCanonicalIdentity,
  entityKey,
  nodeCanonicalIdentity,
  sha256Hex,
  type GraphEdge,
  type GraphNode,
  type Relation,
  type SnapshotGraph
} from "../packages/core/src/index.ts";
import {
  computeLayout,
  CURRENT_LAYOUT_VERSION,
  ensureLayout,
  insertSnapshotGraph,
  loadSnapshotGraph,
  openDatabase,
  readLayout,
  runMigrations,
  writeLayout,
  type LayoutEngineEdge,
  type LayoutEngineNode,
  type LayoutPosition
} from "../packages/store/src/index.ts";

const PACKAGE_NODE_COUNT = 500;
const SYMBOL_NODE_COUNT = 1_000;
const FULL_ITERATIONS = 200;
const RELAX_ITERATIONS = 50;
const WARMUP_RUNS = 1;
const SAMPLE_RUNS = 5;

const PACKAGE_FULL_BUDGET_MS = 2_000;
const SYMBOL_FULL_BUDGET_MS = 5_000;
const RELAX_BUDGET_MS = 250;
const WRITE_BUDGET_MS = 100;
const READ_BUDGET_MS = 50;
const FIRST_MATERIALIZATION_BUDGET_MS = 3_000;
const REUSE_BUDGET_MS = 100;

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate median of an empty sample");
  }
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2
    : (ordered[middle] as number);
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate p95 of an empty sample");
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] as number;
}

function packageNode(index: number): GraphNode {
  const qualifiedName = `benchmark-package-${String(index).padStart(4, "0")}`;
  const canonicalIdentity = nodeCanonicalIdentity("package", qualifiedName);
  return {
    kind: "package",
    qualifiedName,
    displayName: qualifiedName,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    file: null,
    exported: false,
    spanStart: null,
    spanEnd: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    bodyHash: null,
    evidence: []
  };
}

function semanticEdge(
  source: GraphNode,
  relation: Relation,
  destination: GraphNode
): GraphEdge {
  const canonicalIdentity = edgeCanonicalIdentity(
    source.entityKey,
    relation,
    destination.entityKey
  );
  return {
    srcEntityKey: source.entityKey,
    relation,
    dstEntityKey: destination.entityKey,
    canonicalIdentity,
    entityKey: entityKey(canonicalIdentity),
    origin: "compiler",
    confidence: "certain",
    resolution: "resolved",
    evidence: []
  };
}

function corpus(nodeCount: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = Array.from({ length: nodeCount }, (_, index) => packageNode(index));
  const edges: GraphEdge[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const source = nodes[index] as GraphNode;
    edges.push(semanticEdge(source, "imports", nodes[(index + 1) % nodes.length] as GraphNode));
    edges.push(semanticEdge(source, "references", nodes[(index + 7) % nodes.length] as GraphNode));
  }
  return { nodes, edges };
}

function engineEdges(edges: readonly GraphEdge[]): LayoutEngineEdge[] {
  return edges.map((edge) => ({
    entityKey: edge.entityKey,
    relation: edge.relation,
    srcEntityKey: edge.srcEntityKey,
    dstEntityKey: edge.dstEntityKey
  }));
}

function timeSamples(run: () => void): number[] {
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    run();
  }
  return Array.from({ length: SAMPLE_RUNS }, () => {
    const startedAt = performance.now();
    run();
    return performance.now() - startedAt;
  });
}

const packageCorpus = corpus(PACKAGE_NODE_COUNT);
const packageEngineNodes: LayoutEngineNode[] = packageCorpus.nodes.map((node) => ({
  entityKey: node.entityKey,
  fixedPosition: null,
  initialPosition: null
}));
const packageEngineEdges = engineEdges(packageCorpus.edges);
let packagePositions = new Map<string, { x: number; y: number }>();
const packageFullSamples = timeSamples(() => {
  packagePositions = computeLayout(packageEngineNodes, packageEngineEdges, {
    repoId: 1,
    level: "package",
    viewKey: "base",
    layoutVersion: CURRENT_LAYOUT_VERSION,
    iterations: FULL_ITERATIONS
  });
});

const symbolCorpus = corpus(SYMBOL_NODE_COUNT);
const symbolEngineNodes: LayoutEngineNode[] = symbolCorpus.nodes.map((node) => ({
  entityKey: node.entityKey,
  fixedPosition: null,
  initialPosition: null
}));
const symbolEngineEdges = engineEdges(symbolCorpus.edges);
const symbolFullSamples = timeSamples(() => {
  computeLayout(symbolEngineNodes, symbolEngineEdges, {
    repoId: 1,
    level: "symbol",
    viewKey: "base",
    layoutVersion: CURRENT_LAYOUT_VERSION,
    iterations: FULL_ITERATIONS
  });
});

const anchoredNodes: LayoutEngineNode[] = packageEngineNodes.map((node, index) => {
  const existing = packagePositions.get(node.entityKey);
  if (!existing) {
    throw new Error(`Package benchmark did not compute ${node.entityKey}`);
  }
  return index === packageEngineNodes.length - 1
    ? { entityKey: node.entityKey, fixedPosition: null, initialPosition: existing }
    : { entityKey: node.entityKey, fixedPosition: existing, initialPosition: null };
});
const relaxSamples = timeSamples(() => {
  computeLayout(anchoredNodes, packageEngineEdges, {
    repoId: 1,
    level: "package",
    viewKey: "base",
    layoutVersion: CURRENT_LAYOUT_VERSION,
    iterations: RELAX_ITERATIONS
  });
});

const tempRoot = mkdtempSync(path.join(tmpdir(), "tadori-layout-benchmark-"));
const db = openDatabase(path.join(tempRoot, "layout.sqlite"));
let writeSamples: number[] = [];
let readSamples: number[] = [];
let firstMaterializationSamples: number[] = [];
let reuseSamples: number[] = [];
try {
  runMigrations(db);
  const snapshotGraph: SnapshotGraph = {
    repoRootPath: tempRoot.split(path.sep).join("/"),
    kind: "working_tree",
    label: "layout-benchmark",
    baseCommitSha: null,
    workspaceHash: sha256Hex("layout-benchmark-workspace"),
    analyzerVersion: "layout-benchmark/1",
    files: [],
    nodes: packageCorpus.nodes,
    edges: packageCorpus.edges
  };
  const inserted = insertSnapshotGraph(db, snapshotGraph);
  const persisted: LayoutPosition[] = packageCorpus.nodes.map((node) => {
    const point = packagePositions.get(node.entityKey);
    if (!point) {
      throw new Error(`Package benchmark did not compute ${node.entityKey}`);
    }
    return {
      entityKey: node.entityKey,
      x: point.x,
      y: point.y,
      z: 0,
      pinned: false,
      anchorGroup: null
    };
  });
  writeSamples = timeSamples(() => {
    writeLayout(
      db,
      inserted.repoId,
      inserted.snapshotId,
      "package",
      "base",
      CURRENT_LAYOUT_VERSION,
      persisted,
      "replace"
    );
  });
  readSamples = timeSamples(() => {
    const layout = readLayout(
      db,
      inserted.repoId,
      inserted.snapshotId,
      "package",
      "base"
    );
    if (layout?.positions.length !== PACKAGE_NODE_COUNT) {
      throw new Error("Layout read benchmark returned an incomplete package slice");
    }
  });

  const storedGraph = loadSnapshotGraph(db, inserted.snapshotId);
  for (let index = 0; index < WARMUP_RUNS; index += 1) {
    ensureLayout(db, storedGraph, "package", `benchmark-first-warmup-${index}`);
  }
  firstMaterializationSamples = Array.from({ length: SAMPLE_RUNS }, (_, index) => {
    const startedAt = performance.now();
    const materialized = ensureLayout(db, storedGraph, "package", `benchmark-first-${index}`);
    const duration = performance.now() - startedAt;
    if (materialized.positions.length !== PACKAGE_NODE_COUNT) {
      throw new Error("First materialization benchmark returned an incomplete package slice");
    }
    return duration;
  });
  const reuseBaseline = ensureLayout(db, storedGraph, "package", "benchmark-first-0");
  reuseSamples = timeSamples(() => {
    const reused = ensureLayout(db, storedGraph, "package", "benchmark-first-0");
    if (reused.positions.length !== PACKAGE_NODE_COUNT) {
      throw new Error("Layout reuse benchmark returned an incomplete package slice");
    }
    if (reused.layoutVersion !== reuseBaseline.layoutVersion) {
      throw new Error("Layout reuse changed the layout version");
    }
    for (let index = 0; index < reused.positions.length; index += 1) {
      const before = reuseBaseline.positions[index];
      const after = reused.positions[index];
      if (
        before === undefined || after === undefined ||
        before.entityKey !== after.entityKey ||
        !Object.is(before.x, after.x) || !Object.is(before.y, after.y) ||
        !Object.is(before.z, after.z) || before.pinned !== after.pinned ||
        before.anchorGroup !== after.anchorGroup
      ) {
        throw new Error("Layout reuse changed persisted layout bytes");
      }
    }
  });
} finally {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
}

const result = {
  runtime: process.version,
  platform: `${process.platform}-${process.arch}`,
  processor: cpus()[0]?.model ?? "unknown",
  settings: {
    warmups: WARMUP_RUNS,
    samples: SAMPLE_RUNS,
    fullIterations: FULL_ITERATIONS,
    relaxIterations: RELAX_ITERATIONS
  },
  packageFull: {
    nodes: PACKAGE_NODE_COUNT,
    edges: packageEngineEdges.length,
    medianMs: median(packageFullSamples),
    p95Ms: percentile95(packageFullSamples),
    samplesMs: packageFullSamples,
    budgetMs: PACKAGE_FULL_BUDGET_MS
  },
  symbolFull: {
    nodes: SYMBOL_NODE_COUNT,
    edges: symbolEngineEdges.length,
    medianMs: median(symbolFullSamples),
    p95Ms: percentile95(symbolFullSamples),
    samplesMs: symbolFullSamples,
    budgetMs: SYMBOL_FULL_BUDGET_MS
  },
  anchoredRelaxation: {
    fixedNodes: PACKAGE_NODE_COUNT - 1,
    freeNodes: 1,
    edges: packageEngineEdges.length,
    medianMs: median(relaxSamples),
    p95Ms: percentile95(relaxSamples),
    samplesMs: relaxSamples,
    budgetMs: RELAX_BUDGET_MS
  },
  replaceWrite: {
    rows: PACKAGE_NODE_COUNT,
    medianMs: median(writeSamples),
    p95Ms: percentile95(writeSamples),
    samplesMs: writeSamples,
    budgetMs: WRITE_BUDGET_MS
  },
  orderedRead: {
    rows: PACKAGE_NODE_COUNT,
    medianMs: median(readSamples),
    p95Ms: percentile95(readSamples),
    samplesMs: readSamples,
    budgetMs: READ_BUDGET_MS
  },
  firstMaterialization: {
    rows: PACKAGE_NODE_COUNT,
    medianMs: median(firstMaterializationSamples),
    p95Ms: percentile95(firstMaterializationSamples),
    samplesMs: firstMaterializationSamples,
    budgetMs: FIRST_MATERIALIZATION_BUDGET_MS
  },
  byteIdenticalReuse: {
    rows: PACKAGE_NODE_COUNT,
    medianMs: median(reuseSamples),
    p95Ms: percentile95(reuseSamples),
    samplesMs: reuseSamples,
    budgetMs: REUSE_BUDGET_MS
  }
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

for (const [name, measurement] of [
  ["package full layout", result.packageFull],
  ["symbol full layout", result.symbolFull],
  ["anchored relaxation", result.anchoredRelaxation],
  ["replace write", result.replaceWrite]
] as const) {
  if (measurement.p95Ms >= measurement.budgetMs) {
    throw new Error(
      `${name} p95 ${measurement.p95Ms.toFixed(1)}ms exceeds ${measurement.budgetMs}ms`
    );
  }
}

for (const [name, measurement] of [
  ["ordered read", result.orderedRead],
  ["first materialization", result.firstMaterialization],
  ["byte-identical reuse", result.byteIdenticalReuse]
] as const) {
  if (measurement.p95Ms >= measurement.budgetMs) {
    throw new Error(
      `${name} p95 ${measurement.p95Ms.toFixed(1)}ms exceeds ${measurement.budgetMs}ms`
    );
  }
}
