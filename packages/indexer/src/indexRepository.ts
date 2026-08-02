import { readFileSync } from "node:fs";
import path from "node:path";
import type { GraphProject, RepoStateKind, SnapshotGraph } from "@tadori/core";
import {
  edgeCanonicalIdentity,
  entityKey,
  nodeCanonicalIdentity,
  sha256Hex,
  sha256HexBytes
} from "@tadori/core";
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
import { snapshotDiagnostics } from "./diagnostics.js";
import { buildSnapshotExtractorInventory } from "./extractorInventory.js";
import { attributeTypeScriptExtraction } from "./typescriptExtractor.js";
import { structuralExtractor } from "./structuralExtractor.js";
import { LANGUAGE_BY_ID } from "./languageRegistry.js";
import { interfaceExtractor } from "./interfaceExtractor.js";
import { extractCrossLanguageBoundaries } from "./crossLanguageExtractor.js";
import { provenance } from "./extractorContract.js";

function pathBelongsToRoot(file: string, root: string): boolean {
  return root === "." || file === root || file.startsWith(`${root}/`);
}

/**
 * Materializes one package-level owner per discovered project root. Existing
 * TS/JS (or structural) package nodes are reused and only gain missing
 * containment, preserving every established package identity.
 */
function materializeProjectRoots(
  extracted: ExtractedGraph,
  projects: readonly GraphProject[],
  extractor: Pick<ReturnType<typeof interfaceExtractor.extract>, "extractorId" | "extractorVersion" | "capability">
): void {
  const projectsByRoot = new Map<string, GraphProject[]>();
  for (const project of projects) {
    const group = projectsByRoot.get(project.root) ?? [];
    group.push(project);
    projectsByRoot.set(project.root, group);
  }
  const roots = [...projectsByRoot.keys()].sort(
    (left, right) => right.split("/").length - left.split("/").length || left.localeCompare(right)
  );
  const assignedRoot = (file: string): string | undefined =>
    roots.find((root) => pathBelongsToRoot(file, root));
  const snapshotFilePaths = new Set(extracted.files.map((file) => file.normalizedPath));
  const evidenceFileForProject = (root: string, project: GraphProject): string | null => {
    if (project.manifest !== null && snapshotFilePaths.has(project.manifest)) {
      return project.manifest;
    }
    return extracted.files
      .map((file) => file.normalizedPath)
      .filter((file) => assignedRoot(file) === root)
      .sort((left, right) => left.localeCompare(right))[0] ?? null;
  };
  const fileNodeByPath = new Map(
    extracted.nodes.flatMap((node) => node.kind === "file" && node.file !== null ? [[node.file, node] as const] : [])
  );
  const nodeByKey = new Map(extracted.nodes.map((node) => [node.entityKey, node]));
  const edgeByKey = new Map(extracted.edges.map((edge) => [edge.entityKey, edge]));
  const packageKeys = new Set(
    extracted.nodes.filter((node) => node.kind === "package").map((node) => node.entityKey)
  );
  const rootPackageKey = extracted.nodes.find(
    (node) => node.kind === "package" && node.qualifiedName === extracted.packageName
  )?.entityKey;
  const directFilesByPackage = new Map<string, Set<string>>();
  for (const edge of extracted.edges) {
    if (edge.relation !== "contains" || !packageKeys.has(edge.srcEntityKey)) continue;
    const target = nodeByKey.get(edge.dstEntityKey);
    if (target?.kind === "file" && target.file !== null) {
      const directFiles = directFilesByPackage.get(edge.srcEntityKey) ?? new Set<string>();
      directFiles.add(target.file);
      directFilesByPackage.set(edge.srcEntityKey, directFiles);
    }
  }

  const projectPackageKeyByRoot = new Map<string, string>();
  const projectRootByPackageKey = new Map<string, string>();
  for (const root of roots) {
    const group = (projectsByRoot.get(root) ?? []).sort((left, right) =>
      left.projectId.localeCompare(right.projectId)
    );
    const representative = group.find((project) => project.name !== null) ?? group[0];
    if (representative === undefined) continue;
    const namedOwner = representative.name === null ? undefined : extracted.nodes
      .filter((node) => node.kind === "package")
      .sort((left, right) => left.entityKey.localeCompare(right.entityKey))
      .find((node) =>
        (node.qualifiedName === representative.name || node.displayName === representative.name)
        && [...(directFilesByPackage.get(node.entityKey) ?? [])]
          .every((file) => assignedRoot(file) === root)
      )?.entityKey;
    let packageKey = namedOwner ?? (root === "." ? rootPackageKey : undefined);
    if (packageKey === undefined) {
      const qualifiedName = `project-root:${root}`;
      const canonicalIdentity = nodeCanonicalIdentity("package", qualifiedName);
      packageKey = entityKey(canonicalIdentity);
      const evidenceFile = evidenceFileForProject(root, representative);
      const projectEvidence = evidenceFile === null
        ? []
        : [{ file: evidenceFile, kind: "source" as const, lineStart: 1, lineEnd: 1 }];
      nodeByKey.set(packageKey, {
        kind: "package",
        qualifiedName,
        displayName: representative.name ?? (root === "." ? "repository" : path.posix.basename(root)),
        canonicalIdentity,
        entityKey: packageKey,
        file: null,
        exported: false,
        spanStart: null,
        spanEnd: null,
        lineStart: null,
        lineEnd: null,
        signature: null,
        bodyHash: null,
        evidence: projectEvidence,
        language: group.flatMap((project) => project.languages).filter(
          (language, index, languages) => languages.indexOf(language) === index
        ).length === 1 ? group.flatMap((project) => project.languages)[0] ?? null : null,
        provenance: provenance(
          extractor.extractorId,
          extractor.extractorVersion,
          extractor.capability,
          "repository-derived"
        )
      });
      packageKeys.add(packageKey);
      directFilesByPackage.set(packageKey, new Set());
    }
    projectPackageKeyByRoot.set(root, packageKey);
    projectRootByPackageKey.set(packageKey, root);
  }
  if (rootPackageKey !== undefined && !projectRootByPackageKey.has(rootPackageKey)) {
    projectPackageKeyByRoot.set(".", rootPackageKey);
    projectRootByPackageKey.set(rootPackageKey, ".");
  }

  const addContainment = (
    sourceKey: string,
    target: { entityKey: string; language?: string | null },
    evidenceFile: string | null
  ): void => {
    const canonicalIdentity = edgeCanonicalIdentity(sourceKey, "contains", target.entityKey);
    const edgeKey = entityKey(canonicalIdentity);
    if (edgeByKey.has(edgeKey)) return;
    edgeByKey.set(edgeKey, {
      srcEntityKey: sourceKey,
      relation: "contains",
      dstEntityKey: target.entityKey,
      canonicalIdentity,
      entityKey: edgeKey,
      origin: "heuristic",
      confidence: "certain",
      resolution: "resolved",
      evidence: evidenceFile === null
        ? []
        : [{ file: evidenceFile, kind: "source", lineStart: 1, lineEnd: 1 }],
      language: target.language ?? null,
      provenance: provenance(
        extractor.extractorId,
        extractor.extractorVersion,
        extractor.capability,
        "convention-derived"
      )
    });
  };

  for (const root of roots.filter((candidate) => candidate !== ".")) {
    const childKey = projectPackageKeyByRoot.get(root);
    const parent = [...projectPackageKeyByRoot.entries()]
      .filter(([candidateRoot]) => candidateRoot !== root && pathBelongsToRoot(root, candidateRoot))
      .sort(([left], [right]) =>
        right.split("/").length - left.split("/").length || left.localeCompare(right)
      )[0];
    if (childKey === undefined || parent === undefined || childKey === parent[1]) continue;
    const child = nodeByKey.get(childKey);
    const representative = (projectsByRoot.get(root) ?? [])
      .sort((left, right) => left.projectId.localeCompare(right.projectId))[0];
    if (child !== undefined && representative !== undefined) {
      addContainment(parent[1], child, evidenceFileForProject(root, representative));
    }
  }

  for (const root of roots) {
    const packageKey = projectPackageKeyByRoot.get(root);
    const representative = (projectsByRoot.get(root) ?? [])
      .sort((left, right) => left.projectId.localeCompare(right.projectId))[0];
    if (packageKey === undefined || representative === undefined) continue;
    const projectEvidenceFile = evidenceFileForProject(root, representative);
    const memberFiles = extracted.files
      .map((file) => file.normalizedPath)
      .filter((file) => assignedRoot(file) === root)
      .sort();
    for (const file of memberFiles) {
      const target = fileNodeByPath.get(file);
      if (target === undefined) continue;
      for (const [edgeKey, edge] of edgeByKey) {
        const sourceProjectRoot = projectRootByPackageKey.get(edge.srcEntityKey);
        if (
          edge.relation === "contains" &&
          edge.dstEntityKey === target.entityKey &&
          sourceProjectRoot !== undefined &&
          sourceProjectRoot !== root &&
          pathBelongsToRoot(root, sourceProjectRoot)
        ) {
          edgeByKey.delete(edgeKey);
          directFilesByPackage.get(edge.srcEntityKey)?.delete(file);
        }
      }
      const directOwners = [...edgeByKey.values()]
        .filter((edge) => edge.relation === "contains" && edge.dstEntityKey === target.entityKey)
        .map((edge) => edge.srcEntityKey)
        .filter((key) => packageKeys.has(key));
      const structuralOwners = directOwners
        .filter((key) => key !== packageKey && !projectRootByPackageKey.has(key))
        .sort();
      if (structuralOwners.length > 0) {
        for (const structuralOwner of structuralOwners) {
          const ownerNode = nodeByKey.get(structuralOwner);
          if (ownerNode !== undefined) {
            addContainment(packageKey, ownerNode, projectEvidenceFile ?? file);
          }
        }
      } else if (!directOwners.includes(packageKey)) {
        addContainment(packageKey, target, projectEvidenceFile ?? file);
        directFilesByPackage.get(packageKey)?.add(file);
      }
    }
  }
  for (const file of extracted.files.map((item) => item.normalizedPath).sort()) {
    const root = assignedRoot(file);
    const target = fileNodeByPath.get(file);
    if (root === undefined || root === "." || target === undefined) continue;
    for (const [edgeKey, edge] of edgeByKey) {
      const sourceRoot = projectRootByPackageKey.get(edge.srcEntityKey);
      if (
        edge.relation === "contains" &&
        edge.dstEntityKey === target.entityKey &&
        sourceRoot !== undefined &&
        sourceRoot !== root &&
        pathBelongsToRoot(root, sourceRoot)
      ) {
        edgeByKey.delete(edgeKey);
      }
    }
  }
  extracted.nodes = [...nodeByKey.values()].sort((left, right) =>
    left.canonicalIdentity.localeCompare(right.canonicalIdentity)
  );
  extracted.edges = [...edgeByKey.values()].sort((left, right) =>
    left.canonicalIdentity.localeCompare(right.canonicalIdentity)
  );
}

