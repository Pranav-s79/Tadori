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

export const TYPESCRIPT_EXTRACTOR_ID = "tadori-typescript";
export const TYPESCRIPT_EXTRACTOR_VERSION = "1";

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
  if (language === "markdown") {
    return {
      extractorId: "tadori-markdown",
      extractorVersion: "1",
      capability: "repository",
      derivation: node.kind === "adr" || node.kind === "doc_section" ? "convention-derived" : "repository-derived"
    };
  }
  if (node.kind === "package" || node.kind === "file" || node.kind === "external_dep") {
    return {
      extractorId: "tadori-repository",
      extractorVersion: "1",
      capability: "repository",
      derivation: "repository-derived"
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
      ? node.displayName.includes("[")
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
  const edges = extracted.edges.map((edge): GraphEdge => {
    const language = languageByNodeKey.get(edge.srcEntityKey) ?? null;
    const derivation = edgeDerivation(edge);
    return {
      ...edge,
      language,
      provenance: provenance(
        derivation === "repository-derived" ? "tadori-repository" : TYPESCRIPT_EXTRACTOR_ID,
        "1",
        derivation === "compiler-resolved" ? "semantic" : derivation === "repository-derived" ? "repository" : "structural",
        derivation,
        edge.resolution === "unresolved"
          ? unresolvedReasonByNodeKey.get(edge.dstEntityKey) ?? "TypeScript could not prove a unique target"
          : null
      )
    };
  });
  const inventory = new Map<string, SnapshotExtractor>();
  for (const node of nodes) {
    if (!node.provenance) continue;
    const key = `${node.provenance.extractorId}\0${node.provenance.extractorVersion}`;
    const existing = inventory.get(key);
    const languages = new Set(existing?.languages ?? []);
    if (node.language) languages.add(node.language);
    inventory.set(key, {
      id: node.provenance.extractorId,
      version: node.provenance.extractorVersion,
      capability: node.provenance.capability,
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
