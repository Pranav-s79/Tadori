import type { Evidence, GraphEdge, GraphNode, NodeKind, Relation } from "@tadori/core";
import { NODE_KINDS, RELATIONS } from "@tadori/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GraphService, ToolEdge, ToolNode } from "@tadori/mcp";
import { badRequest, conflict, notFound } from "../errors.js";
import type { NodeDetailDto, NodeEvidenceDto, Page } from "../types.js";

/**
 * Converts core `Evidence` (optional fields) to the wire shape
 * `toolEvidenceSchema` expects (explicit nulls) — mirrors the MCP tools
 * evidence() helper (packages/mcp/src/tools.ts:284-299), including the
 * commit-snapshot commitSha fallback, so HTTP and MCP agree on one evidence
 * conversion.
 */
function toToolEvidence(service: GraphService, evidence: readonly Evidence[]): ToolNode["evidence"] {
  return evidence.map((item) => ({
    file: item.file,
    kind: item.kind,
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
    columnStart: item.columnStart ?? null,
    columnEnd: item.columnEnd ?? null,
    commitSha:
      item.commitSha ?? (service.snapshot.kind === "commit" ? service.snapshot.base_commit_sha : null),
    excerptHash: item.excerptHash ?? null
  }));
}

const LEVELS = ["package", "file", "symbol"] as const;
type Level = (typeof LEVELS)[number];

const NODE_KIND_SET: ReadonlySet<string> = new Set(NODE_KINDS);
const RELATION_SET: ReadonlySet<string> = new Set(RELATIONS);

const MAX_NODE_LIMIT = 500;
const MAX_EDGE_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

function parseCursor(raw: unknown): number | null {
  if (raw === undefined) {
    return 0;
  }
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

function parseLimit(raw: unknown, max: number): number | null {
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    return null;
  }
  return value;
}

function paginate<T>(items: readonly T[], offset: number, limit: number): Page<T> {
  const slice = items.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  return {
    items: slice as T[],
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
    total: items.length
  };
}

export function toToolNode(app: FastifyInstance, node: GraphNode): ToolNode {
  const service = app.graphState.current();
  const freshness = service.nodeFreshness(node);
  return {
    entityKey: node.entityKey,
    kind: node.kind,
    qualifiedName: node.qualifiedName,
    displayName: node.displayName,
    file: node.file,
    lineStart: node.lineStart,
    lineEnd: node.lineEnd,
    signature: node.signature,
    exported: node.exported,
    fanIn: service.fanIn(node.entityKey),
    representation: node.signature !== null ? "signature" : "name",
    body: null,
    evidence: toToolEvidence(service, node.evidence),
    evidenceOmittedCount: 0,
    freshness: freshness.status,
    stale: freshness.stale,
    staleReason: freshness.reason
  };
}

export function toToolEdge(app: FastifyInstance, edge: GraphEdge): ToolEdge {
  const service = app.graphState.current();
  const freshness = service.edgeFreshness(edge);
  return {
    entityKey: edge.entityKey,
    srcEntityKey: edge.srcEntityKey,
    srcQualifiedName: service.nodesByKey.get(edge.srcEntityKey)?.qualifiedName ?? edge.srcEntityKey,
    relation: edge.relation,
    dstEntityKey: edge.dstEntityKey,
    dstQualifiedName: service.nodesByKey.get(edge.dstEntityKey)?.qualifiedName ?? edge.dstEntityKey,
    origin: edge.origin,
    confidence: edge.confidence,
    resolution: edge.resolution,
    evidence: toToolEvidence(service, edge.evidence),
    evidenceOmittedCount: 0,
    freshness: freshness.status,
    stale: freshness.stale,
    staleReason: freshness.reason
  };
}

function levelKinds(level: Level): ReadonlySet<NodeKind> {
  if (level === "package") {
    return new Set<NodeKind>(["package"]);
  }
  if (level === "file") {
    return new Set<NodeKind>(["file"]);
  }
  return new Set<NodeKind>(
    NODE_KINDS.filter((kind) => kind !== "package" && kind !== "file")
  );
}

interface NodeQuery {
  level?: string;
  packageName?: string;
  file?: string;
  kind?: string;
  exported?: string;
  cursor?: string;
  limit?: string;
}

interface EdgeQuery {
  relation?: string;
  origin?: string;
  confidence?: string;
  resolution?: string;
  srcKey?: string;
  dstKey?: string;
  cursor?: string;
  limit?: string;
}

