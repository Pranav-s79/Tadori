import { existsSync, readdirSync, watch as watchFs, type FSWatcher } from "node:fs";
import path from "node:path";

export type RepositoryChangeKind = "change" | "rename" | "rescan";

export interface RepositoryChange {
  path: string;
  kind: RepositoryChangeKind;
}

export interface RepositoryChangeBatch {
  generation: number;
  changes: RepositoryChange[];
}

export interface RepositoryWatcherOptions {
  debounceMs?: number;
  /** Upper bound for a batch during continuous save traffic. */
  maxWaitMs?: number;
  onBatch(batch: RepositoryChangeBatch): void | Promise<void>;
  onError?(error: Error): void;
}

const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
  ".tadori",
  ".next",
  ".turbo",
  ".cache"
]);

function isDatabaseArtifact(normalizedPath: string): boolean {
  const lower = normalizedPath.toLowerCase();
  return (
    lower.endsWith(".db") ||
    lower.endsWith(".sqlite") ||
    lower.endsWith(".sqlite3") ||
    lower.endsWith("-wal") ||
    lower.endsWith("-shm")
  );
}

function mergeKind(
  current: RepositoryChangeKind | undefined,
  next: RepositoryChangeKind
): RepositoryChangeKind {
  if (current === "rescan" || next === "rescan") {
    return "rescan";
  }
  if (current === "rename" || next === "rename") {
    return "rename";
  }
  return "change";
}

/**
 * Native repository watcher with deterministic debounced batches. It prefers
 * recursive `fs.watch` where the platform supports it and otherwise watches
 * every current directory, rebuilding that directory watch set after renames.
 */
export class BatchedRepositoryWatcher {
  private readonly root: string;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly watchers: FSWatcher[] = [];
  private readonly pending = new Map<string, RepositoryChangeKind>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private maxWaitTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private delivery: Promise<void> = Promise.resolve();
  private generation = 0;
  private running = false;
  private closed = false;
  private closing = false;
  private fallbackMode = false;

  constructor(root: string, private readonly options: RepositoryWatcherOptions) {
    this.root = path.resolve(root);
    this.debounceMs = options.debounceMs ?? 75;
    this.maxWaitMs = options.maxWaitMs ?? 500;
    if (!Number.isSafeInteger(this.debounceMs) || this.debounceMs < 0) {
      throw new RangeError("debounceMs must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(this.maxWaitMs) || this.maxWaitMs < this.debounceMs) {
      throw new RangeError("maxWaitMs must be a safe integer greater than or equal to debounceMs");
    }
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.options.onError?.(normalized);
  }

  private normalizedPath(candidate: string): string {
    const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(this.root, candidate);
    const relative = path.relative(this.root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Watcher path ${candidate} escapes repository root ${this.root}`);
    }
    return (relative === "" ? "." : relative).split(path.sep).join("/");
  }

  private ignored(normalizedPath: string): boolean {
    return normalizedPath
      .split("/")
      .some((segment) => IGNORED_DIRECTORY_NAMES.has(segment));
  }

  recordChange(candidate: string, kind: RepositoryChangeKind): void {
    if (this.closed || this.closing) {
      return;
    }
    const normalized = this.normalizedPath(candidate);
    if (normalized !== "." && (this.ignored(normalized) || isDatabaseArtifact(normalized))) {
      return;
    }
    this.pending.set(normalized, mergeKind(this.pending.get(normalized), kind));
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushNow();
    }, this.debounceMs);
    if (this.maxWaitTimer === null) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null;
        void this.flushNow();
      }, this.maxWaitMs);
    }
  }

  async flushNow(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    if (this.pending.size === 0) {
      await this.delivery;
      return;
    }
    const changes = [...this.pending]
      .map(([changePath, kind]) => ({ path: changePath, kind }))
      .sort((left, right) => left.path.localeCompare(right.path));
    this.pending.clear();
    const batch = { generation: ++this.generation, changes };
    this.delivery = this.delivery
      .then(() => this.options.onBatch(batch))
      .then(() => undefined)
      .catch((error: unknown) => this.reportError(error));
    await this.delivery;
  }

  async waitForIdle(): Promise<void> {
    await this.flushNow();
    await this.delivery;
  }

  private event(directory: string, eventType: string, fileName: string | Buffer | null): void {
    if (fileName === null) {
      this.recordChange(".", "rescan");
      return;
    }
    const decoded = Buffer.isBuffer(fileName) ? fileName.toString("utf8") : fileName;
    this.recordChange(path.resolve(directory, decoded), eventType === "rename" ? "rename" : "change");
    if (this.fallbackMode && eventType === "rename") {
      this.scheduleFallbackRestart();
    }
  }

  private attach(directory: string, recursive: boolean): FSWatcher {
    const watcher = watchFs(directory, { recursive }, (eventType, fileName) => {
      try {
        this.event(directory, eventType, fileName);
      } catch (error) {
        this.reportError(error);
      }
    });
    watcher.on("error", (error) => {
      this.reportError(error);
      this.recordChange(".", "rescan");
      this.scheduleFallbackRestart();
    });
    this.watchers.push(watcher);
    return watcher;
  }

  private directories(): string[] {
    const result: string[] = [];
    const visit = (directory: string): void => {
      result.push(directory);
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name)
      )) {
        if (!entry.isDirectory() || IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }
        visit(path.join(directory, entry.name));
      }
    };
    visit(this.root);
    return result;
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers.splice(0)) {
      watcher.close();
    }
  }

  private startWatchers(): void {
    this.closeWatchers();
    this.fallbackMode = false;
    try {
      this.attach(this.root, true);
      return;
    } catch (error) {
      this.closeWatchers();
      this.fallbackMode = true;
      if (!existsSync(this.root)) {
        throw error;
      }
    }
    for (const directory of this.directories()) {
      this.attach(directory, false);
    }
  }

  private scheduleFallbackRestart(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.running && !this.closed) {
        try {
          this.startWatchers();
          this.recordChange(".", "rescan");
        } catch (error) {
          this.reportError(error);
        }
      }
    }, this.debounceMs);
  }

  start(): void {
    if (this.closed) {
      throw new Error("Cannot restart a closed repository watcher");
    }
    if (this.running) {
      return;
    }
    this.startWatchers();
    this.running = true;
    this.recordChange(".", "rescan");
  }

  restart(): void {
    if (this.closed) {
      throw new Error("Cannot restart a closed repository watcher");
    }
    this.startWatchers();
    this.running = true;
    this.recordChange(".", "rescan");
  }

  async close(): Promise<void> {
    if (this.closed || this.closing) {
      return;
    }
    this.running = false;
    this.closing = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    this.closeWatchers();
    await this.flushNow();
    this.closed = true;
    this.closing = false;
    await this.delivery;
  }
}
