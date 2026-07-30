import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const workspaceRoot = process.cwd();
const packageRoot = path.join(workspaceRoot, "dist", "package");
const fixtureRoot = path.join(workspaceRoot, "packages", "bench", "fixtures", "mixed-oracle");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "tadori-package-smoke-"));
const packRoot = path.join(temporaryRoot, "pack");
const installRoot = path.join(temporaryRoot, "install");
const repository = path.join(temporaryRoot, "repository");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, options = {}) {
  const usesWindowsCommandShim = process.platform === "win32" && command.endsWith(".cmd");
  const executable = usesWindowsCommandShim ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = usesWindowsCommandShim ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
    ...options
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function waitFor(check, timeoutMs, description) {
  const startedAt = Date.now();
  for (;;) {
    const value = await check();
    if (value !== null) return value;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await delay(100);
  }
}

async function responseJson(url) {
  const response = await globalThis.fetch(url);
  assert.equal(response.ok, true, `${url} returned ${String(response.status)}`);
  return response.json();
}

let server = null;
let failure = null;
try {
  assert.equal(existsSync(path.join(packageRoot, "package.json")), true, "Run pnpm package:artifact first");
  const packageManifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(packageManifest.license, "UNLICENSED");
  assert.equal(packageManifest.repository.url, "git+https://github.com/Pranav-s79/Tadori.git");
  assert.equal(existsSync(path.join(packageRoot, "README.md")), true);
  cpSync(fixtureRoot, repository, { recursive: true });
  mkdirSync(packRoot, { recursive: true });

  const packed = JSON.parse(run(npmCommand, [
    "pack",
    "--json",
    "--pack-destination",
    packRoot,
    packageRoot
  ]));
  assert.equal(packed.length, 1);
  const tarball = path.join(packRoot, packed[0].filename);
  assert.equal(existsSync(tarball), true);

  run(npmCommand, ["install", "--prefix", installRoot, "--no-audit", "--no-fund", tarball]);
  if (process.env.TADORI_PACKAGE_AUDIT !== "0") {
    run(npmCommand, ["audit", "--prefix", installRoot, "--omit=dev", "--audit-level=moderate"]);
  }
  const cli = path.join(installRoot, "node_modules", "tadori", "bin", "tadori.mjs");
  assert.equal(existsSync(cli), true);

  const diff = JSON.parse(run(process.execPath, [cli, "diff", repository]));
  assert.equal(diff.repoRoot, repository.split(path.sep).join("/"));
  assert.equal(Number.isInteger(diff.headSnapshotId), true);
  assert.equal(Array.isArray(diff.edges), true);

  let stdout = "";
  let stderr = "";
  let closed = false;
  server = spawn(process.execPath, [cli, "serve", repository, "--no-open"], {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => { stdout += chunk; });
  server.stderr.on("data", (chunk) => { stderr += chunk; });
  server.once("close", () => { closed = true; });

  const url = await waitFor(() => {
    if (closed) throw new Error(`Installed server exited before startup:\n${stderr}`);
    return stdout.match(/URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1] ?? null;
  }, 90_000, "installed server startup");

  const indexResponse = await globalThis.fetch(url);
  assert.equal(indexResponse.ok, true);
  const indexHtml = await indexResponse.text();
  assert.match(indexHtml, /<div id="root"><\/div>/);
  const assetPath = indexHtml.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
  assert.notEqual(assetPath, undefined);
  const assetResponse = await globalThis.fetch(new URL(assetPath, url));
  assert.equal(assetResponse.ok, true);

  const snapshot = await responseJson(new URL("api/v1/snapshot", url));
  assert.equal(Number.isInteger(snapshot.context.snapshotId), true);
  const nodes = await responseJson(new URL("api/v1/nodes?level=file&limit=500", url));
  const python = nodes.items.find((node) => node.language === "python");
  assert.notEqual(python, undefined, "mixed-language artifact smoke did not expose Python");
  assert.equal(python.provenance.capability, "repository");
  const symbols = await responseJson(new URL(
    `api/v1/nodes?level=symbol&file=${encodeURIComponent(python.file)}&limit=1000`,
    url
  ));
  const structuralPython = symbols.items.find((node) => node.language === "python");
  assert.notEqual(structuralPython, undefined, "Python file exposed no structural symbols");
  assert.equal(structuralPython.provenance.capability, "structural");
  assert.equal(structuralPython.provenance.derivation, "parser-derived");
  assert.equal(typeof structuralPython.provenance.extractorId, "string");
  const layout = await responseJson(new URL("api/v1/layout?level=package", url));
  assert.equal(Array.isArray(layout.positions), true);
  assert.equal(layout.positions.length > 0, true);

  const exit = new Promise((resolve) => server.once("exit", (code, signal) => resolve({ code, signal })));
  server.kill(process.platform === "win32" ? "SIGTERM" : "SIGINT");
  const stopped = await waitFor(async () => closed ? await exit : null, 30_000, "installed server shutdown");
  if (process.platform !== "win32") assert.equal(stopped.code, 0, stderr);
  server = null;

  const protectedFile = path.join(repository, "README.md");
  const protectedContents = readFileSync(protectedFile, "utf8");
  const purgeOutput = run(process.execPath, [cli, "purge", repository]);
  assert.match(purgeOutput, /Purged \.tadori data/);
  assert.equal(existsSync(path.join(repository, ".tadori")), false);
  assert.equal(readFileSync(protectedFile, "utf8"), protectedContents);

  process.stdout.write(`Installed package smoke passed on ${process.platform} ${process.version}.\n`);
} catch (error) {
  failure = error;
} finally {
  const cleanupFailures = [];
  if (server !== null && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    if (!server.kill("SIGKILL")) {
      cleanupFailures.push(new Error(`Failed to terminate smoke server process ${String(server.pid)}`));
    } else {
      try {
        await Promise.race([
          exited,
          delay(10_000).then(() => {
            throw new Error(`Timed out terminating smoke server process ${String(server.pid)}`);
          })
        ]);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
  }
  try {
    rmSync(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    failure = failure === null
      ? new AggregateError(cleanupFailures, "Package smoke cleanup failed")
      : new AggregateError([failure, ...cleanupFailures], "Package smoke and cleanup failed");
  }
}

if (failure !== null) throw failure;