export async function registerGraphRoutes(app: FastifyInstance): Promise<void> {
  app.get("/nodes", async (request: FastifyRequest<{ Querystring: NodeQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const { level, packageName, file, kind, exported } = request.query;
    if (level !== undefined && !LEVELS.includes(level as Level)) {
      const { statusCode, payload } = badRequest("bad_level");
      return reply.code(statusCode).send(payload);
    }
    if (kind !== undefined && !NODE_KIND_SET.has(kind)) {
      const { statusCode, payload } = badRequest("bad_level");
      return reply.code(statusCode).send(payload);
    }
    const offset = parseCursor(request.query.cursor);
    if (offset === null) {
      const { statusCode, payload } = badRequest("bad_level");
      return reply.code(statusCode).send(payload);
    }
    const limit = parseLimit(request.query.limit, MAX_NODE_LIMIT);
    if (limit === null) {
      const { statusCode, payload } = badRequest("bad_level");
      return reply.code(statusCode).send(payload);
    }
    const filesByPath = new Map(service.graph.files.map((f) => [f.normalizedPath, f]));
    const allowedKinds = level === undefined ? null : levelKinds(level as Level);
    const filtered = service.graph.nodes.filter((node) => {
      if (allowedKinds !== null && !allowedKinds.has(node.kind)) {
        return false;
      }
      if (kind !== undefined && node.kind !== kind) {
        return false;
      }
      if (file !== undefined && node.file !== file) {
        return false;
      }
      if (packageName !== undefined) {
        const nodePackage =
          node.kind === "package" ? node.qualifiedName : node.file !== null ? filesByPath.get(node.file)?.packageName ?? null : null;
        if (nodePackage !== packageName) {
          return false;
        }
      }
      if (exported !== undefined && node.exported !== (exported === "true")) {
        return false;
      }
      return true;
    });
    const page = paginate(filtered, offset, limit);
    const body: Page<ToolNode> = {
      items: page.items.map((node) => toToolNode(app, node)),
      nextCursor: page.nextCursor,
      total: page.total
    };
    return reply.send(body);
  });

  app.get("/edges", async (request: FastifyRequest<{ Querystring: EdgeQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const { relation, origin, confidence, resolution, srcKey, dstKey } = request.query;
    if (relation !== undefined && !RELATION_SET.has(relation)) {
      const { statusCode, payload } = badRequest("bad_query");
      return reply.code(statusCode).send(payload);
    }
    const offset = parseCursor(request.query.cursor);
    if (offset === null) {
      const { statusCode, payload } = badRequest("bad_query");
      return reply.code(statusCode).send(payload);
    }
    const limit = parseLimit(request.query.limit, MAX_EDGE_LIMIT);
    if (limit === null) {
      const { statusCode, payload } = badRequest("bad_query");
      return reply.code(statusCode).send(payload);
    }
    const filtered = service.graph.edges.filter((edge) => {
      if (relation !== undefined && edge.relation !== (relation as Relation)) {
        return false;
      }
      if (origin !== undefined && edge.origin !== origin) {
        return false;
      }
      if (confidence !== undefined && edge.confidence !== confidence) {
        return false;
      }
      if (resolution !== undefined && edge.resolution !== resolution) {
        return false;
      }
      if (srcKey !== undefined && edge.srcEntityKey !== srcKey) {
        return false;
      }
      if (dstKey !== undefined && edge.dstEntityKey !== dstKey) {
        return false;
      }
      return true;
    });
    const page = paginate(filtered, offset, limit);
    const body: Page<ToolEdge> = {
      items: page.items.map((edge) => toToolEdge(app, edge)),
      nextCursor: page.nextCursor,
      total: page.total
    };
    return reply.send(body);
  });

  app.get(
    "/nodes/:entityKey",
    async (request: FastifyRequest<{ Params: { entityKey: string } }>, reply: FastifyReply) => {
      const service = app.graphState.current();
      // resolveEntity (not a raw nodesByKey lookup) so the documented 409
      // ambiguous outcome is reachable: it accepts an entity key, an exact
      // qualified name, or a display name, and reports multiple
      // display-name matches as candidates instead of silently picking one
      // (mirrors the MCP tools resolve() helper, packages/mcp/src/tools.ts:367-369).
      const resolution = service.resolveEntity(request.params.entityKey);
      if (resolution.node === null && resolution.candidates.length > 1) {
        const { statusCode, payload } = conflict("ambiguous");
        return reply.code(statusCode).send(payload);
      }
      const node = resolution.node;
      if (!node) {
        const { statusCode, payload } = notFound("unknown_entity");
        return reply.code(statusCode).send(payload);
      }
      const outEdges = service.outEdges.get(node.entityKey) ?? [];
      const inEdges = service.inEdges.get(node.entityKey) ?? [];
      const body: NodeDetailDto = {
        ...toToolNode(app, node),
        outEdges: outEdges.map((edge) => toToolEdge(app, edge)),
        inEdges: inEdges.map((edge) => toToolEdge(app, edge)),
        fanIn: service.fanIn(node.entityKey)
      };
      return reply.send(body);
    }
  );

  app.get(
    "/nodes/:entityKey/evidence",
    async (request: FastifyRequest<{ Params: { entityKey: string } }>, reply: FastifyReply) => {
      const service = app.graphState.current();
      const node = service.nodesByKey.get(request.params.entityKey);
      if (!node) {
        const { statusCode, payload } = notFound("unknown_entity");
        return reply.code(statusCode).send(payload);
      }
      const freshness = service.nodeFreshness(node);
      const body: NodeEvidenceDto = {
        evidence: node.evidence,
        freshness: freshness.status
      };
      return reply.send(body);
    }
  );
}
