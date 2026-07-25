import { readFileSync } from "node:fs";
import path from "node:path";
import type { RepoStateKind, SnapshotGraph } from "@tadori/core";
import { sha256Hex, sha256HexBytes } from "@tadori/core";
import type { Database, InsertSnapshotOptions, InsertSnapshotResult } from "@tadori/store";
import { insertSnapshotGraph } from "@tadori/store";
import { computeCoChangeEdges } from "./coChange.js";
import {
  extractGraph,
  type ExtractedGraph,
  type ExtractGraphOptions,
  type IndexDiagnostic
} from "./extract.js";
import { createProjectServices } from "./project.js";
import { scanRepository, type ScanResult } from "./scan.js";
import { ANALYZER_VERSION } from "./version.js";
import { attributeTypeScriptExtraction } from "./typescriptExtractor.js";
import { structuralExtractor } from "./structuralExtractor.js";
import { LANGUAGE_BY_ID } from "./languageRegistry.js";
import { interfaceExtractor } from "./interfaceExtractor.js";
import { extractCrossLanguageBoundaries } from "./crossLanguageExtractor.js";

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

function collectSyntacticDiagnostics(
  services: ReturnType<typeof createProjectServices>,
  scan: ScanResult
): IndexDiagnostic[] {
  const diagnostics: IndexDiagnostic[] = [];
  for (const file of scan.indexedFiles) {
    if (file.language !== "typescript" && file.language !== "javascript") {
      continue;
    }
    if (services.program.getSourceFile(file.absolutePath) === undefined) {
      continue;
    }
    for (const diagnostic of services.languageService.getSyntacticDiagnostics(file.absolutePath)) {
      diagnostics.push({
        file: file.normalizedPath,
        message: `TypeScript syntax ${String(diagnostic.code)}: ${String(diagnostic.messageText)}`
      });
    }
  }
  return diagnostics.sort((left, right) =>
    `${left.file ?? ""}\0${left.message}`.localeCompare(`${right.file ?? ""}\0${right.message}`)
  );
}

