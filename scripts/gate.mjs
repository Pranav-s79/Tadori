// The local mirror of CI's `verify` job.
//
// This exists because the alternative was demonstrated: running a subset
// (`vitest` + `tsc`) locally, pushing, and discovering lint, axe, and browser
// assertions remotely one 10-minute round trip at a time. Every step below has
// failed in CI at least once while a partial local check said the tree was fine.
//
// Run it before every push. `--fast` skips the slow packaging steps for an
// inner-loop check; the full run is what CI actually does.

import { spawnSync } from "node:child_process";
import process from "node:process";

const fast = process.argv.includes("--fast");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** Steps in CI order. `slow` ones are skipped by --fast, never by CI. */
const steps = [
  { name: "skills:check", cmd: pnpm, args: ["skills:check"] },
  { name: "typecheck", cmd: pnpm, args: ["typecheck"] },
  // The root tsconfig scopes to packages/*, so the Atlas app is not covered by
  // the step above. Note pnpm exits 0 when a filtered script does not exist, so
  // this is only meaningful while apps/viz actually defines `typecheck`.
  { name: "viz typecheck", cmd: pnpm, args: ["--filter", "@tadori/viz", "typecheck"] },
  { name: "lint", cmd: pnpm, args: ["lint"] },
  { name: "test", cmd: pnpm, args: ["test"], slow: true },
  { name: "fixtures:validate", cmd: pnpm, args: ["fixtures:validate"], slow: true },
  { name: "fixtures:index", cmd: pnpm, args: ["fixtures:index"], slow: true },
  { name: "fixtures:typecheck", cmd: pnpm, args: ["fixtures:typecheck"], slow: true },
  { name: "package:artifact", cmd: pnpm, args: ["package:artifact"], slow: true },
  { name: "package:smoke", cmd: pnpm, args: ["package:smoke"], slow: true },
  { name: "git diff --check", cmd: "git", args: ["diff", "--check"] }
];

const results = [];
let failed = null;

for (const step of steps) {
  if (fast && step.slow === true) {
    results.push({ name: step.name, status: "skipped (--fast)" });
    continue;
  }
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const run = spawnSync(step.cmd, step.args, { stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) {
    results.push({ name: step.name, status: `FAILED (exit ${String(run.status)})` });
    failed = step.name;
    break;
  }
  results.push({ name: step.name, status: "ok" });
}

process.stdout.write("\n-------- gate summary --------\n");
for (const result of results) {
  const mark = result.status === "ok" ? "PASS" : result.status.startsWith("FAILED") ? "FAIL" : "SKIP";
  process.stdout.write(`  ${mark}  ${result.name}\n`);
}

if (failed !== null) {
  process.stdout.write(`\nGate failed at: ${failed}\nDo not push until this is green.\n`);
  process.exit(1);
}

process.stdout.write(fast
  ? "\nFast gate passed. Run `pnpm gate` in full before pushing.\n"
  : "\nGate passed. This is what CI's `verify` job runs.\n");
