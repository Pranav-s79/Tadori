import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { diffSnapshotEdges, getSnapshot, loadSnapshotGraph } from "@tadori/store";
import { badRequest, notFound } from "../errors.js";
import { toToolNode } from "./graph.js";
import type { ReviewDiffDto, SnapshotRowDto } from "../types.js";
import type { SnapshotRow } from "@tadori/store";

interface ReviewDiffQuery {
  base?: string;
  head?: string;
  coalesce?: string;
}

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

export async function registerReviewRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/review/diff",
    async (request: FastifyRequest<{ Querystring: ReviewDiffQuery }>, reply: FastifyReply) => {
      const service = app.graphState.current();
      const { base, head } = request.query;
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
      const db = app.graphState.currentDb();
      const baseSnapshot = getSnapshot(db, baseId);
      const headSnapshot = getSnapshot(db, headId);
      if (!baseSnapshot || !headSnapshot) {
        const { statusCode, payload } = notFound("unknown_snapshot");
        return reply.code(statusCode).send(payload);
      }

      const edges = diffSnapshotEdges(db, baseId, headId);

      // Node-level add/remove: set-difference the two snapshots' node keys.
      // For the currently served snapshot we already have the in-memory
      // graph (service.graph); for the other snapshot id, or when neither
      // side is the served snapshot, load via the store directly.
      const baseGraph = baseId === service.snapshot.id ? service.graph : loadSnapshotGraph(db, baseId);
      const headGraph = headId === service.snapshot.id ? service.graph : loadSnapshotGraph(db, headId);
      const baseKeys = new Set(baseGraph.nodes.map((node) => node.entityKey));
      const headKeys = new Set(headGraph.nodes.map((node) => node.entityKey));
      const nodesAdded = headGraph.nodes.filter((node) => !baseKeys.has(node.entityKey));
      const nodesRemoved = baseGraph.nodes.filter((node) => !headKeys.has(node.entityKey));

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
        base: toSnapshotRowDto(baseSnapshot),
        head: toSnapshotRowDto(headSnapshot),
        nodesAdded: nodesAdded.map((node) => toToolNode(app, node)),
        nodesRemoved: nodesRemoved.map((node) => toToolNode(app, node)),
        edges,
        presentation: "raw"
      };
      return reply.send(body);
    }
  );
}
