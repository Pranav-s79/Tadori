import type { Confidence, Evidence, Origin, Relation, Resolution } from "@tadori/core";
import type { BoundaryViolation, EdgeDiffRow } from "@tadori/store";
import type { FreshnessStatus } from "@tadori/mcp";
import type { ToolEdge, ToolNode } from "@tadori/mcp";

/** Tool-shaped evidence, exactly as emitted by toToolNode/toToolEdge. */
type StoryEvidence = ToolNode["evidence"];

export interface ApiContext {
  repository: string;
  snapshotId: number;
  snapshotKind: "commit" | "working_tree" | "staged" | "patch";
  baseCommitSha: string | null;
  workspaceHash: string;
  freshness: "fresh" | "stale" | "unknown";
  stale: boolean;
  staleReason:
    | "matches_snapshot"
    | "content_changed"
    | "refresh_pending"
    | "unreadable"
    | "outside_repository"
    | "not_in_snapshot";
  refreshPending: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export interface ApiError {
  error: string;
  code: string;
  detail?: string;
}

export interface SnapshotRowDto {
  id: number;
  kind: string;
  label: string | null;
  baseCommitSha: string | null;
  workspaceHash: string;
  pinned: boolean;
  status: string;
  createdAt: string;
}
// `pinned` MUST be converted at the DTO boundary with `Boolean(row.pinned)` —
// the store's SnapshotRow.pinned is a SQLite integer 0/1 (snapshots.ts:28);
// serializing the raw number violates the wire contract.

export type ObservationEventType =
  | "plan_mentioned"
  | "file_read_observed"
  | "modified"
  | "test_selected"
  | "test_executed"
  | "capture_interrupted";
// NOTE: no "task_start" — the server's one long-lived EventLog task already
// exists at process-lifetime scope (AD-011).

export interface ObservationEvent {
  type: ObservationEventType;
  source: "claude_hook";
  at: string; // ISO 8601; server re-stamps, does not trust producer clock for ordering
  targets?: { kind: "file" | "node"; ref: string }[]; // NOTE: no "edge" — matches EventLog.recordAgentEvent's real signature
  detail?: string;
}

export interface ObservationsResponse {
  accepted: number;
  rejected: { index: number; reason: string }[];
}

export interface NodeDetailDto extends ToolNode {
  outEdges: ToolEdge[];
  inEdges: ToolEdge[];
  fanIn: number;
}

export interface NodeEvidenceDto {
  evidence: Evidence[];
  freshness: FreshnessStatus;
}

export interface SourceSliceDto {
  body: string | null;
  freshness: FreshnessStatus;
  staleReason: string;
}

export interface PathResultDto {
  nodes: ToolNode[];
  edges: ToolEdge[];
  found: boolean;
}

/**
 * How a test is linked to the queried target, derived from the `tests`-edge
 * origin (same mapping as the MCP find_tests tool). A static/heuristic/git link
 * is NEVER a runtime-coverage claim — see the `observed`/`note` honesty fields.
 */
export type TestLinkage =
  | "statically_linked"
  | "naming_associated"
  | "package_associated"
  | "historically_associated"
  | "evidence_associated";

/** One likely-relevant test. `linkage`/`edge` are null when the query had no target. */
export interface TestLink {
  node: ToolNode;
  linkage: TestLinkage | null;
  edge: ToolEdge | null;
}

export interface TestsDto {
  /** The queried target (when `for` resolved), else null (whole-snapshot listing). */
  target: ToolNode | null;
  tests: TestLink[];
  observed: false;
  note: "not observed inspected";
}

export interface RoutesDto {
  routes: ToolNode[];
}

export interface DocsDto {
  docs: { node: ToolNode; body: string | null }[];
}

/** Boundary violations over the active snapshot (09-03). */
export interface BoundariesDto {
  /** True when a repository-root tadori.rules.json was found and parsed. */
  rulesPresent: boolean;
  violations: BoundaryViolation[];
}

// --- BehaviorStory (08-07A, frozen contract blueprints/09-behavior-story-contract.md) ---
// Static behavior story only: runtimeObserved is always false, no coverage claim.

export type StoryStepLabel =
  | "statically-resolved"
  | "test-backed"
  | "documented"
  | "inferred"
  | "ambiguous"
  | "unresolved";

export interface StoryStep {
  /** `step:${index}:${entityKey ?? "unresolved"}` */
  id: string;
  /** null only for kind:"unresolved" destinations */
  entityKey: string | null;
  /** NodeKind of the reached node */
  kind: string;
  /** dst.kind !== "unresolved" && reaching edge.resolution !== "unresolved" */
  resolved: boolean;
  label: StoryStepLabel;
  /** origin/confidence/resolution from the edge that reached this step */
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  /** reached node.evidence via toToolNode */
  evidence: StoryEvidence;
}

export interface StoryTransition {
  from: string;
  to: string | null;
  relation: Relation; // "routes_to" | "calls" | "references"
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  resolved: boolean; // resolution !== "unresolved"
  evidence: StoryEvidence; // edge.evidence verbatim
}

export interface BehaviorStory {
  /** `story:route:${entityKey}:${snapshotId}` */
  id: string;
  title: string; // route node displayName (e.g. "GET /users/:id")
  trigger: string; // route displayName (HTTP trigger)
  entryPoint: string; // the route node's entityKey
  steps: StoryStep[];
  transitions: StoryTransition[];
  tests: string[]; // test nodes with a `tests` edge into any step (sorted by entityKey)
  unresolvedTransitions: StoryTransition[]; // subset, resolution === "unresolved"
  branches: []; // v1: always empty (DEFER control-flow branching)
  evidenceOmittedCount: number; // 0 today (mirrors toToolNode/toToolEdge)
  snapshotId: number;
  confidence: Confidence; // weakest across transitions (inferred < likely < certain)
  runtimeObserved: false; // invariant: static analysis only
}

export interface LayoutPositionDto {
  entityKey: string;
  x: number;
  y: number;
  z: number;
  pinned: boolean;
}

export interface LayoutDto {
  positions: LayoutPositionDto[];
  layoutVersion: number;
}

export interface NotYetImplementedDto {
  available: false;
  reason: "not_yet_implemented";
}

export interface TourProgressDto {
  tourId: string;
  stepIndex: number;
  updatedAt: string;
}

/**
 * One coalesced rename/move row (09-02). Additive over the raw `edges` array —
 * `rawRowIndexes` point into that same array so the UI can expand back to raw.
 * Always presented as "likely", never certain.
 */
export interface CoalescedChangeDto {
  kind: "rename" | "move";
  fromKey: string | null;
  toKey: string | null;
  rawRowIndexes: number[];
}

/** A group of add/remove nodes that could not be disambiguated → raw fallback. */
export interface AmbiguousNodeGroupDto {
  candidateKeys: string[];
  reason: string;
}

export interface ReviewDiffDto {
  context: ApiContext;
  base: SnapshotRowDto;
  head: SnapshotRowDto;
  nodesAdded: ToolNode[];
  nodesRemoved: ToolNode[];
  edges: EdgeDiffRow[];
  /** Rows of each list not included on this page (see cursor). Never silently dropped. */
  nodesAddedOmitted: number;
  nodesRemovedOmitted: number;
  edgesOmitted: number;
  /** Offset cursor for the next page, or null when the diff is exhausted. */
  nextCursor: string | null;
  presentation: "raw" | "coalesced";
  /** Present only when presentation === "coalesced" (additive over `edges`). */
  coalesced?: CoalescedChangeDto[];
  ambiguousGroups?: AmbiguousNodeGroupDto[];
}

export interface SnapshotSummaryDto {
  context: ApiContext;
  analyzerVersion: string;
  counts: { files: number; nodes: number; edges: number };
}

export type ServerEvent =
  | {
      type: "snapshot_replaced";
      snapshotId: number;
      snapshotKind: string;
      generation: number;
      workspaceHash: string;
    }
  | { type: "refresh_pending"; phase: "dirty" | "refreshing"; dirtyPaths: string[]; generation: number }
  | {
      type: "refresh_settled";
      phase: "idle" | "failed";
      snapshotId: number | null;
      lastError: string | null;
      generation: number;
    }
  | { type: "watcher_error"; message: string }
  | { type: "observation"; event: ObservationEvent }; // reserved; not emitted until 08-09

export interface ClientEvent {
  type: "subscribe";
  channels: ("refresh" | "observation")[];
}
