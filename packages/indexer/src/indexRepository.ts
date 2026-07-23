import { readFileSync } from "node:fs";
import path from "node:path";
import type { RepoStateKind, SnapshotGraph } from "@tadori/core";
import { sha256Hex, sha256HexBytes } from "@tadori/core";
import type { Database, InsertSnapshotOptions, InsertSnapshotResult } from "@tadori/store";
import { insertSnapshotGraph } from "@tadori/store";
import { computeCoChangeEdges } from "./coChange.js";
import { extractGraph, type ExtractedGraph, type IndexDiagnostic } from "./extract.js";
import { createProjectServices } from "./project.js";
import { scanRepository, type ScanResult } from "./scan.js";
import { ANALYZER_VERSION } from "./version.js";

export interface IndexOptions {
  kind: RepoStateKind;
  label?: string | null;
  baseCommitSha?: string | null;
  /**
   * Additively derive `changed_with` (git co-change) edges over the static
   * graph (09-04). OFF by default so fixture/harness extraction never emits
   * `changed_with` and the frozen golden edge diffs stay intact; live serving
   * turns it on. Fails closed (no git / no history → no edges).
   */
  extractCoChange?: boolean;
}

export class WorkspaceChangedDuringIndexError extends Error {
  constructor() {
    super("Repository contents changed while indexing; the mixed-time snapshot was discarded");
    this.name = "WorkspaceChangedDuringIndexError";
  }
}

export class InvalidRepositorySourceError extends Error {
  constructor(public readonly diagnostics: readonly string[]) {
    super(`Repository source has syntactic errors: ${diagnostics.join("; ")}`);
    this.name = "InvalidRepositorySourceError";
  }
}

function rejectSyntacticallyInvalidRepository(
  services: ReturnType<typeof createProjectServices>,
  scan: ScanResult
): void {
  const diagnostics: string[] = [];
  for (const file of scan.indexedFiles) {
    if (file.language !== "typescript" && file.language !== "javascript") {
      continue;
    }
    for (const diagnostic of services.languageService.getSyntacticDiagnostics(file.absolutePath)) {
      diagnostics.push(
        `${file.normalizedPath}: ${String(diagnostic.code)} ${String(diagnostic.messageText)}`
      );
    }
  }
  if (diagnostics.length > 0) {
    throw new InvalidRepositorySourceError(diagnostics.sort());
  }
}

export interface RepositoryCapture {
  scan: ScanResult;
  fileHashes: ReadonlyMap<string, string>;
  fileContents: ReadonlyMap<string, Buffer>;
  workspaceHash: string;
}

export interface IndexResult {
  graph: SnapshotGraph;
  scan: ScanResult;
  extracted: ExtractedGraph;
  diagnostics: IndexDiagnostic[];
  durationMs: number;
}

/**
 * Deterministic workspace hash: SHA-256 over the sorted list of
 * `<normalized path>\0<content hash>` lines, joined with newlines.
 */
export function computeWorkspaceHash(
  files: ReadonlyArray<{ normalizedPath: string; contentHash: string }>
): string {
  const lines = files
    .map((f) => `${f.normalizedPath}\0${f.contentHash}`)
    .sort()
    .join("\n");
  return sha256Hex(lines);
}

/** Captures the complete indexed/support manifest used as a publication guard. */
export function captureRepository(rootPath: string): RepositoryCapture {
  const root = path.resolve(rootPath);
  const scan = scanRepository(root);
  const fileContents = new Map(
    [...scan.indexedFiles, ...scan.supportFiles].map((file) => [
      file.normalizedPath,
      readFileSync(file.absolutePath)
    ])
  );
  const fileHashes = new Map(
    [...fileContents].map(([normalizedPath, contents]) => [
      normalizedPath,
      sha256HexBytes(contents)
    ])
  );
  return {
    scan,
    fileHashes,
    fileContents,
    workspaceHash: computeWorkspaceHash(
      [...fileHashes].map(([normalizedPath, contentHash]) => ({
        normalizedPath,
        contentHash
      }))
    )
  };
}

/** Indexes one repository state into an in-memory snapshot graph. */
export function indexRepository(rootPath: string, options: IndexOptions): IndexResult {
  const startedAt = performance.now();
  const root = path.resolve(rootPath);
  const captured = captureRepository(root);
  const { scan } = captured;
  const services = createProjectServices(
    root,
    scan.indexedFiles
      .filter((f) => f.language === "typescript" || f.language === "javascript")
      .map((f) => f.absolutePath),
    new Map(
      [...captured.fileContents].map(([normalizedPath, contents]) => [
        path.resolve(root, normalizedPath),
        contents.toString("utf8")
      ])
    )
  );
  let extracted: ExtractedGraph;
  try {
    rejectSyntacticallyInvalidRepository(services, scan);
    extracted = extractGraph(root, scan, services, { fileContents: captured.fileContents });
    const verified = captureRepository(root);
    if (verified.workspaceHash !== captured.workspaceHash) {
      throw new WorkspaceChangedDuringIndexError();
    }
  } finally {
    services.languageService.dispose();
  }

  // Additive 09-04 pass: git co-change edges, only when explicitly requested
  // (live serving). Fails closed, so a git-less repo yields the static graph
  // unchanged. Fixture extraction never sets this, keeping golden diffs frozen.
  const coChangeEdges = options.extractCoChange
    ? computeCoChangeEdges(
        root,
        extracted.nodes.filter((n) => n.kind === "file")
      )
    : [];

  const graph: SnapshotGraph = {
    repoRootPath: root.split(path.sep).join("/"),
    kind: options.kind,
    label: options.label ?? null,
    baseCommitSha: options.baseCommitSha ?? null,
    workspaceHash: captured.workspaceHash,
    analyzerVersion: ANALYZER_VERSION,
    files: extracted.files,
    nodes: extracted.nodes,
    edges: [...extracted.edges, ...coChangeEdges]
  };

  return {
    graph,
    scan,
    extracted,
    diagnostics: extracted.diagnostics,
    durationMs: performance.now() - startedAt
  };
}

export interface IndexIntoStoreResult extends IndexResult {
  repoId: number;
  snapshotId: number;
  activationId: number | null;
  reused: boolean;
}

/** Indexes a repository state and persists it as a validated snapshot. */
export function indexRepositoryIntoStore(
  db: Database,
  rootPath: string,
  options: IndexOptions & InsertSnapshotOptions
): IndexIntoStoreResult {
  const result = indexRepository(rootPath, options);
  const inserted: InsertSnapshotResult = insertSnapshotGraph(db, result.graph, {
    parentSnapshotId: options.parentSnapshotId,
    pinned: options.pinned,
    expectedActivationId: options.expectedActivationId,
    signal: options.signal
  });
  return { ...result, ...inserted };
}
