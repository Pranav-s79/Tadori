import type { Evidence, GraphEdge, GraphNode, Relation } from "@tadori/core";
import { NODE_KINDS, RELATIONS } from "@tadori/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GraphService, ToolEdge, ToolNode } from "@tadori/mcp";
import { badRequest, conflict, notFound } from "../errors.js";
import type { NodeDetailDto, NodeEvidenceDto, Page } from "../types.js";
import {
  clampResponseLimit,
  LOD_EDGE_RESPONSE_CAP,
  LOD_NODE_RESPONSE_CAPS
} from "../lodBudgets.js";
import { getPackageProjection, type ProjectedPackageEdge } from "../packageProjection.js";
import { selectLodScope } from "../lodScope.js";

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

interface PackageAggregateEdgeDto {
  entityKey: string;
  srcEntityKey: string;
  srcQualifiedName: string;
  relation: Relation;
  dstEntityKey: string;
  dstQualifiedName: string;
  projectionKind: "package_aggregate";
  aggregateCount: number;
  aggregateProvenance: Array<{
    origin: GraphEdge["origin"];
    confidence: GraphEdge["confidence"];
    resolution: GraphEdge["resolution"];
    count: number;
  }>;
  aggregateLanguages: string[];
  aggregateCapabilities: string[];
  aggregateDerivations: string[];
  sourceEdgeCount: number;
  sourceEdgeOmittedCount: number;
  evidenceOmittedCount: number;
}

function packageAggregateDto(
  service: GraphService,
  projected: ProjectedPackageEdge,
  sourceEdges: readonly GraphEdge[]
): PackageAggregateEdgeDto {
  const buckets = new Map<string, PackageAggregateEdgeDto["aggregateProvenance"][number]>();
  for (const edge of sourceEdges) {
    const key = `${edge.origin}\0${edge.confidence}\0${edge.resolution}`;
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, { origin: edge.origin, confidence: edge.confidence, resolution: edge.resolution, count: 1 });
    } else existing.count += 1;
  }
  return {
    entityKey: projected.entityKey,
    srcEntityKey: projected.srcPackageKey,
    srcQualifiedName: service.nodesByKey.get(projected.srcPackageKey)?.qualifiedName ?? projected.srcPackageKey,
    relation: projected.relation,
    dstEntityKey: projected.dstPackageKey,
    dstQualifiedName: service.nodesByKey.get(projected.dstPackageKey)?.qualifiedName ?? projected.dstPackageKey,
    projectionKind: "package_aggregate",
    aggregateCount: sourceEdges.length,
    aggregateProvenance: [...buckets.values()].sort((left, right) =>
      `${left.origin}\0${left.confidence}\0${left.resolution}`
        .localeCompare(`${right.origin}\0${right.confidence}\0${right.resolution}`)),
    aggregateLanguages: [...new Set(sourceEdges.flatMap((edge) => edge.language ? [edge.language] : []))].sort(),
    aggregateCapabilities: [...new Set(sourceEdges.flatMap((edge) => edge.provenance ? [edge.provenance.capability] : []))].sort(),
    aggregateDerivations: [...new Set(sourceEdges.flatMap((edge) => edge.provenance ? [edge.provenance.derivation] : []))].sort(),
    sourceEdgeCount: sourceEdges.length,
    sourceEdgeOmittedCount: projected.sourceEdges.length - sourceEdges.length,
    evidenceOmittedCount: sourceEdges.reduce((sum, edge) => sum + edge.evidence.length, 0)
  };
}

const NODE_KIND_SET: ReadonlySet<string> = new Set(NODE_KINDS);
const RELATION_SET: ReadonlySet<string> = new Set(RELATIONS);

