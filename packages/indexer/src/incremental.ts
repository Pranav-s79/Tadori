import path from "node:path";
import type { RepoStateKind, SnapshotGraph } from "@tadori/core";
import {
  ensureRepository,
  getSnapshotHead,
  insertSnapshotGraph,
  loadSnapshotGraph,
  SnapshotActivationConflictError,
  type Database,
  type SnapshotHead
} from "@tadori/store";
import {
  extractGraph,
  type ExtractedGraph,
  type IndexDiagnostic
} from "./extract.js";
import {
  captureRepository,
  indexRepositoryIntoStore,
  type RepositoryCapture
} from "./indexRepository.js";
import { mergeSnapshotRegion, UnsafeIncrementalMergeError } from "./merge.js";
import { IncrementalProjectServices, type ProjectServices } from "./project.js";
import type { ScannedFile } from "./scan.js";
import { ANALYZER_VERSION } from "./version.js";
import {
  BatchedRepositoryWatcher,
  type RepositoryChange,
  type RepositoryChangeBatch,
  type RepositoryWatcherOptions
} from "./watcher.js";

export type RefreshPhase = "idle" | "dirty" | "refreshing" | "failed" | "stopped";
export type RefreshMode = "noop" | "regional" | "full";

export interface IncrementalRefreshMetrics {
  generation: number;
  mode: RefreshMode;
  reason: string;
  changedPaths: string[];
  affectedPaths: string[];
  durationMs: number;
  extractionMs: number;
  publicationMs: number;
  snapshotId: number;
  activationId: number;
  reusedSnapshot: boolean;
  diagnostics: IndexDiagnostic[];
}

export interface IncrementalIndexerState {
  phase: RefreshPhase;
  generation: number;
  dirtyPaths: string[];
  affectedPaths: string[];
  snapshotId: number | null;
  activationId: number | null;
  lastRefresh: IncrementalRefreshMetrics | null;
  lastError: Error | null;
}

export interface IncrementalRepositoryIndexerOptions {
  kind?: Extract<RepoStateKind, "working_tree">;
  label?: string | null;
  /** Called after a complete, stable graph is built and before CAS publication. */
  beforePublish?(metrics: {
    generation: number;
    mode: Exclude<RefreshMode, "noop">;
    changedPaths: readonly string[];
    affectedPaths: readonly string[];
  }): void | Promise<void>;
  /** Receives lifecycle transitions; used by the isolated MCP refresh worker. */
  onStateChange?(state: IncrementalIndexerState): void;
}

export class InvalidChangedSourceError extends Error {
  constructor(public readonly diagnostics: readonly string[]) {
    super(`Changed source has syntactic errors: ${diagnostics.join("; ")}`);
    this.name = "InvalidChangedSourceError";
  }
}

class ObsoleteRefreshError extends Error {
  constructor() {
    super("Refresh was superseded before publication");
    this.name = "ObsoleteRefreshError";
  }
}

class NoRepositoryChangesError extends Error {
  constructor() {
    super("Watcher hints did not correspond to a repository content change");
    this.name = "NoRepositoryChangesError";
  }
}

interface BuildResult {
  graph: SnapshotGraph;
  capture: RepositoryCapture;
  diagnostics: IndexDiagnostic[];
  mode: Exclude<RefreshMode, "noop">;
  reason: string;
  changedPaths: string[];
  affectedPaths: string[];
  extractionMs: number;
}

const DECLARATION_KINDS = new Set(["function", "method", "class", "interface", "type"]);
const CONFIG_NAMES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
  ".gitignore",
  ".tadoriignore"
]);

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function graphFromStored(head: SnapshotHead, root: string, stored: ReturnType<typeof loadSnapshotGraph>): SnapshotGraph {
  return {
    repoRootPath: path.resolve(root).split(path.sep).join("/"),
    kind: head.snapshot.kind,
    label: head.snapshot.label,
    baseCommitSha: head.snapshot.base_commit_sha,
    workspaceHash: head.snapshot.workspace_hash,
    analyzerVersion: stored.analyzerVersion,
    files: stored.files,
    nodes: stored.nodes,
    edges: stored.edges
  };
}

