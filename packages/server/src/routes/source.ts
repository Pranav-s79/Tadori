import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import type { SourceSliceDto } from "../types.js";

interface SourceQuery {
  file?: string;
  lineStart?: string;
  lineEnd?: string;
}

/**
 * Cheap relative-path-escape pre-check, mirroring the relative-containment
 * half of `GraphService.resolveSnapshotPath` (service.ts:169-175) — the part
 * reachable without a snapshot-member lookup. `GraphService.readBody`'s own
 * `loadSnapshotFile` checks snapshot membership BEFORE path confinement
 * (service.ts:195-204), so a `../` escape that is (correctly) never a
 * snapshot member would otherwise surface as 404 not_in_snapshot instead of
 * 403 outside_repository. This pre-check restores the ordering the blueprint
 * requires (§14/§18: path-escape -> 403) without duplicating the realpath/
 * symlink resolution `resolveSnapshotPath` itself owns (that part stays
 * inside GraphService; this is a pure string/relative-segment check).
 *
 * Anchored to the served repo's root (`service.repoRoot`), not the process
 * cwd: anchoring at cwd misclassifies traversal as 404 not_in_snapshot
 * instead of 403 outside_repository whenever cwd sits at or near a
 * filesystem root (path.relative clamps `..` there instead of escaping).
 */
function escapesRepoRoot(repoRoot: string, normalizedPath: string): boolean {
  if (path.isAbsolute(normalizedPath)) {
    return true;
  }
  const relative = path.relative(repoRoot, path.resolve(repoRoot, normalizedPath));
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

export async function registerSourceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/source", async (request: FastifyRequest<{ Querystring: SourceQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const { file } = request.query;
    if (file === undefined || file.length === 0) {
      const { statusCode, payload } = badRequest("bad_query", "file is required");
      return reply.code(statusCode).send(payload);
    }
    if (escapesRepoRoot(service.repoRoot, file)) {
      const { statusCode, payload } = forbidden("outside_repository");
      return reply.code(statusCode).send(payload);
    }

    // GraphService.readBody reuses the exact same root-confined path
    // resolution (resolveSnapshotPath) and snapshot-membership check that
    // fileFreshness uses internally — no new path-resolution code here (§18
    // requirement). A synthetic whole-file "read span" (line 1 through a
    // sentinel past end-of-file) is used because readBody requires a
    // GraphNode with non-null line bounds; Array.slice clamps the upper
    // bound, so this reads the entire file without inventing new logic.
    const lineStart = request.query.lineStart !== undefined ? Number(request.query.lineStart) : 1;
    const lineEnd =
      request.query.lineEnd !== undefined ? Number(request.query.lineEnd) : Number.MAX_SAFE_INTEGER;
    const read = service.readBody({
      kind: "file",
      qualifiedName: file,
      displayName: file,
      canonicalIdentity: `node|file|${file}`,
      entityKey: "0".repeat(64),
      file,
      exported: false,
      spanStart: null,
      spanEnd: null,
      lineStart,
      lineEnd,
      signature: null,
      bodyHash: null,
      evidence: []
    });

    if (read.reason === "outside_repository") {
      const { statusCode, payload } = forbidden("outside_repository");
      return reply.code(statusCode).send(payload);
    }
    if (read.reason === "not_in_snapshot") {
      const { statusCode, payload } = notFound("not_in_snapshot");
      return reply.code(statusCode).send(payload);
    }
    if (read.reason === "content_changed") {
      const { statusCode, payload } = conflict("content_changed");
      return reply.code(statusCode).send(payload);
    }

    const responseBody: SourceSliceDto = {
      body: read.body,
      freshness: read.status,
      staleReason: read.reason
    };
    return reply.send(responseBody);
  });
}
