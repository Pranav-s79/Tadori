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
import type { ReviewDiffDto, SnapshotRowDto } from "../types.js";
import type { EdgeDiffRow, SnapshotRow } from "@tadori/store";
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
      // Coalesced (rename/move) presentation is 09-02's job. Until then it must
      // 501 explicitly — never silently return the raw diff labeled coalesced.
      if (coalesce === "coalesced") {
        const { statusCode, payload } = notImplemented("coalesced_unsupported");
        return reply.code(statusCode).send(payload);
      }
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
        nodesAdded = result.nodesAdded.map((node) => toToolNode(app, node));
        nodesRemoved = result.nodesRemoved.map((node) => toToolNode(app, node));
        edges = result.edges;
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
        nodesAdded = headGraph.nodes
          .filter((node) => !baseKeys.has(node.entityKey))
          .map((node) => toToolNode(app, node));
        nodesRemoved = baseGraph.nodes
          .filter((node) => !headKeys.has(node.entityKey))
          .map((node) => toToolNode(app, node));
        baseDto = toSnapshotRowDto(baseSnapshot);
        headDto = toSnapshotRowDto(headSnapshot);
      }

      const page = paginateReviewDiff({ nodesAdded, nodesRemoved, edges }, offset, limit);

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
        presentation: "raw"
      };
      return reply.send(body);
    }
  );
}
