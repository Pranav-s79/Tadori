export type NodeKind =
  | "package"
  | "file"
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "route"
  | "test"
  | "adr"
  | "doc_section"
  | "external_dep"
  | "unresolved";

export type Origin = "compiler" | "heuristic" | "git" | "doc" | "human" | "llm";

export type Confidence = "certain" | "likely" | "inferred";

export type Resolution = "resolved" | "partial" | "unresolved";
export type ExtractionCapability = "semantic" | "structural" | "repository";
export type ExtractionDerivation =
  | "compiler-resolved"
  | "parser-derived"
  | "convention-derived"
  | "repository-derived"
  | "inferred";

export interface ExtractionProvenance {
  extractorId: string;
  extractorVersion: string;
  capability: ExtractionCapability;
  derivation: ExtractionDerivation;
  unresolvedReason: string | null;
}

export interface ApiNode {
  entityKey: string;
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  file: string | null;
  exported: boolean;
  fanIn: number;
  language?: string | null;
  provenance?: ExtractionProvenance | null;
  aggregateLanguages?: string[];
  aggregateCapabilities?: ExtractionCapability[];
  aggregateDerivations?: ExtractionDerivation[];
}

export interface ApiEdge {
  entityKey: string;
  srcEntityKey: string;
  relation: string;
  dstEntityKey: string;
  origin?: Origin;
  confidence?: Confidence;
  resolution?: Resolution;
  language?: string | null;
  provenance?: ExtractionProvenance | null;
  aggregateCount?: number;
  aggregateProvenance?: AggregatedProvenance[];
  projectionKind?: "package_aggregate";
  aggregateLanguages?: string[];
  aggregateCapabilities?: ExtractionCapability[];
  aggregateDerivations?: ExtractionDerivation[];
  sourceEdgeCount?: number;
  sourceEdgeOmittedCount?: number;
  evidenceOmittedCount?: number;
}

export interface ApiContext {
  repository: string;
  snapshotId: number;
  snapshotKind: "commit" | "working_tree" | "staged" | "patch";
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
  staleReason: string | null;
  refreshPending: boolean;
}

export interface LayoutPositionDto {
  entityKey: string;
  x: number;
  y: number;
  z: number;
  pinned: boolean;
}

export interface RefreshStatus {
  phase: "idle" | "dirty" | "refreshing" | "failed" | "stopped";
  generation: number;
  dirtyPaths: string[];
  snapshotId: number | null;
  lastError: string | null;
}

/**
 * One summary edge per `(srcPackage, dstPackage, relation)` triple, produced
 * by collapsing every individual cross-package edge of that relation into a
 * single rendered edge. `provenance` breaks the aggregated count down by
 * `(origin, confidence, resolution)` so the legend/inspection can still show
 * what the summary is made of. Two different relations across the same package
 * pair are two distinct AggregatedEdges — they never merge.
 */
export interface AggregatedEdge {
  srcPackage: string;
  dstPackage: string;
  relation: string;
  count: number;
  provenance: AggregatedProvenance[];
}

/**
 * One provenance bucket inside an aggregated edge. The fields mirror `ApiEdge`,
 * where they are optional: an edge the server did not attribute must stay
 * visibly unattributed here rather than being bucketed as though it carried a
 * provenance the snapshot never supplied.
 */
export interface AggregatedProvenance {
  origin: Origin | null;
  confidence: Confidence | null;
  resolution: Resolution | null;
  count: number;
}

/** An aggregated bucket the snapshot actually attributed on all three axes. */
export interface AttributedProvenance extends AggregatedProvenance {
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
}

/**
 * Keep only buckets carrying a complete provenance. Callers that style or
 * filter by provenance must not treat a partially attributed bucket as though
 * it were attributed; an empty result is the honest "not attributed" state.
 */
