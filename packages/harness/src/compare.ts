import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GraphEdge, GraphNode, NodeKind, Relation } from "@tadori/core";
import { indexRepositoryIntoStore, type IndexDiagnostic } from "@tadori/indexer";
import {
  findDanglingEndpoints,
  foreignKeyCheck,
  loadSnapshotGraph,
  openDatabase,
  runMigrations
} from "@tadori/store";
import {
  loadExpectedGraph,
  type ExpectedEdge,
  type ExpectedGraph,
  type ExpectedNode,
  type FixtureSnapshotTarget
} from "./expected.js";
import {
  DEFERRED_NODE_KINDS,
  DEFERRED_RELATIONS,
  isDeferredNodeKind,
  isDeferredRelation,
  isSupportedNodeKind,
  isSupportedRelation
} from "./milestone.js";

export interface FieldMismatch {
  entityKey: string;
  label: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface EvidenceProblem {
  edgeLabel: string;
  problem: string;
}

export interface DeferredCount {
  name: string;
  count: number;
}

export interface FixtureComparison {
  fixtureId: string;
  snapshot: string;
  ok: boolean;
  failures: string[];
  missingNodes: string[];
  unexpectedNodes: string[];
  nodeFieldMismatches: FieldMismatch[];
  missingEdges: string[];
  unexpectedEdges: string[];
  edgeFieldMismatches: FieldMismatch[];
  invalidEvidence: EvidenceProblem[];
  indexedFileMismatches: string[];
  danglingEndpointCount: number;
  foreignKeyViolationCount: number;
  deferredRelations: DeferredCount[];
  deferredNodeKinds: DeferredCount[];
  deferredChecks: string[];
  comparedNodeCount: number;
  comparedEdgeCount: number;
  indexDurationMs: number;
  diagnostics: IndexDiagnostic[];
}

/**
 * Evidence anchor policy. Fixture evidence anchors for `imports`, package
 * containment, and class/interface member containment sit on the structural
 * source line, so the actual evidence range must cover them. Anchors for
 * file-level containment and exports edges follow a first-occurrence-in-file
 * authoring convention (e.g. fixture 01 anchors `file contains
 * DoubleStrategy.run` at strategy.ts:2, the interface's `run` line), which
 * declaration-precise evidence cannot and should not reproduce; those anchors
 * are verified against the source text and the evidence file only. See
 * IMPLEMENTATION_STATUS.md ("Specification deviations").
 */
function anchorCoverageRequired(
  relation: Relation,
  srcKind: NodeKind | undefined
): boolean {
  if (relation === "imports") {
    return true;
  }
  if (relation === "contains") {
    return srcKind === "package" || srcKind === "class" || srcKind === "interface";
  }
  return false;
}

function edgeLabel(
  expected: ExpectedEdge,
  nodesById: Map<string, ExpectedNode>
): string {
  const src = nodesById.get(expected.src)?.qualifiedName ?? expected.src;
  const dst = nodesById.get(expected.dst)?.qualifiedName ?? expected.dst;
  return `${src} -${expected.relation}-> ${dst}`;
}

export function compareFixtureSnapshot(
  repoRoot: string,
  target: FixtureSnapshotTarget
): FixtureComparison {
  const expected = loadExpectedGraph(repoRoot, target.expectedGraphPath);

  const tempDir = mkdtempSync(path.join(tmpdir(), "tadori-harness-"));
  const dbPath = path.join(tempDir, "tadori.db");
  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
    const indexed = indexRepositoryIntoStore(db, target.sourceRoot, { kind: "commit" });
    const stored = loadSnapshotGraph(db, indexed.snapshotId);

    const comparison = compareGraphs(expected, {
      fixtureId: target.fixtureId,
      snapshot: target.snapshot,
      sourceRoot: target.sourceRoot,
      nodes: stored.nodes,
      edges: stored.edges,
      indexedFilePaths: stored.files.map((f) => f.normalizedPath),
      diagnostics: indexed.diagnostics,
      indexDurationMs: indexed.durationMs
    });

    comparison.danglingEndpointCount = findDanglingEndpoints(db, indexed.snapshotId).length;
    comparison.foreignKeyViolationCount = foreignKeyCheck(db).length;
    if (comparison.danglingEndpointCount > 0) {
      comparison.failures.push(
        `${comparison.danglingEndpointCount} snapshot edge(s) have dangling endpoint memberships`
      );
    }
    if (comparison.foreignKeyViolationCount > 0) {
      comparison.failures.push(
        `PRAGMA foreign_key_check returned ${comparison.foreignKeyViolationCount} row(s)`
      );
    }
    comparison.ok = comparison.failures.length === 0;
    return comparison;
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

interface ActualGraphInput {
  fixtureId: string;
  snapshot: string;
  sourceRoot: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  indexedFilePaths: string[];
  diagnostics: IndexDiagnostic[];
  indexDurationMs: number;
}

export function compareGraphs(
  expected: ExpectedGraph,
  actual: ActualGraphInput
): FixtureComparison {
  const failures: string[] = [];
  const result: FixtureComparison = {
    fixtureId: actual.fixtureId,
    snapshot: actual.snapshot,
    ok: false,
    failures,
    missingNodes: [],
    unexpectedNodes: [],
    nodeFieldMismatches: [],
    missingEdges: [],
    unexpectedEdges: [],
    edgeFieldMismatches: [],
    invalidEvidence: [],
    indexedFileMismatches: [],
    danglingEndpointCount: 0,
    foreignKeyViolationCount: 0,
    deferredRelations: [],
    deferredNodeKinds: [],
    deferredChecks: [],
    comparedNodeCount: 0,
    comparedEdgeCount: 0,
    indexDurationMs: actual.indexDurationMs,
    diagnostics: actual.diagnostics
  };

  const expectedNodesById = new Map(expected.nodes.map((n) => [n.id, n]));
  const expectedNodesByKey = new Map(expected.nodes.map((n) => [n.entityKey, n]));
  const actualNodesByKey = new Map(actual.nodes.map((n) => [n.entityKey, n]));
  const actualEdgesByKey = new Map(actual.edges.map((e) => [e.entityKey, e]));

  // ---- milestone strata sanity: every declared stratum is either supported
  // or explicitly deferred; anything else means a relation would disappear
  // without being tested or deferred, which is a hard failure.
  for (const relation of expected.fixture.relationStrata) {
    if (!isSupportedRelation(relation) && !isDeferredRelation(relation)) {
      failures.push(
        `Relation stratum ${JSON.stringify(relation)} is neither tested in this milestone nor explicitly deferred`
      );
    }
  }

  // ---- indexedFiles contract
  const expectedFiles = [...expected.fixture.indexedFiles].sort();
  const actualFiles = [...actual.indexedFilePaths].sort();
  for (const missing of expectedFiles.filter((f) => !actualFiles.includes(f))) {
    result.indexedFileMismatches.push(`missing indexed file: ${missing}`);
  }
  for (const extra of actualFiles.filter((f) => !expectedFiles.includes(f))) {
    result.indexedFileMismatches.push(`unexpected indexed file: ${extra}`);
  }
  if (result.indexedFileMismatches.length > 0) {
    failures.push(`indexedFiles mismatch (${result.indexedFileMismatches.length} difference(s))`);
  }

  // ---- node comparison over milestone kinds
  const deferredNodeCounts = new Map<string, number>();
  for (const expectedNode of expected.nodes) {
    if (!isSupportedNodeKind(expectedNode.kind)) {
      if (!isDeferredNodeKind(expectedNode.kind)) {
        failures.push(
          `Expected node kind ${expectedNode.kind} is neither supported nor deferred`
        );
      }
      deferredNodeCounts.set(
        expectedNode.kind,
        (deferredNodeCounts.get(expectedNode.kind) ?? 0) + 1
      );
      continue;
    }
    result.comparedNodeCount += 1;
    const actualNode = actualNodesByKey.get(expectedNode.entityKey);
    if (!actualNode) {
      result.missingNodes.push(`${expectedNode.kind} ${expectedNode.qualifiedName}`);
      continue;
    }
    const label = `${expectedNode.kind} ${expectedNode.qualifiedName}`;
    const checks: Array<[string, unknown, unknown]> = [
      ["kind", expectedNode.kind, actualNode.kind],
      ["qualifiedName", expectedNode.qualifiedName, actualNode.qualifiedName],
      ["displayName", expectedNode.displayName, actualNode.displayName],
      ["canonicalIdentity", expectedNode.canonicalIdentity, actualNode.canonicalIdentity],
      ["file", expectedNode.file, actualNode.file],
      ["exported", expectedNode.exported, actualNode.exported]
    ];
    // File-node body hashes follow the frozen recipe (SHA-256 of the raw
    // bytes) and must match exactly. Symbol body hashes are analyzer-defined
    // (see IMPLEMENTATION_STATUS.md); require presence, not equality.
    if (expectedNode.kind === "file" && expectedNode.bodyHash !== undefined) {
      checks.push(["bodyHash", expectedNode.bodyHash, actualNode.bodyHash]);
    } else if (expectedNode.bodyHash !== undefined) {
      checks.push(["bodyHash present", true, actualNode.bodyHash !== null]);
    }
    for (const [field, exp, act] of checks) {
      if (exp !== act) {
        result.nodeFieldMismatches.push({
          entityKey: expectedNode.entityKey,
          label,
          field,
          expected: exp,
          actual: act
        });
      }
    }
  }

  // ---- unexpected actual nodes
  for (const actualNode of actual.nodes) {
    if (!expectedNodesByKey.has(actualNode.entityKey)) {
      result.unexpectedNodes.push(`${actualNode.kind} ${actualNode.qualifiedName}`);
    }
  }

  // ---- edge comparison over milestone relations with milestone endpoints
  const deferredRelationCounts = new Map<string, number>();
  const sourceTextCache = new Map<string, string[]>();
  const sourceLines = (relPath: string): string[] | null => {
    const cached = sourceTextCache.get(relPath);
    if (cached) {
      return cached;
    }
    try {
      const lines = readFileSync(path.join(actual.sourceRoot, relPath), "utf8").split(/\r?\n/);
      sourceTextCache.set(relPath, lines);
      return lines;
    } catch {
      return null;
    }
  };

  for (const expectedEdge of expected.edges) {
    const srcNode = expectedNodesById.get(expectedEdge.src);
    const dstNode = expectedNodesById.get(expectedEdge.dst);
    const label = edgeLabel(expectedEdge, expectedNodesById);
    if (!srcNode || !dstNode) {
      failures.push(`Expected edge ${expectedEdge.id} has an endpoint alias missing from the expected graph`);
      continue;
    }
    const inMilestone =
      isSupportedRelation(expectedEdge.relation) &&
      isSupportedNodeKind(srcNode.kind) &&
      isSupportedNodeKind(dstNode.kind);
    if (!inMilestone) {
      const reason = isSupportedRelation(expectedEdge.relation)
        ? `${expectedEdge.relation} (deferred ${srcNode.kind}->${dstNode.kind} endpoints)`
        : expectedEdge.relation;
      deferredRelationCounts.set(reason, (deferredRelationCounts.get(reason) ?? 0) + 1);
      continue;
    }

    result.comparedEdgeCount += 1;
    const actualEdge = actualEdgesByKey.get(expectedEdge.entityKey);
    if (!actualEdge) {
      result.missingEdges.push(label);
      continue;
    }
    for (const [field, exp, act] of [
      ["relation", expectedEdge.relation, actualEdge.relation],
      ["canonicalIdentity", expectedEdge.canonicalIdentity, actualEdge.canonicalIdentity],
      ["origin", expectedEdge.origin, actualEdge.origin],
      ["confidence", expectedEdge.confidence, actualEdge.confidence],
      ["resolution", expectedEdge.resolution, actualEdge.resolution]
    ] as Array<[string, unknown, unknown]>) {
      if (exp !== act) {
        result.edgeFieldMismatches.push({
          entityKey: expectedEdge.entityKey,
          label,
          field,
          expected: exp,
          actual: act
        });
      }
    }

    // ---- evidence checks
    if (actualEdge.evidence.length === 0) {
      result.invalidEvidence.push({ edgeLabel: label, problem: "actual edge has no evidence" });
    }
    for (const evidence of actualEdge.evidence) {
      const lines = sourceLines(evidence.file);
      if (!lines) {
        result.invalidEvidence.push({
          edgeLabel: label,
          problem: `actual evidence file ${evidence.file} is unreadable`
        });
        continue;
      }
      const lineCount = Math.max(1, lines.length - (lines.at(-1) === "" ? 1 : 0));
      if (evidence.lineStart < 1 || evidence.lineEnd > lineCount) {
        result.invalidEvidence.push({
          edgeLabel: label,
          problem: `actual evidence range ${evidence.lineStart}-${evidence.lineEnd} exceeds ${evidence.file} (${lineCount} lines)`
        });
      }
    }
    for (const anchor of expectedEdge.evidence) {
      const lines = sourceLines(anchor.file);
      const anchorLineText = lines?.[anchor.line - 1];
      if (anchorLineText === undefined || !anchorLineText.includes(anchor.contains)) {
        result.invalidEvidence.push({
          edgeLabel: label,
          problem: `expected anchor ${anchor.file}:${anchor.line} does not contain ${JSON.stringify(anchor.contains)}`
        });
        continue;
      }
      const sameFile = actualEdge.evidence.filter((e) => e.file === anchor.file);
      if (sameFile.length === 0) {
        result.invalidEvidence.push({
          edgeLabel: label,
          problem: `no actual evidence in expected file ${anchor.file}`
        });
        continue;
      }
      if (anchorCoverageRequired(expectedEdge.relation, srcNode.kind)) {
        const covered = sameFile.some(
          (e) => e.lineStart <= anchor.line && anchor.line <= e.lineEnd
        );
        if (!covered) {
          result.invalidEvidence.push({
            edgeLabel: label,
            problem: `no actual evidence range covers anchor ${anchor.file}:${anchor.line}`
          });
        }
      }
    }
  }

  // ---- unexpected actual edges
  const expectedEdgesByKey = new Map(expected.edges.map((e) => [e.entityKey, e]));
  for (const actualEdge of actual.edges) {
    if (!expectedEdgesByKey.has(actualEdge.entityKey)) {
      const src = actualNodesByKey.get(actualEdge.srcEntityKey)?.qualifiedName ?? "?";
      const dst = actualNodesByKey.get(actualEdge.dstEntityKey)?.qualifiedName ?? "?";
      result.unexpectedEdges.push(`${src} -${actualEdge.relation}-> ${dst}`);
    }
  }

  // ---- the analyzer must emit no deferred-relation edges at all
  for (const actualEdge of actual.edges) {
    if (!isSupportedRelation(actualEdge.relation)) {
      failures.push(
        `Analyzer emitted deferred relation ${actualEdge.relation}; the active milestone must not emit it`
      );
    }
  }

  // ---- excluded candidates that are checkable in this milestone
  for (const candidate of expected.excludedCandidates) {
    if (candidate.kind === "variable" && typeof candidate.file === "string") {
      const name = typeof candidate.name === "string" ? candidate.name : null;
      const offending = actual.nodes.find(
        (n) => n.file === candidate.file && (name === null || n.displayName === name)
      );
      const variableNode = offending && offending.kind !== "file" ? offending : undefined;
      if (variableNode) {
        failures.push(
          `Excluded candidate appeared: variable ${String(candidate.name)} in ${String(candidate.file)}`
        );
      }
    }
  }

  result.deferredRelations = [...deferredRelationCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  result.deferredNodeKinds = [...deferredNodeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  result.deferredChecks = [
    `boundary violations (${expected.expectedBoundaryViolations.length} expected) - boundary enforcement is a later milestone`,
    `excluded candidates other than variables (${expected.excludedCandidates.filter((c) => c.kind !== "variable").length}) - covered by deferred extractors`,
    ...(DEFERRED_RELATIONS.length > 0
      ? [`deferred relations for this milestone: ${DEFERRED_RELATIONS.join(", ")}`]
      : []),
    `deferred node kinds for this milestone: ${DEFERRED_NODE_KINDS.join(", ")}`
  ];

  if (result.missingNodes.length > 0) {
    failures.push(`${result.missingNodes.length} missing node(s)`);
  }
  if (result.unexpectedNodes.length > 0) {
    failures.push(`${result.unexpectedNodes.length} unexpected node(s)`);
  }
  if (result.nodeFieldMismatches.length > 0) {
    failures.push(`${result.nodeFieldMismatches.length} node field mismatch(es)`);
  }
  if (result.missingEdges.length > 0) {
    failures.push(`${result.missingEdges.length} missing edge(s)`);
  }
  if (result.unexpectedEdges.length > 0) {
    failures.push(`${result.unexpectedEdges.length} unexpected edge(s)`);
  }
  if (result.edgeFieldMismatches.length > 0) {
    failures.push(`${result.edgeFieldMismatches.length} edge field mismatch(es)`);
  }
  if (result.invalidEvidence.length > 0) {
    failures.push(`${result.invalidEvidence.length} invalid evidence finding(s)`);
  }

  result.ok = failures.length === 0;
  return result;
}

export function formatComparison(comparison: FixtureComparison): string {
  const lines: string[] = [];
  const status = comparison.ok ? "PASS" : "FAIL";
  lines.push(
    `[${status}] ${comparison.fixtureId}/${comparison.snapshot}: ` +
      `${comparison.comparedNodeCount} nodes, ${comparison.comparedEdgeCount} edges compared ` +
      `(index ${comparison.indexDurationMs.toFixed(0)} ms)`
  );
  const listAll = (title: string, items: string[]): void => {
    if (items.length > 0) {
      lines.push(`  ${title}:`);
      for (const item of items) {
        lines.push(`    - ${item}`);
      }
    }
  };
  listAll("failures", comparison.failures);
  listAll("missing nodes", comparison.missingNodes);
  listAll("unexpected nodes", comparison.unexpectedNodes);
  listAll(
    "node field mismatches",
    comparison.nodeFieldMismatches.map(
      (m) => `${m.label} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`
    )
  );
  listAll("missing edges", comparison.missingEdges);
  listAll("unexpected edges", comparison.unexpectedEdges);
  listAll(
    "edge field mismatches",
    comparison.edgeFieldMismatches.map(
      (m) => `${m.label} ${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`
    )
  );
  listAll(
    "invalid evidence",
    comparison.invalidEvidence.map((e) => `${e.edgeLabel}: ${e.problem}`)
  );
  listAll("indexed-file mismatches", comparison.indexedFileMismatches);
  lines.push(
    `  dangling endpoints: ${comparison.danglingEndpointCount}; foreign_key_check rows: ${comparison.foreignKeyViolationCount}`
  );
  if (comparison.deferredRelations.length > 0) {
    lines.push(
      `  deferred expected relations: ${comparison.deferredRelations
        .map((d) => `${d.name} (${d.count})`)
        .join(", ")}`
    );
  }
  if (comparison.deferredNodeKinds.length > 0) {
    lines.push(
      `  deferred expected node kinds: ${comparison.deferredNodeKinds
        .map((d) => `${d.name} (${d.count})`)
        .join(", ")}`
    );
  }
  for (const check of comparison.deferredChecks) {
    lines.push(`  deferred check: ${check}`);
  }
  if (comparison.diagnostics.length > 0) {
    lines.push("  analyzer diagnostics:");
    for (const d of comparison.diagnostics) {
      lines.push(`    - ${d.file ?? "<repo>"}: ${d.message}`);
    }
  }
  return lines.join("\n");
}
