/* global document, getComputedStyle, performance, location */
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

async function verifyInstalledGui(url, engine) {
  const playwright = await import("playwright-core");
  const browserType = playwright[engine];
  assert.notEqual(browserType, undefined, `Unsupported TADORI_PACKAGE_BROWSER: ${engine}`);
  // Sigma renders through WebGL, and headless Firefox on Linux ships with it
  // effectively unavailable. Without these prefs the app takes its (correct)
  // renderer-error path and falls back to Table mode, which hides the canvas
  // and makes the keyboard-descent check unreachable rather than failing
  // honestly. Enabling WebGL exercises the real Atlas instead of asserting
  // against a fallback. Chromium ignores unknown Firefox prefs.
  const browser = await browserType.launch({
    headless: true,
    firefoxUserPrefs: engine === "firefox"
      ? { "webgl.disabled": false, "webgl.force-enabled": true, "gfx.webrender.all": true }
      : undefined
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const browserErrors = [];
    const failedRequests = [];
    page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`);
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const canvas = page.locator(".package-map-canvas");
    await canvas.waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForFunction(() => {
      const surface = document.querySelector(".package-map-canvas");
      const canvases = [...(surface?.querySelectorAll("canvas") ?? [])];
      return canvases.some((item) => item.width > 0 && item.height > 0)
        && !(document.body.textContent?.includes("Loading repository graph") ?? false);
    });

    assert.equal(await page.title(), "Tadori");
    const modeNames = await page.getByRole("tablist", { name: "Repository views" })
      .getByRole("tab").allTextContents();
    assert.deepEqual(modeNames.map((name) => name.trim()), ["Atlas", "Story", "Changes", "Table"]);
    const showing = page.locator(".atlas-context-bar span").filter({ hasText: /^Showing / });
    const initialCount = Number(/^Showing (\d+)/.exec(await showing.textContent() ?? "")?.[1] ?? 0);
    assert.ok(initialCount > 0, `${engine} rendered no package nodes from the installed artifact`);

    // Keyboard descent must work, but WHICH node the first ArrowRight lands on
    // is not part of any contract: it is `graph.nodes().sort()[0]`, and the
    // frozen keyboard contract is "Enter descends OR inspects". A node with no
    // children correctly inspects and leaves the count unchanged, so assuming
    // the alphabetically-first node is descendable makes this gate depend on
    // path ordering, which differs across platforms. Walk the nodes instead and
    // require that SOME node descends -- the property actually being asserted.
    // The canvas must actually hold focus before any key means anything. A bare
    // locator.focus() did not land in headless Firefox on Linux -- the failure
    // reported activeElement as "" while the renderer was healthy (41 canvases,
    // no browser errors) -- so keydown never reached the container's listener
    // and descent was unreachable. Focus through the DOM and assert it took:
    // a map canvas that cannot receive focus is an accessibility defect and
    // should say so rather than time out. locator.press() below then focuses
    // and presses atomically instead of trusting focus to persist.
    await canvas.evaluate((element) => { element.focus(); });
    const focusedClass = await page.evaluate(() => document.activeElement?.className ?? "");
    assert.ok(
      focusedClass.includes("package-map-canvas"),
      `${engine} could not focus the Atlas canvas, so keyboard descent is ` +
        `unreachable (activeElement class: ${JSON.stringify(focusedClass)})`
    );
    const readShowing = () => page.evaluate(() => {
      const value = [...document.querySelectorAll(".atlas-context-bar span")]
        .find((node) => node.textContent?.startsWith("Showing "))?.textContent ?? "";
      return Number(/^Showing (\d+)/.exec(value)?.[1] ?? 0);
    });
    let expandedCount = initialCount;
    for (let attempt = 0; attempt < initialCount && expandedCount === initialCount; attempt += 1) {
      await canvas.press("ArrowRight");
      await canvas.press("Enter");
      // Descent is a lazy fetch; poll briefly rather than racing a single read.
      for (let settle = 0; settle < 20 && expandedCount === initialCount; settle += 1) {
        await page.waitForTimeout(250);
        expandedCount = await readShowing();
      }
    }
    if (expandedCount === initialCount) {
      // Browser errors and failed requests are asserted at the end of this
      // function, so failing here would discard exactly the evidence that
      // explains the failure. Report it inline instead of guessing remotely.
      const focusState = await page.evaluate(() => {
        const surface = document.querySelector(".package-map-canvas");
        return {
          focusedNode: surface?.dataset.focusedNode ?? null,
          activeElement: document.activeElement?.className ?? null,
          canvasCount: surface?.querySelectorAll("canvas").length ?? 0
        };
      });
      assert.fail(
        `${engine} keyboard descent expanded no node from the installed artifact ` +
          `(still ${initialCount} of ${initialCount})\n` +
          `focus state: ${JSON.stringify(focusState)}\n` +
          `failed requests:\n${failedRequests.join("\n") || "(none)"}\n` +
          `browser errors:\n${browserErrors.join("\n") || "(none)"}`
      );
    }

    await page.getByRole("tab", { name: "Table" }).click();
    await page.waitForFunction((expected) =>
      document.querySelectorAll(".a11y-graph tbody tr").length === expected, expandedCount);
    assert.equal(await page.locator(".a11y-graph tbody tr").count(), expandedCount);
    await page.locator('.a11y-graph tbody th[scope="row"] button').first().click();
    await page.getByRole("complementary", { name: "Inspection" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close inspection panel" }).click();

    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForFunction(() =>
      getComputedStyle(document.querySelector(".navigation-toggle")).display !== "none"
        && document.querySelector("#atlas-navigation")?.getAttribute("aria-hidden") === "true");
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${engine} 320px layout overflows horizontally by ${String(overflow)}px`);
    const navigationToggle = page.getByRole("button", { name: "Explore" });
    await navigationToggle.click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.querySelector("#atlas-navigation")?.getAttribute("aria-hidden") === "true"
        && document.activeElement === document.querySelector(".navigation-toggle"));

    const externalResources = await page.evaluate(() => performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => new URL(name).origin !== location.origin));
    assert.deepEqual(externalResources, [], `${engine} fetched cross-origin resources`);
    assert.deepEqual(failedRequests, [], `${engine} requests failed:\n${failedRequests.join("\n")}`);
    assert.deepEqual(browserErrors, [], `${engine} emitted errors:\n${browserErrors.join("\n")}`);
    process.stdout.write(
      `Installed GUI smoke passed in ${engine} (${String(initialCount)} -> ${String(expandedCount)} nodes).\n`
    );
  } finally {
    await browser.close();
  }
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
  const capabilities = await responseJson(new URL("api/v1/capabilities", url));
  assert.deepEqual(capabilities.states, [
    "semantic", "structural", "repository-only", "unsupported", "experimental"
  ]);
  assert.equal(
    capabilities.languages.find((language) => language.id === "python")
      ?.features.structuralResolution,
    "structural"
  );
  const capabilitySchema = await responseJson(new URL(
    "api/v1/multilanguage-capabilities.schema.json",
    url
  ));
  assert.equal(capabilitySchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  const analysis = await responseJson(new URL("api/v1/analysis?diagnosticLimit=1", url));
  assert.equal(analysis.snapshotId, snapshot.context.snapshotId);
  assert.equal(analysis.languages.some((language) => language.id === "python"), true);
  assert.equal(Number.isInteger(analysis.diagnostics.total), true);
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

  const packageBrowser = process.env.TADORI_PACKAGE_BROWSER?.trim();
  if (packageBrowser) await verifyInstalledGui(url, packageBrowser);

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
