import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSnapshotTargets } from "./expected.js";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const tscBin = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

let failed = false;
for (const target of fixtureSnapshotTargets(repoRoot)) {
  const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json", "--noEmit"], {
    cwd: target.sourceRoot,
    encoding: "utf8"
  });
  const label = `${target.fixtureId}/${target.snapshot}`;
  if (result.status === 0) {
    console.log(`[OK] tsc --noEmit ${label}`);
  } else {
    failed = true;
    console.error(`[FAIL] tsc --noEmit ${label}\n${result.stdout}${result.stderr}`);
  }
}
process.exit(failed ? 1 : 0);
