import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { diffSnapshotEdges, getSnapshot, loadSnapshotGraph } from "@tadori/store";
import {
  GitUnavailableError,
  NotAGitRepositoryError,
  StagedCaptureFailedError
} from "@tadori/indexer";
import { badRequest, notFound, notImplemented, type ApiErrorResult } from "../errors.js";
import { toToolNode } from "./graph.js";
import { paginateReviewDiff, parseReviewCursor, parseReviewLimit } from "../reviewDiffAssembly.js";
import { computeLiveComparison, LiveCaptureFailedError } from "../liveComparison.js";
import {
  buildCoalescedChanges,
  coalesceEdges,
  stageAMatch,
  stageBMatch
} from "../coalescing.js";
import type { AmbiguousNodeGroupDto, CoalescedChangeDto, ReviewDiffDto, SnapshotRowDto } from "../types.js";
import type { EdgeDiffRow, SnapshotRow } from "@tadori/store";
import type { GraphNode } from "@tadori/core";
import type { ToolNode } from "@tadori/mcp";

interface ReviewDiffQuery {
  kind?: string;
  base?: string;
  head?: string;
  coalesce?: string;
  cursor?: string;
  limit?: string;
}

/**
 * The three comparison kinds (ARCHITECTURE §review). `snapshot` (the default)
 * diffs two explicit snapshot ids. `working_tree` and `staged` capture the
 * current disk / git-index state and diff it against the active snapshot; their
 * capture→index→diff wiring lands in the next 09-01 slice, so they return an
 * honest 501 here rather than silently behaving like `snapshot`.
 */
const COMPARISON_KINDS = ["snapshot", "working_tree", "staged"] as const;
type ComparisonKind = (typeof COMPARISON_KINDS)[number];

function toSnapshotRowDto(row: SnapshotRow): SnapshotRowDto {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    baseCommitSha: row.base_commit_sha,
    workspaceHash: row.workspace_hash,
    pinned: Boolean(row.pinned),
    status: row.status,
    createdAt: row.created_at
  };
}

/**
 * The HEAD of a working_tree/staged comparison is a live capture, not a
 * persisted snapshot, so it has no store row. Report it honestly with a
 * sentinel id (`-1`) and an empty workspace hash — never a fabricated id that
 * could be mistaken for a real snapshot.
 */
function liveHeadDto(kind: "working_tree" | "staged"): SnapshotRowDto {
  return {
    id: -1,
    kind,
    label: `${kind} (live capture)`,
    baseCommitSha: null,
    workspaceHash: "",
    pinned: false,
    status: "live",
    createdAt: new Date().toISOString()
  };
}

/**
 * Map a live-capture failure to an honest HTTP error. Git being unavailable is
 * an environmental 501 (the comparison genuinely cannot run here); a
 * non-repository or a failed capture/index is a 400 the caller could act on.
 * An unexpected error is re-thrown so Fastify surfaces a 500 rather than us
 * silently labeling it a known condition.
 */
function mapLiveComparisonError(err: unknown): ApiErrorResult {
  if (err instanceof GitUnavailableError) {
    return notImplemented("git_unavailable");
  }
  if (err instanceof NotAGitRepositoryError) {
    return badRequest("not_a_git_repository");
  }
  if (err instanceof StagedCaptureFailedError) {
    return badRequest("staged_capture_failed");
  }
  if (err instanceof LiveCaptureFailedError) {
    return badRequest(`${err.kind}_capture_failed`);
  }
  throw err;
}

