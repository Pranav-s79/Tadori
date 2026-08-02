// Reproduce CI's Ubuntu + headless-Firefox smoke locally, in Docker.
//
// KF-001 has never reproduced on Windows or macOS, so every hypothesis about it
// has cost a ~10-minute remote round trip and several were wrong. That loop is
// the actual blocker, not the defect. This runs the same gate against the same
// OS and browser build CI uses, so the loop becomes seconds.
//
// The image tag tracks the pinned `playwright-core` version in package.json —
// a mismatched image ships a different Firefox build, which would defeat the
// point of reproducing the environment.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const playwrightVersion = manifest.devDependencies?.["playwright-core"]
  ?? manifest.dependencies?.["playwright-core"];

if (playwrightVersion === undefined) {
  process.stderr.write("Could not read the pinned playwright-core version from package.json.\n");
  process.exit(1);
}

const image = `mcr.microsoft.com/playwright:v${playwrightVersion.replace(/^[^0-9]*/u, "")}-noble`;

// A missing Docker must not look like a pass. `pnpm --filter` exiting 0 for an
// absent script already cost this project a gate that reported PASS while
// checking nothing; this exits non-zero and says exactly what is missing.
const dockerCheck = spawnSync("docker", ["info"], { stdio: "ignore", shell: process.platform === "win32" });
if (dockerCheck.status !== 0) {
  process.stderr.write(
    "docker is required for the Firefox gate and is not available.\n"
    + "Start Docker Desktop (or install Docker) and re-run `pnpm gate:firefox`.\n"
    + "This is NOT a pass: KF-001's leg has not been exercised.\n"
  );
  process.exit(1);
}

process.stdout.write(`Running the Ubuntu/Firefox smoke in ${image}\n`);

// corepack enables the pinned pnpm inside the container; the store is kept in a
// named volume so repeat runs do not re-download the dependency graph.
const script = [
  "set -e",
  "corepack enable",
  "cd /work",
  "pnpm install --frozen-lockfile --prefer-offline",
  "pnpm package:artifact",
  "TADORI_PACKAGE_AUDIT=0 TADORI_PACKAGE_BROWSER=firefox pnpm package:smoke"
].join(" && ");

const run = spawnSync("docker", [
  "run", "--rm",
  "-v", `${repoRoot}:/work`,
  "-v", "tadori-pnpm-store:/root/.local/share/pnpm/store",
  "-w", "/work",
  // Headless browsers crash on the small default /dev/shm in containers.
  "--shm-size=1g",
  image,
  "bash", "-lc", script
], { stdio: "inherit", shell: process.platform === "win32" });

if (run.status !== 0) {
  process.stdout.write(`\nFirefox gate FAILED (exit ${String(run.status)}).\n`);
  process.stdout.write("This is the KF-001 leg reproduced locally — read the readiness report above.\n");
  process.exit(run.status ?? 1);
}

process.stdout.write("\nFirefox gate passed. This is what CI's `browser` job runs.\n");