export interface IndexOptions {
  kind: RepoStateKind;
  label?: string | null;
  baseCommitSha?: string | null;
  /**
   * Optional trusted caller assertion over the exact capture consumed by this
   * index run. The assertion runs synchronously before extraction and must not
   * mutate the capture; throwing aborts the index without publishing a graph.
   */
  assertCapture?: (capture: RepositoryCapture) => void;
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
  scan: ScanResult,
  fileRegion?: readonly string[]
): IndexDiagnostic[] {
  const diagnostics: IndexDiagnostic[] = [];
  const selectedFiles = fileRegion === undefined ? null : new Set(fileRegion);
  for (const file of scan.indexedFiles) {
    if (selectedFiles !== null && !selectedFiles.has(file.normalizedPath)) {
      continue;
    }
    if (file.language !== "typescript" && file.language !== "javascript") {
      continue;
    }
    if (services.program.getSourceFile(file.absolutePath) === undefined) {
      continue;
    }
    for (const diagnostic of services.languageService.getSyntacticDiagnostics(file.absolutePath)) {
      diagnostics.push({
        file: file.normalizedPath,
        message: `TypeScript syntax ${String(diagnostic.code)}: ${String(diagnostic.messageText)}`,
        code: "typescript-syntax",
        severity: "error",
        language: file.language,
        extractorId: "tadori-typescript"
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
  const structural = options.fileRegion === undefined
    ? structuralExtractor.extract({
        root,
        capture: captured,
        registrations: LANGUAGE_BY_ID
      })
    : null;
  const repositoryFiles = options.fileRegion === undefined
    ? interfaceExtractor.extract({
        root,
        capture: captured,
        registrations: LANGUAGE_BY_ID
      })
    : null;
  const extracted: ExtractedGraph & { extractors?: SnapshotGraph["extractors"] } =
    attributeTypeScriptExtraction(
      extractGraph(root, scan, services, {
        ...options,
        fileContents: captured.fileContents,
        documentationCandidates: [
          ...(options.documentationCandidates ?? []),
          ...(structural?.nodes ?? []),
          ...(repositoryFiles?.nodes ?? [])
        ]
      }),
      scan
    );
  extracted.diagnostics.unshift(
    ...scan.diagnostics.map((diagnostic): IndexDiagnostic => ({
      code: diagnostic.code,
      message: diagnostic.message,
      language: diagnostic.language,
      severity: "warning",
      file: null,
      extractorId: "tadori-repository",
      extractorVersion: "1"
    })),
    ...collectSyntacticDiagnostics(services, scan, options.fileRegion)
  );
  if (options.fileRegion === undefined) {
    if (structural === null || repositoryFiles === null) {
      throw new Error("Full extraction did not initialize every repository adapter");
    }
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
    extracted.projects = repositoryFiles.projects;
    if (
      repositoryFiles.projects.length > 0 ||
      scan.indexedFiles.some((file) => repositoryFiles.languages.includes(file.language))
    ) {
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
            [
              ...repositoryFiles.projects.flatMap((project) => project.languages),
              ...scan.indexedFiles
                .map((file) => file.language)
                .filter((language) => repositoryFiles.languages.includes(language))
            ]
          )].sort()
        }
      ].sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version));
    }
    // Reassign package containment after every repository/interface edge has
    // been merged so a broader semantic root cannot be reintroduced as a
    // second direct owner of a nested project file.
    materializeProjectRoots(extracted, repositoryFiles.projects, repositoryFiles);
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
  /** Files plus deterministic omission evidence used for refresh identity. */
  manifestHashes: ReadonlyMap<string, string>;
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
  const omissionEvidence = new Map<string, string[]>();
  for (const diagnostic of scan.diagnostics) {
    const entries = omissionEvidence.get(diagnostic.normalizedPath) ?? [];
    entries.push(JSON.stringify([
      diagnostic.code,
      diagnostic.language,
      diagnostic.message
    ]));
    omissionEvidence.set(diagnostic.normalizedPath, entries);
  }
  const manifestHashes = new Map(fileHashes);
  for (const [normalizedPath, entries] of omissionEvidence) {
    if (manifestHashes.has(normalizedPath)) {
      throw new Error(
        `Repository capture path ${JSON.stringify(normalizedPath)} is both captured and omitted`
      );
    }
    manifestHashes.set(normalizedPath, sha256Hex(entries.sort().join("\n")));
  }
  return {
    scan,
    fileHashes,
    manifestHashes,
    fileContents,
    workspaceHash: computeWorkspaceHash(
      [...manifestHashes].map(([normalizedPath, contentHash]) => ({
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
  options.assertCapture?.(captured);
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

  const edges = [...extracted.edges, ...coChangeEdges];
  const diagnostics = snapshotDiagnostics(extracted.diagnostics, extracted.files, extracted.extractors);
  const extractors = buildSnapshotExtractorInventory({
    inventories: [extracted.extractors],
    nodes: extracted.nodes,
    edges,
    files: extracted.files,
    projects: extracted.projects,
    diagnostics
  });
  const graph: SnapshotGraph = {
    repoRootPath: root.split(path.sep).join("/"),
    kind: options.kind,
    label: options.label ?? null,
    baseCommitSha: options.baseCommitSha ?? null,
    workspaceHash: captured.workspaceHash,
    analyzerVersion: ANALYZER_VERSION,
    files: extracted.files,
    nodes: extracted.nodes,
    edges,
    projects: extracted.projects,
    extractors,
    diagnostics
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