export function attributedProvenance(
  buckets: readonly AggregatedProvenance[]
): AttributedProvenance[] {
  return buckets.filter((bucket): bucket is AttributedProvenance =>
    bucket.origin !== null && bucket.confidence !== null && bucket.resolution !== null);
}

export type RegionRoleStatus = "documented" | "configured" | "derived_from_graph";

export interface RegionEvidence {
  file: string;
  kind: "source" | "documentation" | "git" | "human_annotation" | "tool_event";
  lineStart: number;
  lineEnd: number;
  columnStart?: number;
  columnEnd?: number;
  commitSha?: string;
  excerptHash?: string;
}

export interface RegionDto {
  regionKey: string;
  label: string;
  /** Compatibility root for the first package-containment projection. */
  packageEntityKey?: string;
  /** Additive multi-package/project membership when supplied by newer servers. */
  memberPackageKeys: string[];
  role: {
    text: string | null;
    status: RegionRoleStatus;
    evidence: RegionEvidence[];
    evidenceOmittedCount: number;
  };
  basis: {
    kind: "package_containment";
    packageEntityKey: string;
    sourceEdgeCount: number;
    evidence: RegionEvidence[];
    evidenceOmittedCount: number;
  } | {
    kind: "project_root";
    projectId: string;
    root: string;
    manifest: string | null;
    evidence: RegionEvidence[];
    evidenceOmittedCount: number;
  };
  counts: {
    entities: number;
    byKind: Record<NodeKind, number>;
    incomingCrossRegionRelations: number;
    outgoingCrossRegionRelations: number;
  };
  languages: string[];
  capabilities: ExtractionCapability[];
  derivations: ExtractionDerivation[];
}

export interface RegionProjectionDto {
  regions: RegionDto[];
  accounting: {
    packageCount: number;
    projectCount: number;
    regionCount: number;
    assignedEntityCount: number;
    ambiguousEntityCount: number;
    unownedEntityCount: number;
  };
}

/**
 * One extraction diagnostic persisted as immutable snapshot membership.
 * Mirrors `snapshotDiagnosticSchema`; `lineStart`/`lineEnd` are both null or
 * both present, and `file` is null when the diagnostic is repository-scoped.
 */
export interface SnapshotDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  file: string | null;
  language: string | null;
  extractorId: string;
  extractorVersion: string;
  lineStart: number | null;
  lineEnd: number | null;
}

/** Observed extraction capability for one language in the active snapshot. */
export interface SnapshotLanguageAnalysisDto {
  id: string;
  fileCount: number;
  generatedFileCount: number;
  capabilities: ExtractionCapability[];
  extractors: Array<{ id: string; version: string; capability: ExtractionCapability }>;
}

/**
 * Bounded analysis facts for the active snapshot. `languages` is what the
 * snapshot actually observed — never what the product declares it supports.
 */
export interface SnapshotAnalysisDto {
  snapshotId: number;
  analyzerVersion: string;
  languages: SnapshotLanguageAnalysisDto[];
  extractors: Array<{
    id: string;
    version: string;
    capability: ExtractionCapability;
    languages: string[];
  }>;
  diagnostics: {
    items: SnapshotDiagnostic[];
    total: number;
    omittedCount: number;
    nextCursor: string | null;
    bySeverity: Record<"info" | "warning" | "error", number>;
  };
}

/** The declared support vocabulary, ordered strongest to weakest. */
export type CapabilityState =
  | "semantic"
  | "structural"
  | "repository-only"
  | "unsupported"
  | "experimental";

export interface CapabilityLanguageDto {
  id: string;
  extractorId: string;
  extractorVersion: string;
  features: Record<string, CapabilityState>;
}

/**
 * The checked-in product capability contract, served verbatim. This is what
 * Tadori DECLARES it supports and is never evidence that a given snapshot
 * observed anything — `SnapshotAnalysisDto` is the observed side.
 */
export interface CapabilityMatrixDto {
  version: number;
  claim: string;
  states: CapabilityState[];
  languages: CapabilityLanguageDto[];
}
