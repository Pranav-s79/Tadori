import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareFixtureSnapshot, formatComparison } from "./compare.js";
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

if (failed) {
  console.error("One or more fixture comparisons failed.");
  process.exit(1);
}
console.log("All fixture comparisons passed for the active milestone relation set.");
