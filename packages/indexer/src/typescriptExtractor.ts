import type {
  ExtractionCapability,
  ExtractionDerivation,
  GraphEdge,
  GraphNode,
  SnapshotExtractor
} from "@tadori/core";
import type { ExtractedGraph } from "./extract.js";
import type { ScanResult } from "./scan.js";
import { provenance } from "./extractorContract.js";
import { LANGUAGE_BY_ID } from "./languageRegistry.js";
import {
  MARKDOWN_NON_INTEGRATION_NODE_PREFIX,
  MARKDOWN_NON_INTEGRATION_REASON
} from "./semantics.js";

export const TYPESCRIPT_EXTRACTOR_ID = "tadori-typescript";
export const TYPESCRIPT_EXTRACTOR_VERSION = "1";
const REPOSITORY_EXTRACTOR_ID = "tadori-repository";
const REPOSITORY_EXTRACTOR_VERSION = "1";
function requireMarkdownRegistration(): NonNullable<ReturnType<typeof LANGUAGE_BY_ID.get>> {
  const registration = LANGUAGE_BY_ID.get("markdown");
  if (registration === undefined) {
    throw new Error("The canonical language registry is missing Markdown");
  }
  return registration;
}
const MARKDOWN_REGISTRATION = requireMarkdownRegistration();

function strongerCapability(
  left: ExtractionCapability | undefined,
  right: ExtractionCapability
): ExtractionCapability {
  const rank: Record<ExtractionCapability, number> = {
    repository: 0,
    structural: 1,
    semantic: 2
  };
  return left === undefined || rank[right] > rank[left] ? right : left;
}

function nodeLanguage(node: GraphNode, languageByFile: ReadonlyMap<string, string>): string | null {
  if (node.file !== null) return languageByFile.get(node.file) ?? null;
  if (node.qualifiedName.startsWith("npm:")) return "javascript";
  return null;
}

function nodeAttribution(node: GraphNode, language: string | null): {
  extractorId: string;
  extractorVersion: string;
  capability: ExtractionCapability;
  derivation: ExtractionDerivation;
} {
  if (node.kind === "package" || node.kind === "file" || node.kind === "external_dep") {
    return {
      extractorId: REPOSITORY_EXTRACTOR_ID,
      extractorVersion: REPOSITORY_EXTRACTOR_VERSION,
      capability: "repository",
      derivation: "repository-derived"
    };
  }
  if (language === "markdown") {
    return {
      extractorId: MARKDOWN_REGISTRATION.extractorId,
      extractorVersion: MARKDOWN_REGISTRATION.extractorVersion,
      capability: MARKDOWN_REGISTRATION.capability,
      derivation: node.kind === "adr" || node.kind === "doc_section" || node.kind === "unresolved"
        ? "convention-derived"
        : "repository-derived"
    };
  }
  if (node.kind === "route" || node.kind === "test") {
    return {
      extractorId: TYPESCRIPT_EXTRACTOR_ID,
      extractorVersion: TYPESCRIPT_EXTRACTOR_VERSION,
      capability: "semantic",
      derivation: "convention-derived"
    };
  }
  return {
    extractorId: TYPESCRIPT_EXTRACTOR_ID,
    extractorVersion: TYPESCRIPT_EXTRACTOR_VERSION,
    capability: "semantic",
    derivation: node.kind === "unresolved" ? "inferred" : "compiler-resolved"
  };
}

function edgeDerivation(edge: GraphEdge): ExtractionDerivation {
  if (edge.origin === "compiler") return "compiler-resolved";
  if (edge.origin === "doc") return "convention-derived";
  if (edge.origin === "git") return "repository-derived";
  if (edge.relation === "routes_to" || edge.relation === "tests") return "convention-derived";
  return "inferred";
}

/**
 * Additive adapter boundary around the legacy TS implementation. It changes no
 * canonical identity, body hash, edge metadata, evidence, or ordering.
 */