function sourceFiles(capture: RepositoryCapture): string[] {
  return capture.scan.indexedFiles
    .filter((file) => file.language === "typescript" || file.language === "javascript")
    .map((file) => file.absolutePath);
}

function capturedTexts(root: string, capture: RepositoryCapture): Map<string, string> {
  return new Map(
    [...capture.fileContents].map(([normalizedPath, contents]) => [
      path.resolve(root, normalizedPath),
      contents.toString("utf8")
    ])
  );
}

function composeGraph(
  root: string,
  capture: RepositoryCapture,
  extracted: ExtractedGraph,
  kind: RepoStateKind,
  label: string | null
): SnapshotGraph {
  return {
    repoRootPath: path.resolve(root).split(path.sep).join("/"),
    kind,
    label,
    baseCommitSha: null,
    workspaceHash: capture.workspaceHash,
    analyzerVersion: ANALYZER_VERSION,
    files: extracted.files,
    nodes: extracted.nodes,
    edges: extracted.edges
  };
}

function manifestChanges(
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>
): string[] {
  return sorted(
    new Set([...previous.keys(), ...current.keys()]).values()
  ).filter((file) => previous.get(file) !== current.get(file));
}

function filesByPath(capture: RepositoryCapture): Map<string, ScannedFile> {
  return new Map(
    [...capture.scan.indexedFiles, ...capture.scan.supportFiles].map((file) => [
      file.normalizedPath,
      file
    ])
  );
}

function structuralSurface(graph: SnapshotGraph, region: ReadonlySet<string>): string[] {
  return graph.nodes
    .filter(
      (node) =>
        node.file !== null && region.has(node.file) && DECLARATION_KINDS.has(node.kind)
    )
    .map((node) =>
      JSON.stringify([
        node.entityKey,
        node.kind,
        node.signature,
        node.exported,
        node.qualifiedName
      ])
    )
    .sort();
}

/**
 * Coordinates dirty-state tracking, persistent TypeScript parsing, safe
 * regional replacement, deterministic full fallback, and atomic publication.
 * Watcher callbacks only enqueue work, so later generations can supersede a
 * build before its CAS activation.
 */
export class IncrementalRepositoryIndexer {
  private readonly root: string;
  private readonly kind: "working_tree";
  private readonly label: string | null;
  private readonly dirty = new Map<string, RepositoryChange["kind"]>();
  private readonly affected = new Set<string>();
  private generation = 0;
  private phase: RefreshPhase = "idle";
  private lastRefresh: IncrementalRefreshMetrics | null = null;
  private lastError: Error | null = null;
  private head: SnapshotHead | null = null;
  private graph: SnapshotGraph | null = null;
  private baselineCapture: RepositoryCapture | null = null;
  private projects: IncrementalProjectServices | null = null;
  private processing: Promise<void> | null = null;
  private initialized = false;
  private stopped = false;
  private watcher: BatchedRepositoryWatcher | null = null;
  private baselineDoesNotMatchHead = false;
  private baselineMismatchReason: string | null = null;

  constructor(
    private readonly db: Database,
    root: string,
    private readonly options: IncrementalRepositoryIndexerOptions = {}
  ) {
    this.root = path.resolve(root);
    this.kind = options.kind ?? "working_tree";
    this.label = options.label ?? null;
  }

  private notifyStateChange(): void {
    this.options.onStateChange?.(this.state());
  }

