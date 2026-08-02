import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import axe from "axe-core";
import { openBrowserPage, startServe, type BrowserPageSession } from "./lib/serveBenchmark.mts";

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  targets: string[][];
}

interface AxeSummary {
  violations: AxeViolation[];
  passes: number;
  incomplete: number;
}

interface AtlasState {
  title: string;
  heading: string | null;
  tagline: string | null;
  modeNames: string[];
  showing: string | null;
  canvasPresent: boolean;
  externalResources: string[];
  viewport: { width: number; height: number };
  sigmaCanvases: Array<{ width: number; height: number }>;
}

interface ExploreApiState {
  routes: number;
  tests: number;
  docs: number;
}

const fixture = path.resolve("packages/fixtures/01-core-symbols/repo");
process.env.TADORI_BROWSER_DEBUG = "1";
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "tadori-viz-e2e-"));
const repository = path.join(temporaryRoot, "repo");
cpSync(fixture, repository, { recursive: true });

let serve: Awaited<ReturnType<typeof startServe>> | null = null;
let browser: BrowserPageSession | null = null;

function stage(message: string): void {
  console.log(`[viz-e2e] ${message}`);
}

async function press(key: string, code: string, windowsVirtualKeyCode: number): Promise<void> {
  if (browser === null) throw new Error("Browser session is not available");
  const event = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  await browser.command("Input.dispatchKeyEvent", { type: "keyDown", ...event });
  await browser.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

async function clickWhenReady(selector: string, label: string): Promise<void> {
  if (browser === null) throw new Error("Browser session is not available");
  const clicked = await browser.waitFor<boolean>(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement) || (element instanceof HTMLButtonElement && element.disabled)) return false;
      element.click();
      return true;
    })()`,
    Boolean
  );
  assert.equal(clicked, true, `${label} was not clickable: ${selector}`);
}

async function activateTab(tabSelector: string, panelSelector: string, label: string): Promise<void> {
  if (browser === null) throw new Error("Browser session is not available");
  await clickWhenReady(tabSelector, label);
  const activated = await browser.waitFor<boolean>(`(() => {
    const tab = document.querySelector(${JSON.stringify(tabSelector)});
    const panel = document.querySelector(${JSON.stringify(panelSelector)});
    return tab?.getAttribute('aria-selected') === 'true' && panel !== null;
  })()`, Boolean);
  assert.equal(activated, true, `${label} did not activate ${panelSelector}`);
}

async function runAxe(label: string): Promise<AxeSummary> {
  if (browser === null) throw new Error("Browser session is not available");
  const summary = await browser.evaluate<AxeSummary>(`(async () => {
    if (!globalThis.axe) (0, eval)(${JSON.stringify(axe.source)});
    const result = await globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "best-practice"] }
    });
    return {
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        targets: violation.nodes.map((node) => node.target)
      })),
      passes: result.passes.length,
      incomplete: result.incomplete.length
    };
  })()`, true);
  assert.deepEqual(summary.violations, [], `${label} axe violations:\n${JSON.stringify(summary.violations, null, 2)}`);
  assert.ok(summary.passes > 0, `${label} axe run did not execute any rules`);
  return summary;
}

try {
  stage("starting fixture server");
  serve = await startServe(repository);
  stage(`opening ${serve.url}`);
  browser = await openBrowserPage(serve.url);
  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    screenWidth: 1440,
    screenHeight: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });
  stage("waiting for the Atlas shell");
  await browser.waitFor<{ ready: boolean; loading: boolean; canvases: number }>(
    `(() => {
      const surface = document.querySelector('.package-map-canvas');
      const canvases = [...(surface?.querySelectorAll('canvas') ?? [])];
      return {
        ready: surface !== null && canvases.some((canvas) => canvas.width > 0 && canvas.height > 0),
        loading: document.body.textContent?.includes('Loading repository graph') ?? false,
        canvases: canvases.length
      };
    })()`,
    (state) => state.ready && !state.loading && state.canvases > 0
  );
  stage("waiting for the served snapshot to settle");
  await browser.waitFor<boolean>(`(async () => {
    const firstBody = await fetch('/api/v1/snapshot').then((response) => response.json());
    const first = firstBody.context ?? firstBody;
    await new Promise((resolve) => setTimeout(resolve, 750));
    const secondBody = await fetch('/api/v1/snapshot').then((response) => response.json());
    const second = secondBody.context ?? secondBody;
    return first.snapshotId === second.snapshotId &&
      document.body.textContent?.includes('#' + String(second.snapshotId)) === true &&
      document.querySelector('.package-map-canvas canvas.sigma-nodes') !== null;
  })()`, Boolean, 30_000);
  await browser.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);

  const initial = await browser.evaluate<AtlasState>(`({
    title: document.title,
    heading: document.querySelector('h1')?.textContent ?? null,
    tagline: document.querySelector('.atlas-brand small')?.textContent ?? null,
    modeNames: [...document.querySelectorAll('[role="tablist"][aria-label="Repository views"] [role="tab"]')].map((tab) => tab.textContent?.trim() ?? ""),
    showing: [...document.querySelectorAll('span')].find((node) => node.textContent?.startsWith('Showing '))?.textContent ?? null,
    canvasPresent: document.querySelector('.package-map-canvas') !== null,
    externalResources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => new URL(name).origin !== location.origin),
    viewport: { width: innerWidth, height: innerHeight },
    sigmaCanvases: [...document.querySelectorAll('.package-map-canvas canvas')].map((canvas) => ({ width: canvas.width, height: canvas.height }))
  })`);
  assert.equal(initial.title, "Tadori");
  assert.equal(initial.heading, "Tadori");
  assert.equal(initial.tagline, "Archaeological circuit atlas");
  // Overview leads and Interview follows Atlas: a reader gets oriented before
  // being handed a graph, and can prepare to discuss what they just read.
  assert.deepEqual(initial.modeNames, ["Overview", "Atlas", "Interview", "Story", "Changes", "Table"]);
  assert.equal(initial.canvasPresent, true);
  assert.deepEqual(initial.viewport, { width: 1440, height: 1000 }, "Desktop browser viewport was not 1440px wide");
  assert.ok(
    initial.sigmaCanvases.some((canvas) => canvas.width > 0 && canvas.height > 0),
    `Sigma created no painted canvas: ${JSON.stringify(initial.sigmaCanvases)}`
  );
  assert.match(initial.showing ?? "", /^Showing \d+ nodes? and \d+ relations?$/);
  assert.deepEqual(initial.externalResources, [], "The offline Atlas fetched a cross-origin resource");
  if (process.env.TADORI_E2E_INITIAL_SCREENSHOT !== undefined) {
    const initialScreenshot = await browser.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    assert.equal(typeof initialScreenshot.data, "string");
    writeFileSync(process.env.TADORI_E2E_INITIAL_SCREENSHOT, Buffer.from(initialScreenshot.data as string, "base64"));
  }
  stage("running Atlas accessibility checks");
  const initialAxe = await runAxe("Atlas mode");

  const initialNodeCount = Number(/^Showing (\d+)/.exec(initial.showing ?? "")?.[1] ?? "0");
  assert.ok(initialNodeCount > 0, "Atlas rendered no package nodes");
  await browser.waitFor<boolean>("Boolean(document.querySelector('.package-map-canvas'))", Boolean);
  // Overview is the landing mode, so the Atlas workspace starts hidden. A
  // canvas inside a `hidden` subtree is in the DOM but cannot take focus:
  // focus() succeeds silently and activeElement stays on <body>, so no keydown
  // is ever delivered. Enter Atlas before driving the keyboard.
  await browser.evaluate(`[...document.querySelectorAll('[role="tab"]')]
    .find((tab) => tab.textContent?.trim() === 'Atlas')?.click()`);
  await browser.waitFor<boolean>(
    "document.querySelector('.spatial-workspace')?.hasAttribute('hidden') === false",
    Boolean
  );
  // A painted canvas is not a populated graph: until the Sigma graph has nodes,
  // an arrow key is delivered but finds nothing to focus and silently pans.
  await browser.waitFor<boolean>(
    "document.querySelector('.package-map-canvas')?.dataset.graphReady === 'true'",
    Boolean
  );
  await browser.evaluate("document.querySelector('.package-map-canvas').focus()");
  await press("ArrowRight", "ArrowRight", 39);
  await press("Enter", "Enter", 13);
  const keyboardState = await browser.evaluate<{ active: string | null; focusedNode: string | null }>(`(() => {
    const surface = document.querySelector('.package-map-canvas');
    return {
      active: document.activeElement?.className ?? null,
      focusedNode: surface?.getAttribute('data-focused-node') ?? null
    };
  })()`);
  assert.equal(keyboardState.active, "package-map-canvas", "Keyboard focus left the Atlas canvas");
  assert.ok(keyboardState.focusedNode, "Arrow navigation did not focus a graph node");
  stage("waiting for package expansion");
  const expandedNodeCount = await browser.waitFor<number>(
    "Number(/^Showing (\\d+)/.exec([...document.querySelectorAll('span')].find((node) => node.textContent?.startsWith('Showing '))?.textContent ?? '')?.[1] ?? 0)",
    (count) => count > initialNodeCount
  );
  // Expanding a package starts camera animations (PackageMapCanvas
  // `camera.animate`: 350ms on expand, 180ms on focus), so the plate's projected
  // position is still in flight the moment the node count changes. Reading it
  // once sampled an arbitrary point on that arc, which is why the same assertion
  // produced y=553 (inside) and y=928 (past the 916px canvas bottom) on
  // identical hosted-Linux runs while passing on every local run. Assert on the
  // resting position; a plate that settles outside the viewport still fails.
  //
  // Stillness is measured inside the page across one continuous 500ms window
  // rather than by counting polls in the predicate. 500ms outlasts both
  // animations and the plateau between them: two samples accepted that plateau
  // as a resting position, which is how CI read y=928 twice.
  //
  // Keeping the state in the page also keeps the predicate pure, which the
  // bounded timeout depends on. `browser.waitFor` evaluates its predicate once
  // more after the loop (scripts/lib/serveBenchmark.mts), so a predicate that
  // counted its own calls scored one extra still sample on the timeout path —
  // enough to report "settled" and return an in-flight position instead of
  // throwing.
  const settledPlateExpression = `(async () => {
    const read = () => {
      const canvas = document.querySelector('.package-map-canvas canvas.sigma-nodes');
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      const plate = document.querySelector('.package-plate-overlay text');
      if (!(plate instanceof SVGTextElement)) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: Number(plate.getAttribute('x')),
        y: Number(plate.getAttribute('y')),
        width: rect.width,
        height: rect.height
      };
    };
    let last = read();
    if (last === null) return null;
    const deadline = performance.now() + 500;
    while (performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const next = read();
      if (next === null) return null;
      if (next.x !== last.x || next.y !== last.y) return { ...next, settled: false };
      last = next;
    }
    return { ...last, settled: true };
  })()`;
  const projectedPlate = await browser.waitFor<{
    x: number;
    y: number;
    width: number;
    height: number;
    settled: boolean;
  } | null>(settledPlateExpression, (plate) => plate !== null && plate.settled, 30_000);
  // `assert.ok` narrows (it is declared `asserts value`) where `assert.notEqual`
  // does not, so the viewport checks below read a non-null value.
  assert.ok(projectedPlate !== null, "Expanded package produced no projected repository boundary");
  assert.ok(projectedPlate.x >= 0 && projectedPlate.x <= projectedPlate.width && projectedPlate.y >= 0 && projectedPlate.y <= projectedPlate.height,
    `Expanded package boundary projected outside the map viewport: ${JSON.stringify(projectedPlate)}`);
  if (process.env.TADORI_E2E_DESKTOP_SCREENSHOT !== undefined) {
    await browser.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
    const desktopScreenshot = await browser.command("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    });
    assert.equal(typeof desktopScreenshot.data, "string");
    writeFileSync(
      process.env.TADORI_E2E_DESKTOP_SCREENSHOT,
      Buffer.from(desktopScreenshot.data as string, "base64")
    );
  }

  const exploreApi = await browser.evaluate<ExploreApiState>(`(async () => {
    const [routesResponse, testsResponse, docsResponse] = await Promise.all([
      fetch('/api/v1/routes'),
      fetch('/api/v1/tests'),
      fetch('/api/v1/docs')
    ]);
    if (!routesResponse.ok || !testsResponse.ok || !docsResponse.ok) {
      throw new Error('Explore API request failed: ' + [routesResponse.status, testsResponse.status, docsResponse.status].join('/'));
    }
    const [routes, tests, docs] = await Promise.all([routesResponse.json(), testsResponse.json(), docsResponse.json()]);
    return { routes: routes.routes.length, tests: tests.tests.length, docs: docs.docs.length };
  })()`, true);

  stage("exercising Path with a live graph edge");
  const pathEndpoints = await browser.evaluate<{ from: string; to: string } | null>(`(async () => {
    const response = await fetch('/api/v1/nodes?limit=100');
    if (!response.ok) throw new Error('Node discovery failed with HTTP ' + response.status);
    const body = await response.json();
    for (const node of body.items ?? []) {
      const detailResponse = await fetch('/api/v1/nodes/' + encodeURIComponent(node.entityKey));
      if (!detailResponse.ok) continue;
      const detail = await detailResponse.json();
      const edge = detail.outEdges?.find((candidate) =>
        candidate.relation === 'calls' && candidate.resolution === 'resolved' && candidate.dstEntityKey
      );
      if (edge) return { from: node.entityKey, to: edge.dstEntityKey };
    }
    return null;
  })()`, true);
  assert.notEqual(pathEndpoints, null, "The live graph exposed no resolved calls edge for Path verification");
  await browser.evaluate(`(() => {
    const panel = document.querySelector('#explore-panel-path');
    const inputs = panel?.querySelectorAll('input');
    if (!inputs || inputs.length !== 2) throw new Error('Path form inputs are unavailable');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(inputs[0], ${JSON.stringify(pathEndpoints?.from)});
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(inputs[1], ${JSON.stringify(pathEndpoints?.to)});
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    panel.querySelector('form').requestSubmit();
  })()`);
  const pathState = await browser.waitFor<{ found: number; status: string; alert: string | null; loading: boolean }>(`(() => ({
    found: document.querySelectorAll('#explore-panel-path .explore-path-steps').length,
    status: document.querySelector('#explore-panel-path [role="status"]')?.textContent?.trim() ?? '',
    alert: document.querySelector('#explore-panel-path [role="alert"]')?.textContent?.trim() ?? null,
    loading: document.querySelector('#explore-panel-path button[type="submit"]')?.disabled ?? true
  }))()`, (state) => !state.loading && (state.found > 0 || state.alert !== null || state.status.length > 0));
  assert.equal(pathState.alert, null, `Path UI failed for a live resolved edge: ${pathState.alert ?? "unknown error"}`);
  assert.ok(pathState.found > 0, `Path UI did not render the live resolved edge: ${pathState.status}`);
  const pathAxe = await runAxe("Path results");

  stage("exercising Routes, Tests, and Docs against their live endpoint counts");
  await activateTab("#explore-tab-routes", "#explore-panel-routes", "Routes tab");
  const routesState = await browser.waitFor<{ rows: number; status: string; loading: boolean }>(`(() => ({
    rows: document.querySelectorAll('#explore-panel-routes .explore-routes tbody tr').length,
    status: document.querySelector('#explore-panel-routes [role="status"]')?.textContent?.trim() ?? '',
    loading: document.querySelector('#explore-panel-routes')?.textContent?.includes('Loading routes') ?? true
  }))()`, (state) => !state.loading && (state.rows > 0 || state.status.length > 0));
  assert.equal(routesState.rows, exploreApi.routes, `Routes UI/API count mismatch; status: ${routesState.status}`);
  if (exploreApi.routes === 0) assert.match(routesState.status, /No routes in this snapshot/);
  const routesAxe = await runAxe("Routes evidence");

  await activateTab("#explore-tab-tests", "#explore-panel-tests", "Tests tab");
  const testsState = await browser.waitFor<{ rows: number; caption: string | null; terminal: boolean }>(`(() => ({
    rows: document.querySelectorAll('#explore-panel-tests .explore-tests li').length,
    caption: document.querySelector('#explore-panel-tests .explore-tests-caption')?.textContent?.trim() ?? null,
    terminal: !document.querySelector('#explore-panel-tests')?.textContent?.includes('Loading tests')
  }))()`, (state) => state.terminal);
  assert.equal(testsState.rows, exploreApi.tests, "Tests UI/API count mismatch");
  assert.equal(testsState.caption, "not observed inspected", "Tests view lost its evidence-honesty caption");
  const testsAxe = await runAxe("Likely tests evidence");

  await activateTab("#explore-tab-docs", "#explore-panel-docs", "Docs tab");
  const docsState = await browser.waitFor<{ rows: number; terminal: boolean; hasDocuments: boolean }>(`(() => ({
    rows: document.querySelectorAll('#explore-panel-docs .explore-docs > section > ul > li').length,
    terminal: !document.querySelector('#explore-panel-docs')?.textContent?.includes('Loading documents'),
    hasDocuments: document.querySelector('#explore-panel-docs .explore-docs') !== null
  }))()`, (state) => state.terminal);
  assert.equal(docsState.rows, exploreApi.docs, "Docs UI/API count mismatch");
  assert.equal(docsState.hasDocuments, exploreApi.docs > 0, "Docs terminal state did not match the live endpoint");
  const docsAxe = await runAxe("Documentation evidence");

  stage("exercising Story workspace");
  if (exploreApi.routes > 0) {
    await activateTab("#explore-tab-routes", "#explore-panel-routes", "Routes tab");
    await browser.waitFor<boolean>("Boolean(document.querySelector('.explore-routes-story'))", Boolean);
    await clickWhenReady(".explore-routes-story", "Route story action");
    await browser.waitFor<boolean>("Boolean(document.querySelector('.story-view'))", Boolean);
  } else {
    await activateTab("#mode-tab-story", "#workspace-mode-panel.mode-panel-story", "Story workspace tab");
    await browser.waitFor<boolean>("document.querySelector('#mode-tab-story')?.getAttribute('aria-selected') === 'true'", Boolean);
    assert.match(
      await browser.evaluate<string>("document.querySelector('#workspace-mode-panel')?.textContent ?? ''"),
      /Select a registered route/,
      "Story did not expose its honest no-route selection state"
    );
  }
  const storyAxe = await runAxe("Story workspace");

  stage("exercising Changes workspace");
  await activateTab("#mode-tab-changes", "#workspace-mode-panel.mode-panel-changes", "Changes workspace tab");
  const changesState = await browser.waitFor<{ selected: boolean; loading: boolean; terminal: boolean }>(`(() => ({
    selected: document.querySelector('#mode-tab-changes')?.getAttribute('aria-selected') === 'true',
    loading: document.querySelector('.review-diff')?.textContent?.includes('Loading diff') ?? true,
    terminal: Boolean(document.querySelector('.review-diff [role="status"], .review-diff [role="alert"], .review-diff-list'))
  }))()`, (state) => state.selected && !state.loading && state.terminal);
  assert.equal(changesState.selected, true);
  const changesAxe = await runAxe("Changes workspace");

  stage("exercising Table workspace");
  await activateTab("#mode-tab-table", "#workspace-mode-panel.mode-panel-table", "Table workspace tab");
  const tableState = await browser.waitFor<{ rows: number; caption: string | null; selected: boolean; visibleNodes: number; fallback: string | null }>(`(() => {
    const tab = document.querySelector('#mode-tab-table');
    if (tab?.getAttribute('aria-selected') !== 'true' && tab instanceof HTMLButtonElement) tab.click();
    const table = document.querySelector('.a11y-graph table');
    return {
      rows: table?.querySelectorAll('tbody tr').length ?? 0,
      caption: table?.querySelector('caption')?.textContent ?? null,
      selected: tab?.getAttribute('aria-selected') === 'true',
      visibleNodes: Number(/^Showing (\\d+)/.exec([...document.querySelectorAll('.atlas-context-bar span')].find((node) => node.textContent?.startsWith('Showing '))?.textContent ?? '')?.[1] ?? 0),
      fallback: document.querySelector('#workspace-mode-panel .mode-empty-state')?.textContent?.trim() ?? null
    };
  })()`, (state) => state.selected && state.rows > 0 && state.rows === state.visibleNodes);
  assert.equal(tableState.rows, tableState.visibleNodes, "Table mode does not contain the currently rendered graph node set");
  assert.equal(tableState.caption, `${tableState.rows} ${tableState.rows === 1 ? "node" : "nodes"}`);
  stage("running Table accessibility checks");
  const tableAxe = await runAxe("Table mode");

  const clickedConnectedRow = await browser.evaluate<string | null>(`(async () => {
    const buttons = [...document.querySelectorAll('.a11y-graph tbody th[scope="row"] button[data-entity-key]')];
    for (const button of buttons) {
      const entityKey = button.dataset.entityKey;
      if (!entityKey) continue;
      const response = await fetch('/api/v1/nodes/' + encodeURIComponent(entityKey));
      if (!response.ok) continue;
      const detail = await response.json();
      if (Array.isArray(detail.outEdges) && detail.outEdges.length > 0) {
        button.click();
        return entityKey;
      }
    }
    return null;
  })()`, true);
  assert.notEqual(clickedConnectedRow, null, "No connected live table row was available for inspection");
  const inspectedNode = await browser.waitFor<{ text: string; connectionCount: number }>(
    `(() => {
      const panel = document.querySelector('aside[aria-label="Inspection"]');
      return {
        text: panel?.textContent ?? "",
        connectionCount: panel?.querySelectorAll('.inspect-connections button').length ?? 0
      };
    })()`,
    (state) => state.connectionCount > 0 || (!state.text.includes("Loading") && state.text.length > 0)
  );
  assert.ok(
    inspectedNode.connectionCount > 0,
    `Connected node ${clickedConnectedRow} rendered no connection controls: ${inspectedNode.text}`
  );
  await browser.evaluate("document.querySelector('.inspect-connections button').click()");
  await browser.waitFor<boolean>("Boolean(document.querySelector('.inspect-edge'))", Boolean);
  assert.equal(
    await browser.evaluate<boolean>("document.body.textContent?.includes('Edge details are unavailable.') ?? false"),
    false,
    "Connection pivot lost its edge data"
  );
  stage("running inspector accessibility checks");
  const inspectorAxe = await runAxe("Edge inspection");
  await browser.evaluate(`document.querySelector('button[aria-label="Close inspection panel"]').click()`);
  await browser.waitFor<boolean>(`document.querySelector('aside[aria-label="Inspection"]') === null`, Boolean);

  await browser.command("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 800,
    screenWidth: 320,
    screenHeight: 800,
    deviceScaleFactor: 1,
    mobile: false
  });
  await browser.waitFor<boolean>(
    "getComputedStyle(document.querySelector('.navigation-toggle')).display !== 'none' && document.querySelector('#atlas-navigation')?.getAttribute('aria-hidden') === 'true'",
    Boolean
  );
  const mobileClosed = await browser.evaluate<{ overflow: number; hidden: string | null; inert: boolean }>(`({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hidden: document.querySelector('#atlas-navigation')?.getAttribute('aria-hidden') ?? null,
    inert: document.querySelector('#atlas-navigation')?.hasAttribute('inert') ?? false
  })`);
  assert.ok(mobileClosed.overflow <= 1, `320px layout overflows horizontally by ${mobileClosed.overflow}px`);
  assert.equal(mobileClosed.hidden, "true");
  assert.equal(mobileClosed.inert, true);
  await browser.evaluate("document.querySelector('.navigation-toggle').click()");
  await browser.waitFor<boolean>("document.querySelector('#atlas-navigation')?.getAttribute('aria-hidden') === 'false'", Boolean);
  await press("Escape", "Escape", 27);
  await browser.waitFor<boolean>(
    "document.querySelector('#atlas-navigation')?.getAttribute('aria-hidden') === 'true' && document.activeElement === document.querySelector('.navigation-toggle')",
    Boolean
  );

  await browser.command("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "forced-colors", value: "active" }
    ]
  });
  const mediaState = await browser.evaluate<{ reduced: boolean; forced: boolean; navigationDuration: string }>(`({
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    forced: matchMedia('(forced-colors: active)').matches,
    navigationDuration: getComputedStyle(document.querySelector('#atlas-navigation')).transitionDuration
  })`);
  assert.equal(mediaState.reduced, true);
  assert.equal(mediaState.forced, true);
  assert.equal(mediaState.navigationDuration, "0s");
  stage("running mobile and media accessibility checks");
  const mobileAxe = await runAxe("320px reduced-motion forced-colors mode");

  const screenshot = await browser.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const screenshotData = screenshot.data;
  assert.equal(typeof screenshotData, "string");
  assert.ok((screenshotData as string).length > 10_000, "Rendered Atlas screenshot was unexpectedly empty");
  if (process.env.TADORI_E2E_SCREENSHOT !== undefined) {
    writeFileSync(process.env.TADORI_E2E_SCREENSHOT, Buffer.from(screenshotData as string, "base64"));
  }

  assert.deepEqual(browser.consoleErrors, [], `Browser emitted errors:\n${browser.consoleErrors.join("\n")}`);
  console.log(JSON.stringify({
    url: serve.url,
    initialNodeCount,
    expandedNodeCount,
    tableRows: tableState.rows,
    axePasses: {
      atlas: initialAxe.passes,
      table: tableAxe.passes,
      inspector: inspectorAxe.passes,
      path: pathAxe.passes,
      routes: routesAxe.passes,
      tests: testsAxe.passes,
      docs: docsAxe.passes,
      story: storyAxe.passes,
      changes: changesAxe.passes,
      mobile: mobileAxe.passes
    },
    axeIncomplete: {
      atlas: initialAxe.incomplete,
      table: tableAxe.incomplete,
      inspector: inspectorAxe.incomplete,
      path: pathAxe.incomplete,
      routes: routesAxe.incomplete,
      tests: testsAxe.incomplete,
      docs: docsAxe.incomplete,
      story: storyAxe.incomplete,
      changes: changesAxe.incomplete,
      mobile: mobileAxe.incomplete
    },
    externalResources: initial.externalResources.length,
    browserErrors: browser.consoleErrors.length
  }, null, 2));
} catch (error) {
  if (browser !== null) {
    try {
      const diagnostic = await browser.evaluate(`({
        url: location.href,
        title: document.title,
        bodyText: document.body.textContent?.slice(0, 1000) ?? '',
        appPresent: document.querySelector('#root')?.childElementCount ?? 0,
        modeTabs: [...document.querySelectorAll('[id^="mode-tab-"]')].map((tab) => tab.id)
      })`);
      console.error(`[viz-e2e] failure diagnostic ${JSON.stringify({ diagnostic, consoleErrors: browser.consoleErrors }, null, 2)}`);
    } catch (diagnosticError) {
      console.error(`[viz-e2e] browser diagnostics unavailable: ${String(diagnosticError)}`);
      console.error(`[viz-e2e] captured browser errors: ${JSON.stringify(browser.consoleErrors, null, 2)}`);
    }
  }
  throw error;
} finally {
  await browser?.close();
  await serve?.stop();
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