export function attributeTypeScriptExtraction(
  extracted: ExtractedGraph,
  scan: ScanResult
): ExtractedGraph & { extractors: SnapshotExtractor[] } {
  const languageByFile = new Map(
    scan.indexedFiles.map((file) => [file.normalizedPath, file.language] as const)
  );
  const languageByNodeKey = new Map<string, string | null>();
  const unresolvedReasonByNodeKey = new Map<string, string>();
  const nodes = extracted.nodes.map((node): GraphNode => {
    const language = nodeLanguage(node, languageByFile);
    languageByNodeKey.set(node.entityKey, language);
    const attribution = nodeAttribution(node, language);
    const unresolvedReason = node.kind === "unresolved"
      ? node.qualifiedName.includes(`::${MARKDOWN_NON_INTEGRATION_NODE_PREFIX}`)
        ? MARKDOWN_NON_INTEGRATION_REASON
        : node.displayName.includes("[")
          ? "dynamic-property-call"
          : "TypeScript could not prove a unique target"
      : null;
    if (unresolvedReason !== null) unresolvedReasonByNodeKey.set(node.entityKey, unresolvedReason);
    return {
      ...node,
      language,
      provenance: provenance(
        attribution.extractorId,
        attribution.extractorVersion,
        attribution.capability,
        attribution.derivation,
        unresolvedReason
      )
    };
  });
  const nodeByKey = new Map(nodes.map((node) => [node.entityKey, node]));
  const edges = extracted.edges.map((edge): GraphEdge => {
    const source = nodeByKey.get(edge.srcEntityKey);
    const target = nodeByKey.get(edge.dstEntityKey);
    // The legacy extractor creates the repository package and its file
    // membership before semantic analysis. Its frozen edge origin remains
    // byte-compatible, but the additive attribution must describe the actual
    // repository-level producer instead of converting that origin into a
    // TypeScript compiler claim. Package nodes are language-neutral, so the
    // containment edge inherits the contained file's language.
    const isRepositoryFileContainment =
      edge.relation === "contains" && source?.kind === "package" && target?.kind === "file";
    const language = isRepositoryFileContainment
      ? target.language ?? null
      : languageByNodeKey.get(edge.srcEntityKey) ?? null;
    const isMarkdownConvention = !isRepositoryFileContainment && language === "markdown";
    const derivation = isRepositoryFileContainment
      ? "repository-derived"
      : isMarkdownConvention
        ? "convention-derived"
        : edgeDerivation(edge);
    const extractorId = isRepositoryFileContainment || derivation === "repository-derived"
      ? REPOSITORY_EXTRACTOR_ID
      : isMarkdownConvention
        ? MARKDOWN_REGISTRATION.extractorId
        : TYPESCRIPT_EXTRACTOR_ID;
    const extractorVersion = extractorId === REPOSITORY_EXTRACTOR_ID
      ? REPOSITORY_EXTRACTOR_VERSION
      : isMarkdownConvention
        ? MARKDOWN_REGISTRATION.extractorVersion
        : TYPESCRIPT_EXTRACTOR_VERSION;
    const capability = isMarkdownConvention
      ? MARKDOWN_REGISTRATION.capability
      : derivation === "compiler-resolved"
        ? "semantic"
        : derivation === "repository-derived"
          ? "repository"
          : "structural";
    return {
      ...edge,
      language,
      provenance: provenance(
        extractorId,
        extractorVersion,
        capability,
        derivation,
        edge.resolution === "unresolved"
          ? unresolvedReasonByNodeKey.get(edge.dstEntityKey) ?? "TypeScript could not prove a unique target"
          : null
      )
    };
  });
  const inventory = new Map<string, SnapshotExtractor>();
  // Inventory covers every attributed item. Some repository languages (for
  // example Markdown) have nodes owned by a specialized adapter while their
  // package membership is correctly owned by the repository layer.
  for (const item of [...nodes, ...edges]) {
    if (!item.provenance) continue;
    const key = `${item.provenance.extractorId}\0${item.provenance.extractorVersion}`;
    const existing = inventory.get(key);
    const languages = new Set(existing?.languages ?? []);
    if (item.language) languages.add(item.language);
    inventory.set(key, {
      id: item.provenance.extractorId,
      version: item.provenance.extractorVersion,
      capability: strongerCapability(existing?.capability, item.provenance.capability),
      languages: [...languages].sort()
    });
  }
  return {
    ...extracted,
    nodes,
    edges,
    extractors: [...inventory.values()]
      .filter((extractor) => extractor.languages.length > 0)
      .sort((left, right) => left.id.localeCompare(right.id) || left.version.localeCompare(right.version))
  };
}