  async initialize(): Promise<SnapshotHead> {
    if (this.stopped) {
      throw new Error("Cannot initialize a stopped incremental indexer");
    }
    if (this.initialized && this.head) {
      return this.head;
    }
    const repoRoot = this.root.split(path.sep).join("/");
    const repoId = ensureRepository(this.db, repoRoot);
    let head = getSnapshotHead(this.db, repoId, this.kind);
    if (!head) {
      const initial = indexRepositoryIntoStore(this.db, this.root, {
        kind: this.kind,
        label: this.label
      });
      if (initial.activationId === null) {
        throw new Error("Initial index completed without an activation");
      }
      head = getSnapshotHead(this.db, initial.repoId, this.kind);
      if (!head) {
        throw new Error("Initial snapshot activation was not visible");
      }
    }
    const stored = loadSnapshotGraph(this.db, head.snapshot.id);
    this.head = head;
    this.graph = graphFromStored(head, this.root, stored);
    this.baselineCapture = captureRepository(this.root);
    this.baselineDoesNotMatchHead =
      this.baselineCapture.workspaceHash !== head.snapshot.workspace_hash ||
      this.graph.analyzerVersion !== ANALYZER_VERSION;
    this.baselineMismatchReason =
      this.graph.analyzerVersion !== ANALYZER_VERSION
        ? "stored analyzer version differs from the current indexer"
        : this.baselineCapture.workspaceHash !== head.snapshot.workspace_hash
          ? "restart reconciliation found a workspace different from the served head"
          : null;
    this.projects = new IncrementalProjectServices(
      this.root,
      sourceFiles(this.baselineCapture),
      capturedTexts(this.root, this.baselineCapture)
    );
    this.initialized = true;
    this.phase = "idle";
    if (this.baselineDoesNotMatchHead) {
      this.enqueue([{ path: ".", kind: "rescan" }]);
    } else {
      this.notifyStateChange();
    }
    return head;
  }

  state(): IncrementalIndexerState {
    return {
      phase: this.phase,
      generation: this.generation,
      dirtyPaths: sorted(this.dirty.keys()),
      affectedPaths: sorted(this.affected),
      snapshotId: this.head?.snapshot.id ?? null,
      activationId: this.head?.activationId ?? null,
      lastRefresh: this.lastRefresh,
      lastError: this.lastError
    };
  }

  isPathDirty(normalizedPath: string): boolean {
    return this.dirty.has(normalizedPath) || this.affected.has(normalizedPath);
  }

  isPathStaleForSnapshot(snapshotId: number, normalizedPath: string): boolean {
    return this.head?.snapshot.id !== snapshotId || this.isPathDirty(normalizedPath);
  }

  isSnapshotStale(snapshotId: number): boolean {
    return this.head?.snapshot.id !== snapshotId || this.dirty.size > 0 || this.affected.size > 0;
  }

  /**
   * Cancels the pending publication generation. Synchronous TypeScript passes
   * finish their current boundary, but their graph can never activate after
   * this generation changes.
   */
  cancelPendingRefresh(): void {
    if (!this.initialized || this.stopped) {
      return;
    }
    this.generation += 1;
    this.dirty.clear();
    this.affected.clear();
    this.phase = "idle";
    this.notifyStateChange();
  }

  enqueue(changes: readonly RepositoryChange[] | RepositoryChangeBatch): number {
    if (this.stopped) {
      throw new Error("Cannot enqueue changes after the incremental indexer stopped");
    }
    if (!this.initialized) {
      throw new Error("Initialize the incremental indexer before enqueueing changes");
    }
    const values = "changes" in changes ? changes.changes : changes;
    for (const change of values) {
      const normalized = change.path.split("\\").join("/");
      const previous = this.dirty.get(normalized);
      const kind =
        previous === "rescan" || change.kind === "rescan"
          ? "rescan"
          : previous === "rename" || change.kind === "rename"
            ? "rename"
            : "change";
      this.dirty.set(normalized, kind);
      const graphPaths = new Set(this.graph?.files.map((file) => file.normalizedPath) ?? []);
      const requiresWholeGraph =
        kind !== "change" ||
        normalized === "." ||
        CONFIG_NAMES.has(path.posix.basename(normalized)) ||
        !graphPaths.has(normalized);
      for (const affectedPath of requiresWholeGraph
        ? graphPaths
        : this.reverseImportClosure([normalized])) {
        this.affected.add(affectedPath);
      }
    }
    this.generation += 1;
    this.phase = "dirty";
    this.lastError = null;
    this.schedule();
    this.notifyStateChange();
    return this.generation;
  }

  async refresh(changes: readonly RepositoryChange[]): Promise<IncrementalIndexerState> {
    await this.initialize();
    this.enqueue(changes);
    await this.waitForIdle();
    return this.state();
  }

  private schedule(): void {
    if (this.processing !== null || !this.initialized) {
      return;
    }
    this.processing = Promise.resolve()
      .then(() => this.processLoop())
      .finally(() => {
        this.processing = null;
        if (this.dirty.size > 0 && this.phase !== "failed" && !this.stopped) {
          this.schedule();
        }
      });
  }

