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

export interface ApiNode {
  entityKey: string;
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  file: string | null;
  exported: boolean;
  fanIn: number;
}

export interface ApiEdge {
  entityKey: string;
  srcEntityKey: string;
  relation: string;
  dstEntityKey: string;
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
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