function parseCursor(raw: unknown): number | null {
  if (raw === undefined) {
    return 0;
  }
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
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
    staleReason: freshness.reason,
    language: node.language ?? null,
    provenance: node.provenance ?? null
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
    staleReason: freshness.reason,
    language: edge.language ?? null,
    provenance: edge.provenance ?? null
  };
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
  level?: string;
  packageName?: string;
  file?: string;
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
    const nodeCap = level === undefined ? LOD_NODE_RESPONSE_CAPS.file : LOD_NODE_RESPONSE_CAPS[level as Level];
    const limit = clampResponseLimit(request.query.limit, nodeCap);
    if (limit === null) {
      const { statusCode, payload } = badRequest("bad_level");
      return reply.code(statusCode).send(payload);
    }
    const packageProjection = level === "package" ? getPackageProjection(service.graph) : null;
    const ownershipProjection = level === "file" ? getPackageProjection(service.graph) : packageProjection ?? undefined;
    const scope = level === undefined ? null : selectLodScope(
      service.graph,
      level as Level,
      { ...(packageName === undefined ? {} : { packageName }), ...(file === undefined ? {} : { file }) },
      ownershipProjection
    );
    const candidateNodes = scope?.nodes ?? service.graph.nodes;
    const filtered = candidateNodes.filter((node) => {
      if (kind !== undefined && node.kind !== kind) {
        return false;
      }
      if (exported !== undefined && node.exported !== (exported === "true")) {
        return false;
      }
      return true;
    }).sort((left, right) => left.entityKey.localeCompare(right.entityKey));
    const page = paginate(filtered, offset, limit);
    const body: Page<ToolNode & {
      aggregateLanguages?: string[];
      aggregateCapabilities?: string[];
      aggregateDerivations?: string[];
    }> = {
      items: page.items.map((node) => ({
        ...toToolNode(app, node),
        ...(packageProjection?.aggregatesByPackageKey.get(node.entityKey) ?? {})
      })),
      nextCursor: page.nextCursor,
      total: scope?.allNodes.length ?? page.total,
      omittedCount: (scope?.omittedNodeCount ?? 0) + Math.max(0, (page.total ?? 0) - offset - page.items.length),
      ...(packageProjection === null ? {} : { projection: packageProjection.accounting }),
      ...(scope === null ? {} : {
        scope: {
          totalNodeCount: scope.allNodes.length,
          boundedNodeCount: scope.nodes.length,
          omittedNodeCount: scope.omittedNodeCount,
          omittedEdgeCount: 0
        }
      })
    };
    return reply.send(body);
  });

  app.get("/edges", async (request: FastifyRequest<{ Querystring: EdgeQuery }>, reply: FastifyReply) => {
    const service = app.graphState.current();
    const { level, packageName, file, relation, origin, confidence, resolution, srcKey, dstKey } = request.query;
    if (level !== undefined && !LEVELS.includes(level as Level)) {
      const { statusCode, payload } = badRequest("bad_level");
      return reply.code(statusCode).send(payload);
    }
    if (relation !== undefined && !RELATION_SET.has(relation)) {
      const { statusCode, payload } = badRequest("bad_query");
      return reply.code(statusCode).send(payload);
    }
    const offset = parseCursor(request.query.cursor);
    if (offset === null) {
      const { statusCode, payload } = badRequest("bad_query");
      return reply.code(statusCode).send(payload);
    }
    const limit = clampResponseLimit(request.query.limit, LOD_EDGE_RESPONSE_CAP);
    if (limit === null) {
      const { statusCode, payload } = badRequest("bad_query");
      return reply.code(statusCode).send(payload);
    }
    const packageProjection = level === "package" ? getPackageProjection(service.graph) : null;
    const ownershipProjection = level === "file" ? getPackageProjection(service.graph) : packageProjection ?? undefined;
    const scope = level === undefined ? null : selectLodScope(
      service.graph,
      level as Level,
      { ...(packageName === undefined ? {} : { packageName }), ...(file === undefined ? {} : { file }) },
      ownershipProjection
    );
    if (packageProjection !== null) {
      const filteredGroups = packageProjection.edges.flatMap((item) => {
        if (relation !== undefined && item.relation !== relation) return [];
        if (srcKey !== undefined && item.srcPackageKey !== srcKey) return [];
        if (dstKey !== undefined && item.dstPackageKey !== dstKey) return [];
        const sourceEdges = item.sourceEdges.filter((edge) =>
          (origin === undefined || edge.origin === origin)
          && (confidence === undefined || edge.confidence === confidence)
          && (resolution === undefined || edge.resolution === resolution));
        return sourceEdges.length === 0 ? [] : [{ item, sourceEdges }];
      });
      const boundedGroups = filteredGroups.filter(({ item }) =>
        scope!.keys.has(item.srcPackageKey) && scope!.keys.has(item.dstPackageKey));
      const omittedByNodeBudget = filteredGroups.length - boundedGroups.length;
      const page = paginate(boundedGroups, offset, limit);
      const body: Page<PackageAggregateEdgeDto> = {
        items: page.items.map(({ item, sourceEdges }) => packageAggregateDto(service, item, sourceEdges)),
        nextCursor: page.nextCursor,
        total: page.total,
        omittedCount: omittedByNodeBudget + Math.max(0, (page.total ?? 0) - offset - page.items.length),
        projection: packageProjection.accounting,
        scope: {
          totalNodeCount: scope!.allNodes.length,
          boundedNodeCount: scope!.nodes.length,
          omittedNodeCount: scope!.omittedNodeCount,
          omittedEdgeCount: omittedByNodeBudget
        }
      };
      return reply.send(body);
    }
    const rawMatches = service.graph.edges.filter((edge) =>
      (relation === undefined || edge.relation === relation)
      && (origin === undefined || edge.origin === origin)
      && (confidence === undefined || edge.confidence === confidence)
      && (resolution === undefined || edge.resolution === resolution)
      && (srcKey === undefined || edge.srcEntityKey === srcKey)
      && (dstKey === undefined || edge.dstEntityKey === dstKey)
      && (scope === null || (scope.allKeys.has(edge.srcEntityKey) && scope.allKeys.has(edge.dstEntityKey))));
    const filtered = scope === null ? rawMatches : rawMatches.filter((edge) =>
      scope.keys.has(edge.srcEntityKey) && scope.keys.has(edge.dstEntityKey));
    const omittedByNodeBudget = rawMatches.length - filtered.length;
    const page = paginate(filtered, offset, limit);
    const body: Page<ToolEdge> = {
      items: page.items.map((edge) => toToolEdge(app, edge)),
      nextCursor: page.nextCursor,
      total: page.total,
      omittedCount: omittedByNodeBudget + Math.max(0, (page.total ?? 0) - offset - page.items.length),
      ...(scope === null ? {} : {
        scope: {
          totalNodeCount: scope.allNodes.length,
          boundedNodeCount: scope.nodes.length,
          omittedNodeCount: scope.omittedNodeCount,
          omittedEdgeCount: omittedByNodeBudget
        }
      })
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