/** Shared full/regional adapter pipeline used by initial and incremental indexing. */
export function extractRepositoryGraph(
  root: string,
  captured: RepositoryCapture,
  services: ReturnType<typeof createProjectServices>,
  options: ExtractGraphOptions = {}
): ExtractedGraph & { extractors?: SnapshotGraph["extractors"] } {
  const { scan } = captured;
  const extracted: ExtractedGraph & { extractors?: SnapshotGraph["extractors"] } =
    attributeTypeScriptExtraction(
      extractGraph(root, scan, services, { ...options, fileContents: captured.fileContents }),
      scan
    );
  if (options.fileRegion === undefined) {
    extracted.diagnostics.unshift(...collectSyntacticDiagnostics(services, scan));
    const structural = structuralExtractor.extract({
      root,
      capture: captured,
      registrations: LANGUAGE_BY_ID
    });
    if (scan.indexedFiles.some((file) => structural.languages.includes(file.language))) {
      const nodeByKey = new Map(extracted.nodes.map((node) => [node.entityKey, node]));
      for (const node of structural.nodes) {
        if (!nodeByKey.has(node.entityKey)) nodeByKey.set(node.entityKey, node);
      }
      const edgeByKey = new Map(extracted.edges.map((edge) => [edge.entityKey, edge]));
      for (const edge of structural.edges) {
        if (!edgeByKey.has(edge.entityKey)) edgeByKey.set(edge.entityKey, edge);
      }
      extracted.nodes = [...nodeByKey.values()].sort((left, right) =>
        left.canonicalIdentity.localeCompare(right.canonicalIdentity)
      );
      extracted.edges = [...edgeByKey.values()].sort((left, right) =>
        left.canonicalIdentity.localeCompare(right.canonicalIdentity)
      );
      extracted.diagnostics.push(...structural.diagnostics);
      extracted.extractors = [
        ...(extracted.extractors ?? []),
        {
          id: structural.extractorId,
          version: structural.extractorVersion,
          capability: structural.capability,
          languages: [...new Set(
            scan.indexedFiles
              .map((file) => file.language)
              .filter((language) => structural.languages.includes(language))
          )].sort()
        }
      ].sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
    }
    const repositoryFiles = interfaceExtractor.extract({
      root,
      capture: captured,
      registrations: LANGUAGE_BY_ID
    });
    if (scan.indexedFiles.some((file) => repositoryFiles.languages.includes(file.language))) {
      // The legacy TS adapter already owns ADR files in TS projects. Avoid a
      // second Markdown projection for those same documents so adapter parity
      // remains exact while ordinary Markdown in mixed repositories still
      // receives repository-level sections.
      const semanticDocumentFiles = new Set(
        extracted.nodes.flatMap((node) => node.kind === "adr" && node.file !== null ? [node.file] : [])
      );
      const suppressedNodeKeys = new Set(
        repositoryFiles.nodes.flatMap((node) =>
          node.language === "markdown" && node.file !== null && semanticDocumentFiles.has(node.file)
            ? [node.entityKey]
            : []
        )
      );
      const nodeByKey = new Map(extracted.nodes.map((node) => [node.entityKey, node]));
      for (const node of repositoryFiles.nodes) {
        if (suppressedNodeKeys.has(node.entityKey)) continue;
        if (!nodeByKey.has(node.entityKey)) nodeByKey.set(node.entityKey, node);
      }
      const edgeByKey = new Map(extracted.edges.map((edge) => [edge.entityKey, edge]));
      for (const edge of repositoryFiles.edges) {
        if (suppressedNodeKeys.has(edge.srcEntityKey) || suppressedNodeKeys.has(edge.dstEntityKey)) continue;
        if (!edgeByKey.has(edge.entityKey)) edgeByKey.set(edge.entityKey, edge);
      }
      extracted.nodes = [...nodeByKey.values()].sort((left, right) =>
        left.canonicalIdentity.localeCompare(right.canonicalIdentity)
      );
      extracted.edges = [...edgeByKey.values()].sort((left, right) =>
        left.canonicalIdentity.localeCompare(right.canonicalIdentity)
      );
      extracted.diagnostics.push(...repositoryFiles.diagnostics);
      extracted.extractors = [
        ...(extracted.extractors ?? []),
        {
          id: repositoryFiles.extractorId,
          version: repositoryFiles.extractorVersion,
          capability: repositoryFiles.capability,
          languages: [...new Set(
            scan.indexedFiles
              .map((file) => file.language)
              .filter((language) => repositoryFiles.languages.includes(language))
          )].sort()
        }
      ].sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
    }
    const boundaries = extractCrossLanguageBoundaries({ root, capture: captured, registrations: LANGUAGE_BY_ID }, extracted.nodes);
    if (boundaries.edges.length > 0) {
      const edgeByKey = new Map(extracted.edges.map((edge) => [edge.entityKey, edge]));
      for (const edge of boundaries.edges) if (!edgeByKey.has(edge.entityKey)) edgeByKey.set(edge.entityKey, edge);
      extracted.edges = [...edgeByKey.values()].sort((left, right) =>
        left.canonicalIdentity.localeCompare(right.canonicalIdentity)
      );
      extracted.diagnostics.push(...boundaries.diagnostics);
      extracted.extractors = [
        ...(extracted.extractors ?? []),
        {
          id: boundaries.extractorId,
          version: boundaries.extractorVersion,
          capability: boundaries.capability,
          languages: boundaries.languages
        }
      ].sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
    }
  }
  return extracted;
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
  let extracted: ExtractedGraph & { extractors?: SnapshotGraph["extractors"] };
  try {
    extracted = extractRepositoryGraph(root, captured, services);
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
    edges: [...extracted.edges, ...coChangeEdges],
    extractors: extracted.extractors
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