  private async processLoop(): Promise<void> {
    while (this.dirty.size > 0 && !this.stopped) {
      const buildGeneration = this.generation;
      const hinted = new Map(this.dirty);
      this.phase = "refreshing";
      this.notifyStateChange();
      const startedAt = performance.now();
      try {
        await nextTurn();
        if (buildGeneration !== this.generation || this.stopped) {
          continue;
        }
        const result = this.build(hinted);
        this.affected.clear();
        for (const file of result.affectedPaths) {
          this.affected.add(file);
        }
        this.notifyStateChange();
        await nextTurn();
        const verified = captureRepository(this.root);
        if (
          buildGeneration !== this.generation ||
          this.stopped ||
          verified.workspaceHash !== result.capture.workspaceHash
        ) {
          if (buildGeneration === this.generation && !this.stopped) {
            this.dirty.set(".", "rescan");
            this.generation += 1;
          }
          throw new ObsoleteRefreshError();
        }
        await this.options.beforePublish?.({
          generation: buildGeneration,
          mode: result.mode,
          changedPaths: result.changedPaths,
          affectedPaths: result.affectedPaths
        });
        if (buildGeneration !== this.generation || this.stopped) {
          throw new ObsoleteRefreshError();
        }
        const finalCapture = captureRepository(this.root);
        if (finalCapture.workspaceHash !== result.capture.workspaceHash) {
          this.dirty.set(".", "rescan");
          this.generation += 1;
          throw new ObsoleteRefreshError();
        }
        const publicationStartedAt = performance.now();
        const inserted = insertSnapshotGraph(this.db, result.graph, {
          parentSnapshotId: this.head?.snapshot.id ?? null,
          expectedActivationId: this.head?.activationId ?? null
        });
        if (inserted.activationId === null) {
          throw new Error("Validated refresh completed without an activation");
        }
        const nextHead = getSnapshotHead(this.db, inserted.repoId, this.kind);
        if (!nextHead || nextHead.activationId !== inserted.activationId) {
          throw new Error("Published activation is not the visible working-tree head");
        }
        this.head = nextHead;
        this.graph = result.graph;
        this.baselineCapture = result.capture;
        this.baselineDoesNotMatchHead = false;
        this.baselineMismatchReason = null;
        this.dirty.clear();
        this.affected.clear();
        this.phase = "idle";
        this.lastError = null;
        this.lastRefresh = {
          generation: buildGeneration,
          mode: result.mode,
          reason: result.reason,
          changedPaths: result.changedPaths,
          affectedPaths: result.affectedPaths,
          durationMs: performance.now() - startedAt,
          extractionMs: result.extractionMs,
          publicationMs: performance.now() - publicationStartedAt,
          snapshotId: inserted.snapshotId,
          activationId: inserted.activationId,
          reusedSnapshot: inserted.reused,
          diagnostics: result.diagnostics
        };
        this.notifyStateChange();
      } catch (error) {
        if (error instanceof NoRepositoryChangesError) {
          this.phase = "idle";
          if (!this.head) {
            throw new Error("No active head exists for a no-op refresh");
          }
          this.lastRefresh = {
            generation: buildGeneration,
            mode: "noop",
            reason: "watcher hints reconciled to the currently served workspace",
            changedPaths: [],
            affectedPaths: [],
            durationMs: performance.now() - startedAt,
            extractionMs: 0,
            publicationMs: 0,
            snapshotId: this.head.snapshot.id,
            activationId: this.head.activationId,
            reusedSnapshot: true,
            diagnostics: []
          };
          this.notifyStateChange();
          continue;
        }
        if (error instanceof ObsoleteRefreshError) {
          this.phase = this.stopped ? "stopped" : this.dirty.size > 0 ? "dirty" : "idle";
          this.notifyStateChange();
          continue;
        }
        if (error instanceof SnapshotActivationConflictError) {
          this.reloadHead();
          this.dirty.set(".", "rescan");
          this.generation += 1;
          this.phase = "dirty";
          this.notifyStateChange();
          continue;
        }
        this.lastError = error instanceof Error ? error : new Error(String(error));
        this.phase = "failed";
        this.notifyStateChange();
        return;
      }
    }
  }

