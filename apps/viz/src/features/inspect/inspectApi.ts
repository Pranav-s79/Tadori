import type { Confidence, NodeKind, Origin, Resolution } from "../../api/types.ts";

const API_BASE = "/api/v1";

/** Frozen evidence kinds (packages/core EVIDENCE_KINDS). */
export type EvidenceKind = "source" | "documentation" | "git" | "human_annotation" | "tool_event";

/** Freshness status, mirroring the server FreshnessStatus. */
export type Freshness = "fresh" | "stale" | "unknown";

/**
 * One evidence anchor (mirrors packages/mcp toolEvidenceSchema, served verbatim
 * on ToolNode/ToolEdge). The app cannot import @tadori/* so the shape is
 * re-declared here.
 */
export interface Evidence {
  file: string;
  kind: EvidenceKind;
  lineStart: number;
  lineEnd: number;
  columnStart: number | null;
  columnEnd: number | null;
  commitSha: string | null;
  excerptHash: string | null;
}

/** Mirrors packages/mcp toolNodeSchema. */
export interface ToolNode {
  entityKey: string;
  kind: NodeKind;
  qualifiedName: string;
  displayName: string;
  file: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  signature: string | null;
  exported: boolean;
  fanIn: number;
  representation: "body" | "signature" | "name" | "aggregate";
  body: string | null;
  evidence: Evidence[];
  evidenceOmittedCount: number;
  freshness: Freshness;
  stale: boolean;
  staleReason: string | null;
}

/** Mirrors packages/mcp toolEdgeSchema. Provenance fields are always present. */
export interface ToolEdge {
  entityKey: string;
  srcEntityKey: string;
  srcQualifiedName: string;
  relation: string;
  dstEntityKey: string;
  dstQualifiedName: string;
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  evidence: Evidence[];
  evidenceOmittedCount: number;
  freshness: Freshness;
  stale: boolean;
  staleReason: string | null;
}

/** GET /api/v1/nodes/:entityKey → NodeDetailDto. */
export interface NodeDetail extends ToolNode {
  outEdges: ToolEdge[];
  inEdges: ToolEdge[];
}

/**
 * Result of fetching one node's detail. Status is explicitly discriminated so
 * the panel can render distinct honest states for the documented 404/409 cases
 * (ARCHITECTURE.md §3 row 6) rather than a generic failure.
 */
export type NodeDetailResult =
  | { status: "ok"; node: NodeDetail }
  | { status: "not_found" }
  | { status: "ambiguous" }
  | { status: "error"; message: string };

/** GET /api/v1/source → SourceSliceDto. */
export interface SourceSlice {
  body: string | null;
  freshness: Freshness;
  /** "matches_snapshot" is the only value at which body may be shown. */
  staleReason: string;
}

export type SourceSliceResult =
  | { status: "ok"; slice: SourceSlice }
  | { status: "outside_repository" }
  | { status: "not_in_snapshot" }
  | { status: "content_changed" }
  | { status: "error"; message: string };

/** A single linked ADR/doc body, or null when the entity has none. */
export interface LinkedDoc {
  node: ToolNode;
  body: string | null;
}

async function getJson(path: string): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  return { ok: true, body: (await response.json()) as unknown };
}

/** GET /api/v1/nodes/:entityKey — 404 unknown_entity, 409 ambiguous. */
export async function fetchNodeDetail(entityKey: string): Promise<NodeDetailResult> {
  try {
    const res = await getJson(`/nodes/${encodeURIComponent(entityKey)}`);
    if (!res.ok) {
      if (res.status === 404) {
        return { status: "not_found" };
      }
      if (res.status === 409) {
        return { status: "ambiguous" };
      }
      return { status: "error", message: `node detail failed: ${res.status}` };
    }
    return { status: "ok", node: res.body as NodeDetail };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "network error" };
  }
}

/**
 * GET /api/v1/nodes/:entityKey/evidence — the node detail already embeds
 * `evidence`/`evidenceOmittedCount`, but this endpoint returns evidence plus a
 * freshness-only view. Kept for callers that need evidence without the full
 * edge lists. 404 unknown_entity.
 */
export async function fetchNodeEvidence(
  entityKey: string
): Promise<
  | { status: "ok"; evidence: Evidence[]; freshness: Freshness }
  | { status: "not_found" }
  | { status: "error"; message: string }
> {
  try {
    const res = await getJson(`/nodes/${encodeURIComponent(entityKey)}/evidence`);
    if (!res.ok) {
      return res.status === 404 ? { status: "not_found" } : { status: "error", message: `evidence failed: ${res.status}` };
    }
    const body = res.body as { evidence: Evidence[]; freshness: Freshness };
    return { status: "ok", evidence: body.evidence, freshness: body.freshness };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "network error" };
  }
}

/** GET /api/v1/source — 403 outside_repository, 404 not_in_snapshot, 409 content_changed. */
export async function fetchSource(
  file: string,
  lineStart?: number | null,
  lineEnd?: number | null
): Promise<SourceSliceResult> {
  try {
    const params = new URLSearchParams({ file });
    if (typeof lineStart === "number") {
      params.set("lineStart", String(lineStart));
    }
    if (typeof lineEnd === "number") {
      params.set("lineEnd", String(lineEnd));
    }
    const res = await getJson(`/source?${params.toString()}`);
    if (!res.ok) {
      if (res.status === 403) {
        return { status: "outside_repository" };
      }
      if (res.status === 404) {
        return { status: "not_in_snapshot" };
      }
      if (res.status === 409) {
        return { status: "content_changed" };
      }
      return { status: "error", message: `source failed: ${res.status}` };
    }
    return { status: "ok", slice: res.body as SourceSlice };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "network error" };
  }
}

/**
 * GET /api/v1/docs?for=<entityKey> → { docs: { node, body }[] }. Returns the
 * single linked ADR/doc body when the inspected entity has exactly one, else
 * `null` (the caller renders the fixed "No documented design decision found."
 * fallback string). Two or more linked docs is 08-07's fuller panel; here we
 * only inline a single unambiguous rationale.
 */
export async function fetchLinkedDoc(entityKey: string): Promise<LinkedDoc | null> {
  try {
    const res = await getJson(`/docs?for=${encodeURIComponent(entityKey)}`);
    if (!res.ok) {
      return null;
    }
    const body = res.body as { docs?: LinkedDoc[] };
    if (!Array.isArray(body.docs) || body.docs.length !== 1) {
      return null;
    }
    return body.docs[0] ?? null;
  } catch {
    return null;
  }
}
