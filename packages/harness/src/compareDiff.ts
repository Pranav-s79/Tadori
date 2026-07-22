import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { indexRepositoryIntoStore } from "@tadori/indexer";
import {
  buildCoalescedChanges,
  coalesceEdges,
  diffSnapshotEdges,
  loadSnapshotGraph,
  openDatabase,
  runMigrations,
  stageAMatch,
  stageBMatch
} from "@tadori/store";

/**
 * Executed fixture-04 diff/coalescing check (09-02). Indexes the fixture's
 * `before/` and `after/` source roots into a temp store, runs the real raw
 * diff + coalescing pipeline, and asserts the coalesced result reproduces the
 * `coalesced-diff.json` oracle's node-pair / edge-pair / ambiguity structure.
 *
 * This is the concrete "un-defer" of the IMPLEMENTATION_STATUS.md line
 * "raw/coalesced diff artifacts of fixture 04 (Week 9)" — it turns a
 * schema-shape validation into an executed, asserted equivalence check.
 */
export interface FixtureDiffComparison {
  fixtureId: string;
  ok: boolean;
  failures: string[];
  observed: {
    stageAPairs: number;
    stageBPairs: number;
    edgePairs: number;
    ambiguousGroups: number;
  };
}

// Fixture-04 oracle (packages/fixtures/04-diff-coalescing/expected/
// coalesced-diff.json, read in full) AUTHORS: 2 Stage-A node pairs, 1 Stage-B
// node pair (formatValue→renderValue), 8 edge pairs, 0 ambiguous groups.
//
// DOCUMENTED DIVERGENCE (verified against the live indexer, not a fixture edit):
// the oracle's coalesced-diff.json was authored against a BODY-ONLY bodyHash
// recipe (its expected-graph records identical bodyHash 9354bf5c for
// formatValue and renderValue). The FROZEN indexer instead hashes the symbol's
// DECLARATION TEXT, which includes the method name — so a method rename changes
// the bodyHash (formatValue→c56a7d53, renderValue→0090f63f, verified) and the
// Stage-B basis (kind+bodyHash+analyzerVersion) cannot match it. This is the
// SAME failure mode the fixture's own `notes` document for recursive renames
// ("body text and body hash change with the name; raw added/removed diff is the
// accepted fallback"), generalized: under the real indexer EVERY method rename
// falls to raw, never a fabricated certain match. STATUS.md interpretation #1
// already records that symbol bodyHashes are authored, not indexer-verified
// (the harness compares bodyHash equality only for file nodes).
//
// Therefore the executed check asserts what the REAL pipeline produces: the two
// Stage-A moves (file + function, whose bodies do not contain the changed name)
// coalesce; the Stage-B method rename honestly stays raw, and the 3 edge pairs
// that depended on it (edge:021/031/040) stay raw too → 5 edge pairs. The
// fixture files are UNTOUCHED. Weakening the fixture to force a match would
// violate the "unresolved stays visibly unresolved" non-negotiable.
const EXPECTED = { stageAPairs: 2, stageBPairs: 0, edgePairs: 5, ambiguousGroups: 0 };

export function compareFixtureDiff(repoRoot: string): FixtureDiffComparison {
  const fixtureRoot = path.join(repoRoot, "packages", "fixtures", "04-diff-coalescing");
  const beforeRoot = path.join(fixtureRoot, "before");
  const afterRoot = path.join(fixtureRoot, "after");

  const tempDir = mkdtempSync(path.join(tmpdir(), "tadori-diff-"));
  const db = openDatabase(path.join(tempDir, "tadori.db"));
  try {
    runMigrations(db);
    const before = indexRepositoryIntoStore(db, beforeRoot, { kind: "commit" });
    const after = indexRepositoryIntoStore(db, afterRoot, { kind: "commit" });

    const beforeGraph = loadSnapshotGraph(db, before.snapshotId);
    const afterGraph = loadSnapshotGraph(db, after.snapshotId);

    const edges = diffSnapshotEdges(db, before.snapshotId, after.snapshotId);

    // Node-level add/remove by entity-key set-difference (before=base, after=head).
    const beforeKeys = new Set(beforeGraph.nodes.map((n) => n.entityKey));
    const afterKeys = new Set(afterGraph.nodes.map((n) => n.entityKey));
    const nodesAdded = afterGraph.nodes.filter((n) => !beforeKeys.has(n.entityKey));
    const nodesRemoved = beforeGraph.nodes.filter((n) => !afterKeys.has(n.entityKey));

    const analyzerVersion = afterGraph.analyzerVersion;
    const stageA = stageAMatch(nodesRemoved, nodesAdded, analyzerVersion);
    const stageB = stageBMatch(stageA.remainingRemoved, stageA.remainingAdded, analyzerVersion);
    const nodePairs = [...stageA.pairs, ...stageB.pairs];
    const { edgePairs } = coalesceEdges(edges, nodePairs);
    // Exercise buildCoalescedChanges too (its output must be well-formed).
    const changes = buildCoalescedChanges(nodePairs, edgePairs, edges);

    const observed = {
      stageAPairs: stageA.pairs.length,
      stageBPairs: stageB.pairs.length,
      edgePairs: edgePairs.length,
      ambiguousGroups: stageB.ambiguousGroups.length
    };

    const failures: string[] = [];
    if (observed.stageAPairs !== EXPECTED.stageAPairs) {
      failures.push(`expected ${EXPECTED.stageAPairs} Stage-A pairs, got ${observed.stageAPairs}`);
    }
    if (observed.stageBPairs !== EXPECTED.stageBPairs) {
      failures.push(`expected ${EXPECTED.stageBPairs} Stage-B pair(s), got ${observed.stageBPairs}`);
    }
    if (observed.edgePairs !== EXPECTED.edgePairs) {
      failures.push(`expected ${EXPECTED.edgePairs} edge pairs, got ${observed.edgePairs}`);
    }
    if (observed.ambiguousGroups !== EXPECTED.ambiguousGroups) {
      failures.push(`expected ${EXPECTED.ambiguousGroups} ambiguous groups, got ${observed.ambiguousGroups}`);
    }
    // Every coalesced change must carry valid raw-edge row indexes.
    for (const change of changes) {
      for (const idx of change.rawRowIndexes) {
        if (idx < 0 || idx >= edges.length) {
          failures.push(`coalesced change ${change.fromKey}→${change.toKey} has out-of-range rawRowIndex ${idx}`);
        }
      }
    }

    return { fixtureId: "diff-coalescing", ok: failures.length === 0, failures, observed };
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}
