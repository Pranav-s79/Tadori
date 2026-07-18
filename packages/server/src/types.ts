import type { Evidence } from "@tadori/core";
import type { EdgeDiffRow } from "@tadori/store";
import type { FreshnessStatus } from "@tadori/mcp";
import type { ToolEdge, ToolNode } from "@tadori/mcp";

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

export interface TestsDto {
  tests: ToolNode[];
  observed: false;
  note: "not observed inspected";
}

export interface RoutesDto {
  routes: ToolNode[];
}

export interface DocsDto {
  docs: { node: ToolNode; body: string | null }[];
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

export interface ReviewDiffDto {
  context: ApiContext;
  base: SnapshotRowDto;
  head: SnapshotRowDto;
  nodesAdded: ToolNode[];
  nodesRemoved: ToolNode[];
  edges: EdgeDiffRow[];
  presentation: "raw";
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
