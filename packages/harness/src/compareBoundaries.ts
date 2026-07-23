import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { indexRepositoryIntoStore } from "@tadori/indexer";
import {
  computeBoundaryViolations,
  loadSnapshotGraph,
  openDatabase,
  parseBoundaryRules,
  runMigrations,
  type BoundaryViolation
} from "@tadori/store";
import { fixtureSnapshotTargets, loadExpectedGraph, type ExpectedBoundaryViolation } from "./expected.js";

/**
 * Executed boundary-violation check (09-03): the concrete "un-defer" of the
 * previously implicit "seeded boundary violations" harness note. For every
 * fixture whose source root ships a `tadori.rules.json`, index it, compute
 * violations with the real store algorithm, and assert set-equality against the
 * expected graph's `expectedBoundaryViolations` oracle (by ruleId+src+dst+
 * relation+severity). Fixture files are the oracle; nothing is weakened.
 */
export interface FixtureBoundaryComparison {
  fixtureId: string;
  ok: boolean;
  failures: string[];
  expectedCount: number;
  actualCount: number;
}

/** Stable comparison key for a violation. */
function vkey(v: { ruleId: string; src: string; dst: string; edgeRelation: string; severity: string }): string {
  return `${v.ruleId}|${v.src}|${v.dst}|${v.edgeRelation}|${v.severity}`;
}

export function compareFixtureBoundaries(repoRoot: string): FixtureBoundaryComparison[] {
  const results: FixtureBoundaryComparison[] = [];
  for (const target of fixtureSnapshotTargets(repoRoot)) {
    const rulesPath = path.join(target.sourceRoot, "tadori.rules.json");
    if (!existsSync(rulesPath)) {
      continue; // no boundary rules declared for this fixture snapshot
    }
    const expected = loadExpectedGraph(repoRoot, target.expectedGraphPath);
    const rules = parseBoundaryRules(JSON.parse(readFileSync(rulesPath, "utf8")));

    const tempDir = mkdtempSync(path.join(tmpdir(), "tadori-bound-"));
    const db = openDatabase(path.join(tempDir, "tadori.db"));
    let actual: BoundaryViolation[];
    try {
      runMigrations(db);
      const indexed = indexRepositoryIntoStore(db, target.sourceRoot, { kind: "commit" });
      const graph = loadSnapshotGraph(db, indexed.snapshotId);
      actual = computeBoundaryViolations(rules, graph.nodes, graph.edges);
    } finally {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    }

    const failures = diffViolations(expected.expectedBoundaryViolations, actual);
    results.push({
      fixtureId: target.fixtureId,
      ok: failures.length === 0,
      failures,
      expectedCount: expected.expectedBoundaryViolations.length,
      actualCount: actual.length
    });
  }
  return results;
}

/** Set-difference two violation lists by key; report missing + unexpected. */
function diffViolations(
  expected: readonly ExpectedBoundaryViolation[],
  actual: readonly BoundaryViolation[]
): string[] {
  const expectedKeys = new Set(expected.map((v) => vkey(v)));
  const actualKeys = new Set(actual.map((v) => vkey(v)));
  const failures: string[] = [];
  for (const v of expected) {
    if (!actualKeys.has(vkey(v))) {
      failures.push(`missing expected violation: ${vkey(v)}`);
    }
  }
  for (const v of actual) {
    if (!expectedKeys.has(vkey(v))) {
      failures.push(`unexpected violation: ${vkey(v)}`);
    }
  }
  return failures;
}
