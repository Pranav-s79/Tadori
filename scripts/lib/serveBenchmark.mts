import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { createSyntheticCorpus, type SyntheticCorpus } from "./syntheticCorpus.mts";

const START_TIMEOUT_MS = 120_000;
const CHROME_CANDIDATES = [
  process.env.TADORI_BROWSER_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);

function browserDebug(message: string): void {
  if (process.env.TADORI_BROWSER_DEBUG === "1") console.log(`[browser] ${message}`);
}

export interface RunningServe {
  process: ChildProcess;
  url: string;
  stop(): Promise<void>;
}

export function create150kCorpus(prefix: string): SyntheticCorpus {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  return createSyntheticCorpus(root, {
    leafFileCount: 150,
    linesPerLeafFile: 1_000,
    chainFileCount: 40
  });
}

export function removeCorpus(corpus: SyntheticCorpus): void {
  rmSync(corpus.root, { recursive: true, force: true });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(5_000)]);
  }
}

export async function startServe(repositoryRoot: string): Promise<RunningServe> {
  const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");
  const child = spawn(process.execPath, [tsxCli, "scripts/tadori.mts", "serve", repositoryRoot, "--no-open"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });

  const deadline = Date.now() + START_TIMEOUT_MS;
  let url: string | null = null;
  while (url === null && Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`tadori serve exited ${String(child.exitCode)} before startup: ${stderr || stdout}`);
    }
    url = /URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/.exec(stdout)?.[1] ?? null;
    if (url === null) await delay(25);
  }
  if (url === null) {
    child.kill("SIGTERM");
    throw new Error(`tadori serve did not report a URL within ${String(START_TIMEOUT_MS)}ms: ${stderr || stdout}`);
  }

  return {
    process: child,
    url,
    async stop(): Promise<void> {
      await stopProcess(child);
    }
  };
}

export interface BrowserPageSession {
  command(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  evaluate<T>(expression: string, awaitPromise?: boolean): Promise<T>;
  waitFor<T>(expression: string, accept: (value: T) => boolean, timeoutMs?: number): Promise<T>;
  consoleErrors: readonly string[];
  close(): Promise<void>;
}

export async function openBrowserPage(url: string): Promise<BrowserPageSession> {
  const executable = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (executable === undefined) {
    throw new Error(
      "Browser verification requires Chrome or Edge; set TADORI_BROWSER_EXECUTABLE to an installed executable"
    );
  }
  browserDebug(`launching ${executable}`);
  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"]
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => {
      consoleErrors.push(error.stack ?? error.message);
    });
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().startsWith("Failed to load resource: the server responded with a status of")
      ) {
        consoleErrors.push(message.text());
      }
    });
    page.on("crash", () => {
      consoleErrors.push("Browser page crashed");
    });
    page.on("requestfailed", (request) => {
      consoleErrors.push(`Request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? "unknown error"})`);
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    browserDebug("Page loaded");

    return {
      command: (method, params = {}) => cdp.send(method, params),
      async evaluate<T>(expression: string, _awaitPromise = false): Promise<T> {
        void _awaitPromise;
        return page.evaluate((source) => (0, eval)(source) as T, expression);
      },
      async waitFor<T>(
        expression: string,
        accept: (value: T) => boolean,
        timeoutMs = 60_000
      ): Promise<T> {
        const waitDeadline = Date.now() + timeoutMs;
        let value = await this.evaluate<T>(expression);
        while (!accept(value) && Date.now() < waitDeadline) {
          await delay(25);
          value = await this.evaluate<T>(expression);
        }
        if (!accept(value)) {
          let renderedValue: string;
          try {
            renderedValue = JSON.stringify(value);
          } catch {
            renderedValue = String(value);
          }
          throw new Error(`Browser condition timed out after ${String(timeoutMs)}ms: ${expression}\nLast value: ${renderedValue}`);
        }
        return value;
      },
      consoleErrors,
      async close(): Promise<void> {
        await browser.close();
      }
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export interface BrowserMeasurement {
  heapBytes: number;
  close(): Promise<void>;
}

export async function loadPackageMapInBrowser(url: string): Promise<BrowserMeasurement> {
  const browser = await openBrowserPage(url);
  try {
    await browser.waitFor<boolean>(
      "Boolean(document.querySelector('canvas') && document.body.textContent?.includes('Showing '))",
      Boolean
    );
    await browser.evaluate("new Promise(requestAnimationFrame)", true);
    await browser.command("Performance.enable");
    const metrics = await browser.command("Performance.getMetrics");
    const values = metrics.metrics as Array<{ name: string; value: number }> | undefined;
    const heapBytes = values?.find((metric) => metric.name === "JSHeapUsedSize")?.value;
    if (heapBytes === undefined) throw new Error("Browser did not report JSHeapUsedSize");
    return {
      heapBytes,
      close: () => browser.close()
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
