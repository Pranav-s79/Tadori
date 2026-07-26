import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createSyntheticCorpus, type SyntheticCorpus } from "./syntheticCorpus.mts";

const START_TIMEOUT_MS = 120_000;
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

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

interface CdpResponse {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id === undefined) return;
      const waiter = this.pending.get(message.id);
      if (waiter === undefined) return;
      this.pending.delete(message.id);
      if (message.error !== undefined) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result ?? {});
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

export interface BrowserMeasurement {
  heapBytes: number;
  close(): Promise<void>;
}

export async function loadPackageMapInBrowser(url: string): Promise<BrowserMeasurement> {
  const executable = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (executable === undefined) {
    throw new Error("Browser heap benchmark requires an installed Chrome or Edge executable");
  }
  const profile = mkdtempSync(path.join(tmpdir(), "tadori-benchmark-browser-"));
  const browser = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore", windowsHide: true });

  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    const deadline = Date.now() + 30_000;
    while (!existsSync(portFile) && Date.now() < deadline) await delay(25);
    if (!existsSync(portFile)) throw new Error("Browser did not expose a DevTools port within 30000ms");
    const [port] = readFileSync(portFile, "utf8").split(/\r?\n/);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!targetResponse.ok) throw new Error(`DevTools target creation failed: HTTP ${String(targetResponse.status)}`);
    const target = await targetResponse.json() as { webSocketDebuggerUrl: string };
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("DevTools WebSocket failed")), { once: true });
    });
    const cdp = new CdpClient(socket);
    await cdp.send("Runtime.enable");
    await cdp.send("Performance.enable");
    await cdp.send("Page.navigate", { url });

    const interactiveDeadline = Date.now() + 60_000;
    let interactive = false;
    while (!interactive && Date.now() < interactiveDeadline) {
      const evaluation = await cdp.send("Runtime.evaluate", {
        expression: "Boolean(document.querySelector('canvas') && document.body.textContent?.includes('Showing '))",
        returnByValue: true
      });
      const result = evaluation.result as { value?: unknown } | undefined;
      interactive = result?.value === true;
      if (!interactive) await delay(25);
    }
    if (!interactive) throw new Error("Package map did not reach a real-data canvas paint within 60000ms");
    await cdp.send("Runtime.evaluate", { expression: "new Promise(requestAnimationFrame)", awaitPromise: true });
    const metrics = await cdp.send("Performance.getMetrics");
    const values = metrics.metrics as Array<{ name: string; value: number }> | undefined;
    const heapBytes = values?.find((metric) => metric.name === "JSHeapUsedSize")?.value;
    if (heapBytes === undefined) throw new Error("Browser did not report JSHeapUsedSize");
    return {
      heapBytes,
      async close(): Promise<void> {
        socket.close();
        await stopProcess(browser);
        rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      }
    };
  } catch (error) {
    await stopProcess(browser);
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    throw error;
  }
}