export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/review/diff",
    async (request: FastifyRequest<{ Querystring: ReviewDiffQuery }>, reply: FastifyReply) => {
      const service = app.graphState.current();
      const { base, head, coalesce } = request.query;
      const wantCoalesced = coalesce === "coalesced";
      const kind: ComparisonKind = (request.query.kind ?? "snapshot") as ComparisonKind;
      if (!COMPARISON_KINDS.includes(kind)) {
        const { statusCode, payload } = badRequest("bad_comparison_kind");
        return reply.code(statusCode).send(payload);
      }
      const offset = parseReviewCursor(request.query.cursor);
      const limit = parseReviewLimit(request.query.limit);
      if (offset === null || limit === null) {
        const { statusCode, payload } = badRequest("bad_page");
        return reply.code(statusCode).send(payload);
      }

      const db = app.graphState.currentDb();

      // Resolve the diff's raw {nodesAdded, nodesRemoved, edges} plus the two
      // SnapshotRowDtos for the response, per comparison kind. `snapshot` diffs
      // two persisted snapshot ids; `working_tree`/`staged` capture the live
      // disk / git-index and diff it against the served ACTIVE snapshot (base),
      // never mutating the working tree, git index, or served active snapshot.
      let nodesAdded: ToolNode[];
      let nodesRemoved: ToolNode[];
      let edges: EdgeDiffRow[];
      let baseDto: SnapshotRowDto;
      let headDto: SnapshotRowDto;
      // Raw GraphNodes (carry bodyHash — ToolNode does not) + analyzerVersion,
      // captured for coalescing when coalesce=coalesced.
      let rawNodesAdded: GraphNode[];
      let rawNodesRemoved: GraphNode[];
      let analyzerVersion: string;

      if (kind === "working_tree" || kind === "staged") {
        let result;
        try {
          result = await computeLiveComparison(
            db,
            service.repoRoot,
            service.snapshot.id,
            kind
          );
        } catch (err) {
          const mapped = mapLiveComparisonError(err);
          return reply.code(mapped.statusCode).send(mapped.payload);
        }
        rawNodesAdded = result.nodesAdded;
        rawNodesRemoved = result.nodesRemoved;
        nodesAdded = result.nodesAdded.map((node) => toToolNode(app, node));
        nodesRemoved = result.nodesRemoved.map((node) => toToolNode(app, node));
        edges = result.edges;
        analyzerVersion = service.graph.analyzerVersion;
        baseDto = toSnapshotRowDto(service.snapshot);
        headDto = liveHeadDto(kind);
      } else {
        if (base === undefined || head === undefined) {
          const { statusCode, payload } = badRequest("bad_snapshot_ref");
          return reply.code(statusCode).send(payload);
        }
        const baseId = Number(base);
        const headId = Number(head);
        if (!Number.isInteger(baseId) || !Number.isInteger(headId)) {
          const { statusCode, payload } = badRequest("bad_snapshot_ref");
          return reply.code(statusCode).send(payload);
        }
        const baseSnapshot = getSnapshot(db, baseId);
        const headSnapshot = getSnapshot(db, headId);
        if (!baseSnapshot || !headSnapshot) {
          const { statusCode, payload } = notFound("unknown_snapshot");
          return reply.code(statusCode).send(payload);
        }

        edges = diffSnapshotEdges(db, baseId, headId);

        // Node-level add/remove: set-difference the two snapshots' node keys.
        // For the currently served snapshot we already have the in-memory
        // graph (service.graph); for the other snapshot id, or when neither
        // side is the served snapshot, load via the store directly.
        const baseGraph =
          baseId === service.snapshot.id ? service.graph : loadSnapshotGraph(db, baseId);
        const headGraph =
          headId === service.snapshot.id ? service.graph : loadSnapshotGraph(db, headId);
        const baseKeys = new Set(baseGraph.nodes.map((node) => node.entityKey));
        const headKeys = new Set(headGraph.nodes.map((node) => node.entityKey));
        rawNodesAdded = headGraph.nodes.filter((node) => !baseKeys.has(node.entityKey));
        rawNodesRemoved = baseGraph.nodes.filter((node) => !headKeys.has(node.entityKey));
        nodesAdded = rawNodesAdded.map((node) => toToolNode(app, node));
        nodesRemoved = rawNodesRemoved.map((node) => toToolNode(app, node));
        // Head graph defines the diff's analyzer version.
        analyzerVersion = headGraph.analyzerVersion;
        baseDto = toSnapshotRowDto(baseSnapshot);
        headDto = toSnapshotRowDto(headSnapshot);
      }

      const page = paginateReviewDiff({ nodesAdded, nodesRemoved, edges }, offset, limit);

      // Coalesced (rename/move) presentation is additive over the raw diff. It
      // is computed over the FULL raw node/edge sets (indexes into `edges` stay
      // stable). Any failure falls back to the raw view — coalescing is a
      // presentation enhancement and must never make the diff unavailable (§17).
      let coalesced: CoalescedChangeDto[] | undefined;
      let ambiguousGroups: AmbiguousNodeGroupDto[] | undefined;
      if (wantCoalesced) {
        try {
          const stageA = stageAMatch(rawNodesRemoved, rawNodesAdded, analyzerVersion);
          const stageB = stageBMatch(stageA.remainingRemoved, stageA.remainingAdded, analyzerVersion);
          const nodePairs = [...stageA.pairs, ...stageB.pairs];
          const { edgePairs } = coalesceEdges(edges, nodePairs);
          coalesced = buildCoalescedChanges(nodePairs, edgePairs, edges).map((change) => ({
            kind: change.kind,
            fromKey: change.fromKey,
            toKey: change.toKey,
            rawRowIndexes: change.rawRowIndexes
          }));
          ambiguousGroups = stageB.ambiguousGroups.map((group) => ({
            candidateKeys: group.candidates.map((node) => node.entityKey),
            reason: group.reason
          }));
        } catch (err) {
          app.log.error({ err }, "review-diff coalescing failed; falling back to raw");
          coalesced = undefined;
          ambiguousGroups = undefined;
        }
      }

      const snapshotFreshness = service.snapshotFreshness();
      const refreshState = app.graphState.refreshState();
      const body: ReviewDiffDto = {
        context: {
          repository: service.repoRoot,
          snapshotId: service.snapshot.id,
          snapshotKind: service.snapshot.kind,
          baseCommitSha: service.snapshot.base_commit_sha,
          workspaceHash: service.snapshot.workspace_hash,
          freshness: snapshotFreshness.status,
          stale: snapshotFreshness.stale,
          staleReason: snapshotFreshness.reason,
          refreshPending: refreshState.snapshotId !== service.snapshot.id || refreshState.dirtyPaths.length > 0
        },
        base: baseDto,
        head: headDto,
        nodesAdded: page.nodesAdded,
        nodesRemoved: page.nodesRemoved,
        edges: page.edges,
        nodesAddedOmitted: page.nodesAddedOmitted,
        nodesRemovedOmitted: page.nodesRemovedOmitted,
        edgesOmitted: page.edgesOmitted,
        nextCursor: page.nextCursor,
        // If coalescing was requested and succeeded, present as coalesced;
        // otherwise (not requested, or fell back on failure) present as raw.
        presentation: coalesced !== undefined ? "coalesced" : "raw",
        ...(coalesced !== undefined ? { coalesced, ambiguousGroups } : {})
      };
      return reply.send(body);
    }
  );
}
