import type {
  DiagnosticSeverity,
  ExtractionCapability,
  ExtractionDerivation,
  ExtractionProvenance,
  GraphEdge,
  GraphNode,
  GraphProject
} from "@tadori/core";
import { graphProjectSchema } from "@tadori/core";
import type { RepositoryCapture } from "./indexRepository.js";
import type { LanguageId, LanguageRegistration } from "./languageRegistry.js";

export interface ExtractionDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  file: string | null;
  language: LanguageId | null;
  extractorId: string;
  lineStart?: number;
  lineEnd?: number;
}

export type DiscoveredProject = GraphProject & { languages: LanguageId[] };

export type AttributedGraphNode = GraphNode & {
  language: LanguageId | null;
  provenance: ExtractionProvenance;
};

export type AttributedGraphEdge = GraphEdge & {
  language: LanguageId | null;
  provenance: ExtractionProvenance;
};

export interface ExtractorResult {
  extractorId: string;
  extractorVersion: string;
  capability: ExtractionCapability;
  languages: LanguageId[];
  nodes: AttributedGraphNode[];
  edges: AttributedGraphEdge[];
  projects: DiscoveredProject[];
  diagnostics: ExtractionDiagnostic[];
}

export interface ExtractionContext {
  root: string;
  capture: RepositoryCapture;
  registrations: ReadonlyMap<LanguageId, LanguageRegistration>;
}

export interface RepositoryExtractor {
  readonly id: string;
  readonly version: string;
  readonly capability: ExtractionCapability;
  readonly languages: readonly LanguageId[];
  extract(context: ExtractionContext): ExtractorResult;
}

export function provenance(
  extractorId: string,
  extractorVersion: string,
  capability: ExtractionCapability,
  derivation: ExtractionDerivation,
  unresolvedReason: string | null = null
): ExtractionProvenance {
  return { extractorId, extractorVersion, capability, derivation, unresolvedReason };
}

export function assertExtractorResult(result: ExtractorResult): void {
  const projectIds = new Set<string>();
  for (const project of result.projects) {
    graphProjectSchema.parse(project);
    if (projectIds.has(project.projectId)) {
      throw new Error(`Extractor ${result.extractorId} emitted duplicate project ${project.projectId}`);
    }
    projectIds.add(project.projectId);
  }
  const nodeKeys = new Set<string>();
  for (const node of result.nodes) {
    if (nodeKeys.has(node.entityKey)) {
      throw new Error(`Extractor ${result.extractorId} emitted duplicate node ${node.entityKey}`);
    }
    nodeKeys.add(node.entityKey);
    if (node.provenance.extractorId !== result.extractorId) {
      throw new Error(`Node ${node.entityKey} has mismatched extractor provenance`);
    }
    if (node.provenance.extractorVersion !== result.extractorVersion) {
      throw new Error(`Node ${node.entityKey} has mismatched extractor version`);
    }
    if (node.provenance.capability !== result.capability) {
      throw new Error(`Node ${node.entityKey} has mismatched extractor capability`);
    }
    if (node.language !== null && !result.languages.includes(node.language)) {
      throw new Error(`Node ${node.entityKey} has unregistered extractor language ${node.language}`);
    }
    if (node.kind === "unresolved" && node.provenance.unresolvedReason === null) {
      throw new Error(`Unresolved node ${node.entityKey} has no unresolved reason`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const edge of result.edges) {
    if (edgeKeys.has(edge.entityKey)) {
      throw new Error(`Extractor ${result.extractorId} emitted duplicate edge ${edge.entityKey}`);
    }
    edgeKeys.add(edge.entityKey);
    if (edge.provenance.extractorId !== result.extractorId) {
      throw new Error(`Edge ${edge.entityKey} has mismatched extractor provenance`);
    }
    if (edge.provenance.extractorVersion !== result.extractorVersion) {
      throw new Error(`Edge ${edge.entityKey} has mismatched extractor version`);
    }
    if (edge.provenance.capability !== result.capability) {
      throw new Error(`Edge ${edge.entityKey} has mismatched extractor capability`);
    }
    if (edge.language !== null && !result.languages.includes(edge.language)) {
      throw new Error(`Edge ${edge.entityKey} has unregistered extractor language ${edge.language}`);
    }
    if (edge.resolution === "unresolved" && edge.provenance.unresolvedReason === null) {
      throw new Error(`Unresolved edge ${edge.entityKey} has no unresolved reason`);
    }
  }
  for (const diagnostic of result.diagnostics) {
    if (!/^[a-z][a-z0-9-]*$/.test(diagnostic.code)) {
      throw new Error(`Extractor ${result.extractorId} emitted an invalid diagnostic code`);
    }
    if (diagnostic.message.length === 0) {
      throw new Error(`Extractor ${result.extractorId} emitted an empty diagnostic message`);
    }
    if (diagnostic.extractorId !== result.extractorId) {
      throw new Error(`Diagnostic ${diagnostic.code} has mismatched extractor provenance`);
    }
    if (diagnostic.language !== null && !result.languages.includes(diagnostic.language)) {
      throw new Error(`Diagnostic ${diagnostic.code} has unregistered extractor language`);
    }
    if ((diagnostic.lineStart === undefined) !== (diagnostic.lineEnd === undefined)) {
      throw new Error(`Diagnostic ${diagnostic.code} has an incomplete line range`);
    }
    if (
      diagnostic.lineStart !== undefined &&
      diagnostic.lineEnd !== undefined &&
      (diagnostic.lineStart < 1 || diagnostic.lineEnd < diagnostic.lineStart)
    ) {
      throw new Error(`Diagnostic ${diagnostic.code} has an invalid line range`);
    }
  }
}
