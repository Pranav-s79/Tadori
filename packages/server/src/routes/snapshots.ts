import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSnapshot, listSnapshots, type SnapshotRow } from "@tadori/store";
import { badRequest, conflict, notFound } from "../errors.js";
import type { ApiContext, SnapshotRowDto, SnapshotSummaryDto } from "../types.js";

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

function buildContext(app: FastifyInstance): ApiContext {
  const service = app.graphState.current();
  const snapshotFreshness = service.snapshotFreshness();
  const refreshState = app.graphState.refreshState();
  const refreshPending = refreshState.snapshotId !== service.snapshot.id || refreshState.dirtyPaths.length > 0;
  return {
    repository: service.repoRoot,
    snapshotId: service.snapshot.id,
    snapshotKind: service.snapshot.kind,
    baseCommitSha: service.snapshot.base_commit_sha,
    workspaceHash: service.snapshot.workspace_hash,
    freshness: snapshotFreshness.status,
    stale: snapshotFreshness.stale,
    staleReason: snapshotFreshness.reason,
    refreshPending
  };
}

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/snapshot", async (_request: FastifyRequest, reply: FastifyReply) => {
    const service = app.graphState.current();
    if (!service.snapshot) {
      const { statusCode, payload } = notFound("no_active_snapshot");
      return reply.code(statusCode).send(payload);
    }
    const body: SnapshotSummaryDto = {
      context: buildContext(app),
      analyzerVersion: service.graph.analyzerVersion,
      counts: {
        files: service.graph.files.length,
        nodes: service.graph.nodes.length,
        edges: service.graph.edges.length
      }
    };
    return reply.send(body);
  });

  app.get("/snapshots", async (_request: FastifyRequest, reply: FastifyReply) => {
    const service = app.graphState.current();
    const rows = listSnapshots(app.graphState.currentDb(), service.repoId);
    return reply.send(rows.map(toSnapshotRowDto));
  });

  app.post(
    "/snapshots/:id/pin",
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { pinned?: boolean } }>,
      reply: FastifyReply
    ) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) {
        const { statusCode, payload } = badRequest("bad_snapshot_id");
        return reply.code(statusCode).send(payload);
      }
      const existing = getSnapshot(app.graphState.currentDb(), id);
      if (!existing) {
        const { statusCode, payload } = notFound("unknown_snapshot");
        return reply.code(statusCode).send(payload);
      }
      if (existing.status !== "active") {
        const { statusCode, payload } = conflict("invalid_snapshot");
        return reply.code(statusCode).send(payload);
      }
      const pinned = request.body?.pinned ?? true;
      app.graphState
        .currentDb()
        .prepare("UPDATE repository_snapshots SET pinned = ? WHERE id = ?")
        .run(pinned ? 1 : 0, id);
      const updated = getSnapshot(app.graphState.currentDb(), id);
      if (!updated) {
        const { statusCode, payload } = notFound("unknown_snapshot");
        return reply.code(statusCode).send(payload);
      }
      return reply.send(toSnapshotRowDto(updated));
    }
  );
}