  private reloadHead(): void {
    if (!this.head) {
      return;
    }
    const current = getSnapshotHead(this.db, this.head.snapshot.repo_id, this.kind);
    if (!current) {
      throw new Error("Working-tree head disappeared during conflict recovery");
    }
    this.head = current;
    this.graph = graphFromStored(current, this.root, loadSnapshotGraph(this.db, current.snapshot.id));
  }

  private build(hinted: ReadonlyMap<string, RepositoryChange["kind"]>): BuildResult {
    if (!this.graph || !this.baselineCapture || !this.projects) {
      throw new Error("Incremental indexer has not been initialized");
    }
    const capture = captureRepository(this.root);
    const changedPaths = this.baselineDoesNotMatchHead
      ? sorted([
          ...capture.fileHashes.keys(),
          ...this.graph.files.map((file) => file.normalizedPath)
        ])
      : manifestChanges(this.baselineCapture.fileHashes, capture.fileHashes);
    if (changedPaths.length === 0) {
      this.dirty.clear();
      this.affected.clear();
      this.phase = "idle";
      throw new NoRepositoryChangesError();
    }

    const beforeFiles = filesByPath(this.baselineCapture);
    const afterFiles = filesByPath(capture);
    const structuralHint = [...hinted.values()].some(
      (kind) => kind === "rename" || kind === "rescan"
    );
    const rootsChanged = changedPaths.some(
      (file) => !beforeFiles.has(file) || !afterFiles.has(file)
    );
    const configChanged = changedPaths.some(
      (file) =>
        CONFIG_NAMES.has(path.posix.basename(file)) ||
        beforeFiles.get(file)?.indexed === false ||
        afterFiles.get(file)?.indexed === false
    );
    if (rootsChanged || configChanged) {
      this.projects.dispose();
      this.projects = new IncrementalProjectServices(
        this.root,
        sourceFiles(capture),
        capturedTexts(this.root, capture)
      );
    } else {
      this.projects.refresh(
        sourceFiles(capture),
        changedPaths
          .map((file) => afterFiles.get(file)?.absolutePath)
          .filter((file): file is string => file !== undefined),
        capturedTexts(this.root, capture)
      );
    }
    const services = this.projects.initial();
    this.rejectSyntacticallyInvalidChanges(services, capture, changedPaths);

    const extractionStartedAt = performance.now();
    let extracted: ExtractedGraph;
    let graph: SnapshotGraph;
    let mode: Exclude<RefreshMode, "noop">;
    let reason: string;
    let affectedPaths: string[];
    const regionalCandidates = changedPaths.filter(
      (file) => beforeFiles.get(file)?.indexed === true && afterFiles.get(file)?.indexed === true
    );
    const fullRequired =
      this.baselineDoesNotMatchHead ||
      structuralHint ||
      rootsChanged ||
      configChanged ||
      regionalCandidates.length !== changedPaths.length;

    if (!fullRequired) {
      affectedPaths = this.reverseImportClosure(regionalCandidates);
      try {
        extracted = extractGraph(this.root, capture.scan, services, {
          fileRegion: affectedPaths,
          seedGraph: this.graph,
          fileContents: capture.fileContents
        });
        const target = composeGraph(this.root, capture, extracted, this.kind, this.label);
        graph = mergeSnapshotRegion(this.graph, extracted, {
          invalidatedFiles: affectedPaths,
          target: {
            repoRootPath: target.repoRootPath,
            kind: target.kind,
            label: target.label,
            baseCommitSha: target.baseCommitSha,
            workspaceHash: target.workspaceHash,
            analyzerVersion: target.analyzerVersion
          }
        });
        const region = new Set(affectedPaths);
        if (
          JSON.stringify(structuralSurface(this.graph, region)) !==
          JSON.stringify(structuralSurface(graph, region))
        ) {
          throw new UnsafeIncrementalMergeError(
            "Declaration signature or export surface changed; use full extraction"
          );
        }
        mode = "regional";
        reason = affectedPaths.length === changedPaths.length
          ? "existing-file region proven merge-safe"
          : "reverse-import dependency region proven merge-safe";
      } catch (error) {
        // Every regional extraction/merge failure is intentionally converted
        // into a deterministic complete extraction.
        extracted = extractGraph(this.root, capture.scan, services, {
          fileContents: capture.fileContents
        });
        graph = composeGraph(this.root, capture, extracted, this.kind, this.label);
        mode = "full";
        reason = `regional proof failed: ${error instanceof Error ? error.message : String(error)}`;
        affectedPaths = capture.scan.indexedFiles.map((file) => file.normalizedPath);
      }
    } else {
      extracted = extractGraph(this.root, capture.scan, services, {
        fileContents: capture.fileContents
      });
      graph = composeGraph(this.root, capture, extracted, this.kind, this.label);
      mode = "full";
      affectedPaths = capture.scan.indexedFiles.map((file) => file.normalizedPath);
      reason = rootsChanged
        ? "file addition, deletion, or move requires full extraction"
        : this.baselineDoesNotMatchHead
          ? (this.baselineMismatchReason ?? "served head requires full reconciliation")
        : configChanged
          ? "configuration or support-file change requires full extraction"
          : structuralHint
            ? "rename/rescan hint requires full extraction"
            : "dependency region could not be proven complete";
    }
    return {
      graph,
      capture,
      diagnostics: extracted.diagnostics,
      mode,
      reason,
      changedPaths,
      affectedPaths: sorted(affectedPaths),
      extractionMs: performance.now() - extractionStartedAt
    };
  }

