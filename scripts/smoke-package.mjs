/* global document, getComputedStyle, performance, location, KeyboardEvent */
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
  // Sigma renders through WebGL. On Linux, Playwright's Firefox gets a WebGL
  // context only when an X display is present: under `xvfb-run` it renders
  // through Mesa llvmpipe, and without one `getContext("webgl")` returns null
  // whatever prefs are set (measured both ways in the pinned Playwright image).
  // So the display — supplied by the caller, see the `browser` job in
  // .github/workflows/ci.yml and scripts/gate-firefox.mjs — is what makes this
  // exercise the real Atlas rather than the renderer-error fallback.
  //
  // These prefs are only blocklist insurance: a hosted runner can blocklist the
  // software renderer the container accepts. They were NOT what fixed KF-001
  // and do not substitute for the display. Chromium ignores Firefox prefs.
  const browser = await browserType.launch({
    headless: true,
    firefoxUserPrefs: engine === "firefox"
      ? { "webgl.disabled": false, "webgl.force-enabled": true }
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
    // Overview is the landing mode, so the Atlas workspace starts hidden and
    // its canvas — present in the DOM — is neither visible nor focusable. Enter
    // Atlas before waiting on the canvas at all. This is a precondition of the
    // GUI checks, not a KF-001 fix: the focus probe further down is unchanged
    // and still reports why focus failed if it still does.
    await page.getByRole("tab", { name: "Atlas" }).click();
    const canvas = page.locator(".package-map-canvas");
    await canvas.waitFor({ state: "visible", timeout: 60_000 });
    // Readiness is three separate conditions, so report them separately. The
    // previous single `waitForFunction` ANDed them and, on timeout, printed
    // only "Timeout 30000ms exceeded" with an empty `log: []` — a gate failing
    // without saying why, for the third time on this leg. Each sample is
    // recorded so a failure names the condition that never came true.
    const readState = () => page.evaluate(() => {
      const surface = document.querySelector(".package-map-canvas");
      const canvases = [...(surface?.querySelectorAll("canvas") ?? [])];
      return {
        // A painted canvas is not a populated graph. Until the Sigma graph has
        // nodes, an arrow key reaches the handler, finds nothing to focus, and
        // silently pans — which is exactly how this gate failed with keys
        // provably delivered and focusedNode still null.
        painted: canvases.filter((item) => item.width > 0 && item.height > 0).length,
        canvasCount: canvases.length,
        graphReady: surface?.dataset.graphReady ?? "(attribute absent)",
        loadingText: document.body.textContent?.includes("Loading repository graph") ?? false,
        readyState: document.readyState,
        // The app switches to Table and hides the Atlas workspace when the
        // renderer fails, which would leave the graph permanently unpopulated.
        // If that is what happens here, this is where it shows.
        alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim() ?? ""),
        selectedTab: [...document.querySelectorAll('[role="tab"]')]
          .filter((tab) => tab.getAttribute("aria-selected") === "true")
          .map((tab) => tab.textContent?.trim() ?? "")
      };
    });

    const isNavigable = (state) =>
      state.painted > 0 && state.graphReady === "true" && !state.loadingText;

    let readiness = await readState();
    const readinessDeadline = Date.now() + 30_000;
    while (Date.now() < readinessDeadline && !isNavigable(readiness)) {
      await page.waitForTimeout(250);
      readiness = await readState();
    }
    assert.ok(
      isNavigable(readiness),
      `${engine} never reached a navigable graph.\nreadiness: ${JSON.stringify(readiness)}`
    );

    assert.equal(await page.title(), "Tadori");
    const modeNames = await page.getByRole("tablist", { name: "Repository views" })
      .getByRole("tab").allTextContents();
    assert.deepEqual(
      modeNames.map((name) => name.trim()),
      ["Overview", "Atlas", "Interview", "Story", "Changes", "Table"]
    );
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
    // Focus first, and record where it actually landed. In headless Firefox on
    // Linux neither locator.focus() nor a direct element.focus() moves
    // document.activeElement off <body>, while the renderer is healthy (41
    // canvases, no browser errors). activeElement is therefore reported as
    // evidence on failure rather than asserted up front: locator.press() below
    // focuses and presses atomically and can route a real key even where
    // activeElement reporting is unreliable, so pre-asserting it would fail the
    // run before the mechanism that works has been tried. Descent itself
    // remains the gate.
    // Firefox makes element.focus() a no-op when the DOCUMENT itself is not
    // focused, which a headless browsing context can be. That is the one
    // remaining explanation consistent with the evidence so far: renderer
    // healthy, no errors, yet activeElement never leaves <body> for either
    // locator.focus(), element.focus(), or locator.press(). bringToFront gives
    // the context focus first; hasFocus is recorded so a further failure says
    // which of the two causes it was instead of needing another round trip.
    await page.bringToFront();
    await canvas.evaluate((element) => { element.focus(); });
    const focusReport = await page.evaluate(() => ({
      activeElement: document.activeElement?.className ?? "",
      documentHasFocus: document.hasFocus(),
      canvasTabIndex: document.querySelector(".package-map-canvas")?.tabIndex ?? null
    }));
    const readShowing = () => page.evaluate(() => {
      const value = [...document.querySelectorAll(".atlas-context-bar span")]
        .find((node) => node.textContent?.startsWith("Showing "))?.textContent ?? "";
      return Number(/^Showing (\d+)/.exec(value)?.[1] ?? 0);
    });
    // Evidence probe, owned entirely by this test: a capture-phase listener on
    // the same element the application binds its keydown handler to. If a key
    // reaches the element at all, this sees it. That separates "the event never
    // arrived" from "the event arrived and the handler did not act", which the
    // single post-loop sample could not distinguish. No production code is
    // involved, so this cannot alter the behaviour under test.
    await canvas.evaluate((element) => {
      const probe = [];
      Reflect.set(globalThis, "__tadoriKeyProbe", probe);
      element.addEventListener("keydown", (event) => probe.push(event.key), true);
    });

    // Branch 2 investigation: keysSeen stayed empty for every press while the
    // document had focus and the canvas was visible with tabIndex 0, so the
    // event never reached the element. Three checks separate the remaining
    // causes in one run, without touching application code.
    const deliveryReport = await canvas.evaluate((element) => {
      // (a) Can ANYTHING on this page take focus? Distinguishes "this element
      // is unfocusable" from "focus does not work here at all".
      const probeButton = document.createElement("button");
      probeButton.textContent = "focus probe";
      document.body.append(probeButton);
      probeButton.focus();
      const buttonTookFocus = document.activeElement === probeButton;
      probeButton.remove();

      // (b) Does anything in the ancestor chain make the canvas unfocusable?
      const ancestors = [];
      for (let node = element; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        ancestors.push({
          tag: node.tagName.toLowerCase(),
          cls: node.className || null,
          inert: node.hasAttribute("inert"),
          hidden: node.hasAttribute("hidden"),
          ariaHidden: node.getAttribute("aria-hidden"),
          display: style.display,
          visibility: style.visibility
        });
      }

      // (c) Does a dispatched event reach the listener when a real key did not?
      // Separates delivery from listener wiring.
      const seenBefore = (Reflect.get(globalThis, "__tadoriKeyProbe") ?? []).length;
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      const dispatchReached =
        (Reflect.get(globalThis, "__tadoriKeyProbe") ?? []).length > seenBefore;

      element.focus();
      return {
        buttonTookFocus,
        canvasTookFocus: document.activeElement === element,
        dispatchReached,
        rect: element.getBoundingClientRect().toJSON(),
        ancestors
      };
    });
    const readProbe = () => page.evaluate(() => ({
      keysSeen: [...(Reflect.get(globalThis, "__tadoriKeyProbe") ?? [])],
      focusedNode: document.querySelector(".package-map-canvas")?.dataset.focusedNode ?? null,
      activeElement: document.activeElement?.className ?? ""
    }));

    let expandedCount = initialCount;
    const perKey = [];
    for (let attempt = 0; attempt < initialCount && expandedCount === initialCount; attempt += 1) {
      await canvas.press("ArrowRight");
      perKey.push({ after: "ArrowRight", ...(await readProbe()), showing: await readShowing() });
      await canvas.press("Enter");
      perKey.push({ after: "Enter", ...(await readProbe()), showing: await readShowing() });
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
          `focus report after bringToFront: ${JSON.stringify(focusReport)}\n` +
          `per-key evidence: ${JSON.stringify(perKey)}\n` +
          `delivery report: ${JSON.stringify(deliveryReport)}\n` +
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
