import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { Database } from "@tadori/store";
import type { RefreshFreshnessOverlay } from "./service.js";
import type {
  RefreshHostMessage,
  RefreshWorkerData,
  RefreshWorkerMessage,
  SerializedRefreshState
} from "./refreshProtocol.js";

export interface ConcurrentRefreshOptions {
  onError?(error: Error): void;
}

const EMPTY_STATE: SerializedRefreshState = {
  phase: "idle",
  generation: 0,
  dirtyPaths: [],
  affectedPaths: [],
  snapshotId: null,
  activationId: null,
  lastError: null
};

function refreshWorkerUrl(): URL {
  const extension = fileURLToPath(import.meta.url).endsWith(".ts") ? ".ts" : ".js";
  return new URL(`./refreshWorker${extension}`, import.meta.url);
}

function createRefreshWorker(data: RefreshWorkerData): Worker {
  const workerUrl = refreshWorkerUrl();
  if (workerUrl.pathname.endsWith(".js")) {
    return new Worker(workerUrl, { workerData: data });
  }
  const require = createRequire(import.meta.url);
  const tsxApiUrl = pathToFileURL(require.resolve("tsx/esm/api")).href;
  const bootstrap = [
    `import { tsImport } from ${JSON.stringify(tsxApiUrl)};`,
    `await tsImport(${JSON.stringify(workerUrl.href)}, ${JSON.stringify(import.meta.url)});`
  ].join("\n");
  return new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), {
    workerData: data
  });
}

/**
 * Mirrors refresh state from an isolated writer/compiler worker. MCP reads stay
 * responsive on the host event loop and use their own WAL connection.
 */
export class ConcurrentRefreshController implements RefreshFreshnessOverlay {
  private stateValue: SerializedRefreshState = EMPTY_STATE;
  private fatalError: Error | null = null;
  private stopped = false;
  private workerExited = false;
  private stopPromise: Promise<void> | null = null;

  private constructor(
    private readonly worker: Worker,
    private readonly options: ConcurrentRefreshOptions
  ) {}

  static async start(
    db: Database,
    repoRoot: string,
    options: ConcurrentRefreshOptions = {}
  ): Promise<ConcurrentRefreshController> {
    if (db.memory || db.name === ":memory:") {
      throw new Error("Concurrent refresh requires a file-backed SQLite database");
    }
    const worker = createRefreshWorker({ dbPath: db.name, repoRoot });
    const controller = new ConcurrentRefreshController(worker, options);
    try {
      await controller.waitUntilReady();
      return controller;
    } catch (error) {
      await worker.terminate();
      throw error;
    }
  }

  private waitUntilReady(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onMessage = (message: RefreshWorkerMessage): void => {
        this.receive(message);
        if (message.type === "ready") {
          cleanup();
          resolve();
        } else if (message.type === "fatal") {
          cleanup();
          reject(this.fatalError ?? new Error(message.error.message));
        }
      };
      const onError = (error: Error): void => {
        cleanup();
        this.recordFatal(error);
        reject(error);
      };
      const onExit = (code: number): void => {
        onError(new Error(`Refresh worker exited during startup with code ${String(code)}`));
      };
      const cleanup = (): void => {
        this.worker.off("message", onMessage);
        this.worker.off("error", onError);
        this.worker.off("exit", onExit);
      };
      this.worker.on("message", onMessage);
      this.worker.once("error", onError);
      this.worker.once("exit", onExit);
    }).then(() => {
      this.worker.on("message", (message: RefreshWorkerMessage) => this.receive(message));
      this.worker.on("error", (error) => this.recordFatal(error));
      this.worker.on("exit", (code) => {
        this.workerExited = true;
        if (!this.stopped && code !== 0) {
          this.recordFatal(new Error(`Refresh worker exited with code ${String(code)}`));
        }
      });
    });
  }

  private receive(message: RefreshWorkerMessage): void {
    if (message.type === "state" || message.type === "ready") {
      this.stateValue = message.state;
    } else if (message.type === "fatal") {
      this.recordFatal(Object.assign(new Error(message.error.message), { name: message.error.name }));
    }
  }

  private recordFatal(error: Error): void {
    if (this.fatalError) {
      return;
    }
    this.fatalError = error;
    this.stateValue = {
      ...this.stateValue,
      phase: "failed",
      lastError: { name: error.name, message: error.message }
    };
    this.options.onError?.(error);
  }

  state(): SerializedRefreshState {
    return {
      ...this.stateValue,
      dirtyPaths: [...this.stateValue.dirtyPaths],
      affectedPaths: [...this.stateValue.affectedPaths],
      lastError: this.stateValue.lastError ? { ...this.stateValue.lastError } : null
    };
  }

  isPathStaleForSnapshot(snapshotId: number, normalizedPath: string): boolean {
    return (
      this.fatalError !== null ||
      this.stateValue.snapshotId !== snapshotId ||
      this.stateValue.dirtyPaths.includes(".") ||
      this.stateValue.dirtyPaths.includes(normalizedPath) ||
      this.stateValue.affectedPaths.includes(normalizedPath)
    );
  }

  isSnapshotStale(snapshotId: number): boolean {
    return (
      this.fatalError !== null ||
      this.stateValue.snapshotId !== snapshotId ||
      this.stateValue.dirtyPaths.length > 0 ||
      this.stateValue.affectedPaths.length > 0
    );
  }

  stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopped = true;
    this.stopPromise = this.stopWorker();
    return this.stopPromise;
  }

  private async stopWorker(): Promise<void> {
    if (this.workerExited) {
      return;
    }
    const stopped = new Promise<void>((resolve, reject) => {
      const onMessage = (message: RefreshWorkerMessage): void => {
        if (message.type === "stopped") {
          cleanup();
          resolve();
        } else if (message.type === "fatal") {
          cleanup();
          reject(Object.assign(new Error(message.error.message), { name: message.error.name }));
        }
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onExit = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        this.worker.off("message", onMessage);
        this.worker.off("error", onError);
        this.worker.off("exit", onExit);
      };
      this.worker.on("message", onMessage);
      this.worker.once("error", onError);
      this.worker.once("exit", onExit);
    });
    this.worker.postMessage({ type: "stop" } satisfies RefreshHostMessage);
    try {
      await stopped;
    } finally {
      await this.worker.terminate();
    }
  }
}