  private reverseImportClosure(changedPaths: readonly string[]): string[] {
    if (!this.graph) {
      return sorted(changedPaths);
    }
    const fileByNode = new Map(
      this.graph.nodes.map((node) => [node.entityKey, node.file])
    );
    const importersByTarget = new Map<string, Set<string>>();
    for (const edge of this.graph.edges) {
      if (edge.relation !== "imports") {
        continue;
      }
      const source = fileByNode.get(edge.srcEntityKey);
      const target = fileByNode.get(edge.dstEntityKey);
      if (!source || !target) {
        continue;
      }
      const importers = importersByTarget.get(target) ?? new Set<string>();
      importers.add(source);
      importersByTarget.set(target, importers);
    }
    const closure = new Set(changedPaths);
    const queue = [...changedPaths];
    while (queue.length > 0) {
      const target = queue.shift();
      if (!target) {
        continue;
      }
      for (const importer of importersByTarget.get(target) ?? []) {
        if (!closure.has(importer)) {
          closure.add(importer);
          queue.push(importer);
        }
      }
    }
    return sorted(closure);
  }

  private rejectSyntacticallyInvalidChanges(
    services: ProjectServices,
    capture: RepositoryCapture,
    changedPaths: readonly string[]
  ): void {
    const changed = new Set(changedPaths);
    const diagnostics: string[] = [];
    for (const file of capture.scan.indexedFiles) {
      if (
        !changed.has(file.normalizedPath) ||
        (file.language !== "typescript" && file.language !== "javascript")
      ) {
        continue;
      }
      for (const diagnostic of services.languageService.getSyntacticDiagnostics(file.absolutePath)) {
        diagnostics.push(
          `${file.normalizedPath}: ${String(diagnostic.code)} ${String(diagnostic.messageText)}`
        );
      }
    }
    if (diagnostics.length > 0) {
      throw new InvalidChangedSourceError(diagnostics);
    }
  }

  async waitForIdle(): Promise<void> {
    for (;;) {
      await this.processing;
      if (this.processing === null) {
        return;
      }
    }
  }

  async startWatching(
    options: Omit<RepositoryWatcherOptions, "onBatch"> = {}
  ): Promise<void> {
    await this.initialize();
    await this.waitForIdle();
    if (this.watcher) {
      return;
    }
    this.watcher = new BatchedRepositoryWatcher(this.root, {
      ...options,
      onBatch: (batch) => {
        this.enqueue(batch);
      }
    });
    this.watcher.start();
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.generation += 1;
    this.phase = "stopped";
    this.notifyStateChange();
    await this.watcher?.close();
    await this.processing;
    this.projects?.dispose();
  }
}
