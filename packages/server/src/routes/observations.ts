import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { badRequest, conflict } from "../errors.js";
import type { ObservationEvent, ObservationEventType, ObservationsResponse } from "../types.js";

const OBSERVATION_EVENT_TYPES: ReadonlySet<string> = new Set<ObservationEventType>([
  "plan_mentioned",
  "file_read_observed",
  "modified",
  "test_selected",
  "test_executed",
  "capture_interrupted"
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural validation only (mirrors ObservationEvent, §10). Does not
 * resolve target refs — that happens per-item so one bad ref never fails
 * sibling well-formed items (§17 partial-acceptance rule). */
function validateShape(value: unknown): value is ObservationEvent {
  if (!isPlainObject(value)) {
    return false;
  }
  if (typeof value.type !== "string" || !OBSERVATION_EVENT_TYPES.has(value.type)) {
    return false;
  }
  if (value.source !== "claude_hook") {
    return false;
  }
  if (typeof value.at !== "string") {
    return false;
  }
  if (value.targets !== undefined) {
    if (!Array.isArray(value.targets)) {
      return false;
    }
    for (const target of value.targets) {
      if (!isPlainObject(target)) {
        return false;
      }
      if (target.kind !== "file" && target.kind !== "node") {
        return false;
      }
      if (typeof target.ref !== "string") {
        return false;
      }
    }
  }
  if (value.detail !== undefined && typeof value.detail !== "string") {
    return false;
  }
  return true;
}

/** Resolves a file target's ref (repo-relative path) to its stable
 * file_entities.id, scoped to the currently served snapshot. Unlike node
 * refs (GraphService.nodeEntityId), GraphService has no equivalent public
 * helper for files, so this mirrors nodeEntityId's query shape directly
 * against the store (service.ts:306-317 pattern). */
function resolveFileEntityId(app: FastifyInstance, ref: string): number | null {
  const service = app.graphState.current();
  const row = app.graphState
    .currentDb()
    .prepare(
      `SELECT fe.id
       FROM file_entities fe
       JOIN snapshot_files sf ON sf.file_id = fe.id
       WHERE fe.repo_id = ? AND sf.normalized_path = ? AND sf.snapshot_id = ?`
    )
    .get(service.repoId, ref, service.snapshot.id) as { id: number } | undefined;
  return row?.id ?? null;
}

export async function registerObservationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/observations",
    async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const body = request.body;
      if (!Array.isArray(body) || body.length === 0) {
        const { statusCode, payload } = badRequest("bad_schema");
        return reply.code(statusCode).send(payload);
      }
      for (const item of body) {
        if (!validateShape(item)) {
          const { statusCode, payload } = badRequest("bad_schema");
          return reply.code(statusCode).send(payload);
        }
      }
      const events = body as ObservationEvent[];

      const service = app.graphState.current();
      const rejected: ObservationsResponse["rejected"] = [];
      let accepted = 0;
      let wholeRequestRejected: { statusCode: number; payload: { error: string; code: string } } | null =
        null;

      for (let index = 0; index < events.length; index += 1) {
        const event = events[index]!;
        const resolvedTargets: Array<{ kind: "file" | "node"; entityId: number }> = [];
        let itemRejectReason: string | null = null;
        for (const target of event.targets ?? []) {
          const entityId =
            target.kind === "node" ? service.nodeEntityId(target.ref) : resolveFileEntityId(app, target.ref);
          if (entityId === null) {
            itemRejectReason = `unknown_${target.kind}_ref:${target.ref}`;
            break;
          }
          resolvedTargets.push({ kind: target.kind, entityId });
        }
        if (itemRejectReason !== null) {
          rejected.push({ index, reason: itemRejectReason });
          continue;
        }
        try {
          app.graphState.recordObservation({
            type: event.type,
            source: event.source,
            detail: event.detail,
            resolvedTargets
          });
          accepted += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("non-active task")) {
            // Narrow post-rotation window (AD-011/§14): the bound task itself
            // is unconstructible/unusable. Reject the whole request, not
            // just this item.
            wholeRequestRejected = conflict("no_active_task");
            break;
          }
          // Any other recordAgentEvent failure (e.g. duplicate targets in
          // one event, §17's other honesty-tracked invariants) is reported
          // truthfully per-item rather than mislabeled as a rotation —
          // "snapshot_rotated" is reserved for the rotation/inactive-task
          // error class only (L2).
          rejected.push({ index, reason: `rejected: ${message}` });
        }
      }

      if (wholeRequestRejected) {
        return reply.code(wholeRequestRejected.statusCode).send(wholeRequestRejected.payload);
      }

      const responseBody: ObservationsResponse = { accepted, rejected };
      return reply.send(responseBody);
    }
  );
}
