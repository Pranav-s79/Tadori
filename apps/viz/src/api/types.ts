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

export interface AggregatedProvenance {
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  count: number;
}
