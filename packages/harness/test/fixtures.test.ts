import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compareFixtureSnapshot,
  fixtureSnapshotTargets,
  loadExpectedGraph,
  validateFixtures,
  type FixtureComparison,
  type FixtureSnapshotTarget
} from "@tadori/harness";

const repoRoot = path.resolve(__dirname, "../../..");

describe("expected-graph schema validation", () => {
  it("validates every fixture artifact (schema, hashes, endpoints, evidence)", () => {
    expect(validateFixtures(repoRoot)).toEqual([]);
  });

  it("loads each expected graph through the JSON schema", () => {
    for (const target of fixtureSnapshotTargets(repoRoot)) {
      const graph = loadExpectedGraph(repoRoot, target.expectedGraphPath);
      expect(graph.schemaVersion).toBe("1.0.0");
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
    }
  });

  it("verifies every expected edge endpoint exists in the same expected graph", () => {
    for (const target of fixtureSnapshotTargets(repoRoot)) {
      const graph = loadExpectedGraph(repoRoot, target.expectedGraphPath);
      const ids = new Set(graph.nodes.map((n) => n.id));
      for (const edge of graph.edges) {
        expect(ids.has(edge.src), `${target.fixtureId} ${edge.id} src`).toBe(true);
        expect(ids.has(edge.dst), `${target.fixtureId} ${edge.id} dst`).toBe(true);
      }
    }
  });
});

describe("golden fixture comparison (Weeks 1-2 milestone)", () => {
  const targets = fixtureSnapshotTargets(repoRoot);
  const comparisons = new Map<string, FixtureComparison>();

  beforeAll(() => {
    for (const target of targets) {
      comparisons.set(
        `${target.fixtureId}/${target.snapshot}`,
        compareFixtureSnapshot(repoRoot, target)
      );
    }
  });

  function comparisonFor(target: FixtureSnapshotTarget): FixtureComparison {
    const comparison = comparisons.get(`${target.fixtureId}/${target.snapshot}`);
    if (!comparison) {
      throw new Error(`No comparison ran for ${target.fixtureId}/${target.snapshot}`);
    }
    return comparison;
  }

  it.each(targets.map((t) => [`${t.fixtureId}/${t.snapshot}`, t] as const))(
    "%s matches expected nodes, edges, and metadata",
    (_label, target) => {
      const comparison = comparisonFor(target);
      expect(comparison.failures, comparison.failures.join("; ")).toEqual([]);
      expect(comparison.missingNodes).toEqual([]);
      expect(comparison.unexpectedNodes).toEqual([]);
      expect(comparison.nodeFieldMismatches).toEqual([]);
      expect(comparison.missingEdges).toEqual([]);
      expect(comparison.unexpectedEdges).toEqual([]);
      expect(comparison.edgeFieldMismatches).toEqual([]);
      expect(comparison.invalidEvidence).toEqual([]);
      expect(comparison.indexedFileMismatches).toEqual([]);
      expect(comparison.ok).toBe(true);
    }
  );

  it.each(targets.map((t) => [`${t.fixtureId}/${t.snapshot}`, t] as const))(
    "%s has zero dangling endpoints and zero foreign-key violations",
    (_label, target) => {
      const comparison = comparisonFor(target);
      expect(comparison.danglingEndpointCount).toBe(0);
      expect(comparison.foreignKeyViolationCount).toBe(0);
    }
  );

  it("explicitly reports every deferred relation instead of dropping it", () => {
    const core = comparisonFor(targets[0]!);
    const deferredNames = core.deferredRelations.map((d) => d.name);
    for (const relation of ["references", "calls", "implements", "tests", "documents"]) {
      expect(deferredNames.join(",")).toContain(relation);
    }
    // Deferred node kinds are reported too.
    expect(core.deferredNodeKinds.map((d) => d.name).sort()).toEqual(["adr", "test", "unresolved"]);
  });

  it("compares a meaningful number of nodes and edges per fixture", () => {
    for (const target of targets) {
      const comparison = comparisonFor(target);
      expect(comparison.comparedNodeCount).toBeGreaterThanOrEqual(10);
      expect(comparison.comparedEdgeCount).toBeGreaterThanOrEqual(20);
    }
  });
});
