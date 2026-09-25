/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * `pnpm capture <repo> [shots...] [options]`: serve a repository, open the app in
 * headless Chrome (or Edge), and write a screenshot plus a JSON record of what
 * is on screen for each shot. Development tooling: lets an agent check UI work
 * without a person looking at the browser.
 *
 * A shot is `mode[:view][@WIDTHxHEIGHT]`, e.g. `overview`, `atlas:tilt`,
 * `story@390x844`. With no shots, every mode is captured at 1440x900.
 *
 * Options:
 *   --out <dir>        output directory (default .tmp/capture)
 *   --select <key>     entity key to open in the inspector
 *   --keys <k1,k2>     keys pressed on the map after load (e.g. ArrowRight,Enter)
 *   --browser <path>   browser executable (default: installed Chrome, then Edge)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

const MODES = ["overview", "atlas", "interview", "story", "changes", "table"] as const;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Options {
  repo: string;
  shots: string[];
  out: string;
  select: string | null;
  keys: string[];
  browser: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { repo: "", shots: [], out: ".tmp/capture", select: null, keys: [], browser: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--out") options.out = value();
    else if (arg === "--select") options.select = value();
    else if (arg === "--keys") options.keys = value().split(",").filter(Boolean);
    else if (arg === "--browser") options.browser = value();
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else if (options.repo === "") options.repo = arg;
    else options.shots.push(arg);
  }
  if (options.repo === "") {
    throw new Error("Usage: pnpm capture <repo> [mode[:view][@WxH] ...] [--out dir] [--select key] [--keys k1,k2] [--browser path]");
  }
  if (options.shots.length === 0) options.shots = [...MODES];
  return options;
}

interface Shot { name: string; mode: string; view: string | null; width: number; height: number }

function parseShot(spec: string): Shot {
  const match = /^([a-z]+)(?::([a-z0-9]+))?(?:@(\d+)x(\d+))?$/.exec(spec);
  if (match === null) throw new Error(`bad shot "${spec}"; expected mode[:view][@WxH]`);
  const [, mode = "", view, width = "1440", height = "900"] = match;
  return { name: spec.replace(/[:@]/g, "-"), mode, view: view ?? null, width: Number(width), height: Number(height) };
}

/** Starts `tadori serve` and resolves with its URL once it prints one. */
function startServer(repo: string): Promise<{ url: string; child: ChildProcess }> {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/tadori.mts", "serve", repo, "--no-open"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      const url = /URL:\s+(http:\/\/\S+)/.exec(output)?.[1];
      if (url !== undefined) resolve({ url, child });
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => reject(new Error(`tadori serve exited (${String(code)}):\n${output}`)));
  });
}

async function launch(executablePath: string | null): Promise<Browser> {
  if (executablePath !== null) return chromium.launch({ executablePath });
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      // try the next installed browser
    }
  }
  throw new Error("no Chrome or Edge found; pass --browser <path>");
}

async function capture(page: Page, base: string, shot: Shot, options: Options, outDir: string, axeSource: string): Promise<object> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const externalRequests: string[] = [];
  const httpErrors: string[] = [];
  const origin = new URL(base).origin;
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  page.on("response", (response) => { if (response.status() >= 400) httpErrors.push(`${String(response.status())} ${response.request().method()} ${response.url()}`); });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:")) externalRequests.push(url);
  });

  await page.setViewportSize({ width: shot.width, height: shot.height });
  const query = new URLSearchParams({ mode: shot.mode });
  if (shot.view !== null) query.set("view", shot.view);
  if (options.select !== null) query.set("select", options.select);
  // The app holds a live connection open, so "networkidle" is only a best effort.
  const settle = (): Promise<void> => page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.goto(`${base}?${query.toString()}`, { waitUntil: "load" });
  // Attached, not visible: on a narrow screen the mode tabs live in a closed menu.
  await page.waitForSelector('[role="tablist"]', { state: "attached" });
  await settle();
  await page.evaluate("document.fonts.ready.then(() => undefined)");
  if (options.keys.length > 0) {
    const canvas = page.locator(".package-map-canvas").first();
    if (await canvas.count() > 0) {
      await canvas.focus();
      for (const key of options.keys) {
        await page.keyboard.press(key);
        await page.waitForTimeout(400);
      }
      await settle();
    }
  }
  // Camera animations settle within ~0.5s.
  await page.waitForTimeout(800);

  const screenshot = path.join(outDir, `${shot.name}.png`);
  await page.screenshot({ path: screenshot });

  await page.addScriptTag({ content: axeSource });
  const axe = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run(): Promise<{ violations: { id: string; impact: string | null; help: string; nodes: unknown[] }[] }> } }).axe.run();
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.length }));
  });

  // A source string, not a callback: tsx's keep-names transform would wrap a
  // named helper in `__name(...)`, which does not exist in the page.
  const onScreen = await page.evaluate(`(() => {
    const text = (selector) => document.querySelector(selector)?.innerText?.replace(/\\s+/g, " ").trim() ?? null;
    return {
      title: document.title,
      selectedMode: text('[role="tab"][aria-selected="true"]'),
      heading: text("main h2") ?? text("h2"),
      contextBar: text(".atlas-context-bar"),
      projection: document.querySelector(".package-map-canvas")?.getAttribute("data-projection") ?? null,
      statuses: [...document.querySelectorAll('[role="status"], [role="alert"]')]
        .map((node) => node.getAttribute("role") + ": " + (node.textContent ?? "").replace(/\\s+/g, " ").trim())
        .filter((line) => !line.endsWith(": "))
        .slice(0, 12),
      fontsLoaded: [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family + " " + face.weight),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })()`) as Record<string, unknown>;

  const record = {
    shot: shot.name,
    url: page.url(),
    viewport: { width: shot.width, height: shot.height },
    screenshot,
    ...onScreen,
    axeViolations: axe,
    consoleErrors,
    pageErrors,
    failedRequests,
    httpErrors,
    externalRequests
  };
  await writeFile(path.join(outDir, `${shot.name}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

const options = parseArgs(process.argv.slice(2));
const shots = options.shots.map(parseShot);
const outDir = path.resolve(options.out);
await mkdir(outDir, { recursive: true });
const axeSource = await readFile(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

const { url, child } = await startServer(path.resolve(options.repo));
let browser: Browser | null = null;
try {
  browser = await launch(options.browser);
  const summary = [];
  for (const shot of shots) {
    const page = await browser.newPage();
    try {
      const record = await capture(page, url, shot, options, outDir, axeSource) as { axeViolations: unknown[]; pageErrors: unknown[]; consoleErrors: unknown[]; horizontalOverflow: boolean };
      summary.push({
        shot: shot.name,
        axe: record.axeViolations.length,
        errors: record.pageErrors.length + record.consoleErrors.length,
        overflow: record.horizontalOverflow
      });
    } finally {
      await page.close();
    }
  }
  await writeFile(path.join(outDir, "summary.json"), `${JSON.stringify({ url, shots: summary }, null, 2)}\n`);
  console.table(summary);
  console.log(`Wrote ${String(shots.length)} shot(s) to ${outDir}`);
} finally {
  await browser?.close();
  child.kill();
}
