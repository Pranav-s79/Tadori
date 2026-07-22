import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareFixtureSnapshot, formatComparison } from "./compare.js";
import { compareFixtureDiff } from "./compareDiff.js";
import { compareFixtureBoundaries } from "./compareBoundaries.js";
import { fixtureSnapshotTargets } from "./expected.js";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

let failed = false;
for (const target of fixtureSnapshotTargets(repoRoot)) {
  const comparison = compareFixtureSnapshot(repoRoot, target);
  console.log(formatComparison(comparison));
  console.log("");
  if (!comparison.ok) {
    failed = true;
  }
}

// Executed fixture-04 rename/move coalescing check (09-02): the concrete
// "un-defer" of the previously schema-only raw/coalesced diff artifacts.
const diff = compareFixtureDiff(repoRoot);
console.log(
  `Fixture ${diff.fixtureId} coalescing: ${diff.ok ? "PASS" : "FAIL"} — ` +
    `${diff.observed.stageAPairs} Stage-A + ${diff.observed.stageBPairs} Stage-B node pairs, ` +
    `${diff.observed.edgePairs} edge pairs, ${diff.observed.ambiguousGroups} ambiguous`
);
if (!diff.ok) {
  for (const failure of diff.failures) {
    console.error(`  - ${failure}`);
  }
  failed = true;
}
console.log("");

// Executed boundary-violation check (09-03): the concrete "un-defer" of the
// previously implicit "seeded boundary violations" note. Asserts every
// tadori.rules.json fixture reproduces its expectedBoundaryViolations exactly.
for (const boundary of compareFixtureBoundaries(repoRoot)) {
  console.log(
    `Fixture ${boundary.fixtureId} boundaries: ${boundary.ok ? "PASS" : "FAIL"} — ` +
      `${boundary.actualCount}/${boundary.expectedCount} violations`
  );
  if (!boundary.ok) {
    for (const failure of boundary.failures) {
      console.error(`  - ${failure}`);
    }
    failed = true;
  }
}
console.log("");

if (failed) {
  console.error("One or more fixture comparisons failed.");
  process.exit(1);
}
console.log("All fixture comparisons passed for the active milestone relation set.");
