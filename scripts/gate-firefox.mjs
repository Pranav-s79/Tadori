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
// `shell: true` must NOT be used here. On Windows it re-parses the argument
// vector through cmd.exe, which strips the quoting around the `bash -lc`
// script below: the container then ran a bare `set` — printing its environment
// and exercising nothing — while the remainder leaked back to the host shell,
// and the gate still reported "the KF-001 leg reproduced locally". A gate that
// lies about what it ran is worse than no gate. Naming the executable with its
// extension is what makes CreateProcess find it without a shell.
const dockerBinary = process.platform === "win32" ? "docker.exe" : "docker";

const dockerCheck = spawnSync(dockerBinary, ["info"], { stdio: "ignore" });
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
  // The repository is mounted read-only at /src and copied to /work, so the
  // container cannot write to the developer's checkout. Mounting it read-write
  // meant the in-container `pnpm install` announced "the modules directories
  // will be removed and reinstalled from scratch" and rebuilt the host's
  // node_modules with Linux binaries — breaking the Windows checkout that had
  // just asked to reproduce a Linux failure. tar's exclusions are unanchored,
  // so `node_modules` drops the host tree at every depth.
  "mkdir -p /work",
  "tar -C /src --exclude=node_modules --exclude=.git -cf - . | tar -C /work -xf -",
  "cd /work",
  "pnpm install --frozen-lockfile --prefer-offline",
  "pnpm package:artifact",
  // `xvfb-run` for the same reason CI uses it: Playwright's Firefox gets no
  // WebGL context in true headless mode on Linux, so without an X display the
  // Atlas renderer throws and the app falls back to Table mode. Keep this in
  // step with the `browser` job in .github/workflows/ci.yml — a local gate that
  // exercises a different environment than CI is worse than no local gate.
  "TADORI_PACKAGE_AUDIT=0 TADORI_PACKAGE_BROWSER=firefox xvfb-run -a pnpm package:smoke"
].join(" && ");

const run = spawnSync(dockerBinary, [
  "run", "--rm",
  // `--init` because bash execs the final command of the `&&` chain, which puts
  // `xvfb-run` at PID 1. A shell there does not reap the way it does elsewhere:
  // the smoke exited but xvfb-run never did, and the gate sat with only Xvfb
  // alive for an hour. tini takes PID 1 instead and the chain terminates. CI is
  // unaffected — there `xvfb-run` runs under the runner's shell, not as init.
  "--init",
  "-v", `${repoRoot}:/src:ro`,
  "-v", "tadori-pnpm-store:/root/.local/share/pnpm/store",
  "-w", "/",
  // Headless browsers crash on the small default /dev/shm in containers.
  "--shm-size=1g",
  image,
  "bash", "-lc", script
], { stdio: "inherit" });

if (run.status !== 0) {
  process.stdout.write(`\nFirefox gate FAILED (exit ${String(run.status)}).\n`);
  process.stdout.write("This is the KF-001 leg reproduced locally — read the readiness report above.\n");
  process.exit(run.status ?? 1);
}

process.stdout.write("\nFirefox gate passed. This is what CI's `browser` job runs.\n");
