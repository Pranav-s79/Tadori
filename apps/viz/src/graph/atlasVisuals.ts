import type {
  ApiNode,
  Confidence,
  ExtractionCapability,
  NodeKind,
  Origin,
  Resolution
} from "../api/types.ts";
import type { AggregatedProvenance } from "../api/types.ts";
import { edgeVisualStyle } from "../legend.ts";

export type AtlasNodeShape =
  | "foundation"
  | "slab"
  | "pillar"
  | "stele"
  | "colonnade"
  | "gateway"
  | "seal"
  | "gatehouse"
  | "tablet"
  | "scaffold"
  | "outpost"
  | "terminus";

export type AtlasCapability = ExtractionCapability | "mixed" | "unknown";
export type AtlasEdgePattern = "solid" | "dashed" | "dotted";

export interface AtlasNodeVisual {
  shape: AtlasNodeShape;
  capability: AtlasCapability;
  type: string;
  color: string;
  size: number;
  formLabel: string;
  capabilityLabel: string;
}

export interface AtlasEdgeVisual {
  type: AtlasEdgePattern;
  color: string;
  size: number;
  provenanceLabel: string;
}

const CAPABILITY_COLORS: Readonly<Record<AtlasCapability, string>> = {
  semantic: "#b88d55",
  structural: "#738276",
  repository: "#a98e55",
  mixed: "#817688",
  unknown: "#8f8777"
};

const SHAPE_LABELS: Readonly<Record<AtlasNodeShape, string>> = {
  foundation: "package foundation",
  slab: "file slab",
  pillar: "function pillar",
  stele: "method stele",
  colonnade: "class colonnade",
  gateway: "interface gateway",
  seal: "type seal",
  gatehouse: "route gatehouse",
  tablet: "documentation tablet",
  scaffold: "test scaffold",
  outpost: "external dependency outpost",
  terminus: "unresolved terminus"
};

const CAPABILITY_LABELS: Readonly<Record<AtlasCapability, string>> = {
  semantic: "semantic",
  structural: "structural",
  repository: "repository only",
  mixed: "mixed capability",
  unknown: "capability not attributed"
};

export function atlasShapeForKind(kind: NodeKind): AtlasNodeShape {
  if (kind === "package") return "foundation";
  if (kind === "file") return "slab";
  if (kind === "function") return "pillar";
  if (kind === "method") return "stele";
  if (kind === "class") return "colonnade";
  if (kind === "interface") return "gateway";
  if (kind === "type") return "seal";
  if (kind === "route") return "gatehouse";
  if (kind === "adr" || kind === "doc_section") return "tablet";
  if (kind === "test") return "scaffold";
  if (kind === "external_dep") return "outpost";
  if (kind === "unresolved") return "terminus";
  return assertNever(kind);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported graph node kind: ${String(value)}`);
}

export function atlasCapabilityForNode(
  node: Pick<ApiNode, "provenance" | "aggregateCapabilities">
): AtlasCapability {
  if (node.provenance?.capability !== undefined) return node.provenance.capability;
  const aggregate = [...new Set(node.aggregateCapabilities ?? [])];
  if (aggregate.length === 1) return aggregate[0] ?? "unknown";
  if (aggregate.length > 1) return "mixed";
  return "unknown";
}

function atlasNodeSize(kind: NodeKind, fanIn: number, selected: boolean): number {
  const kindBase = kind === "package" ? 13 : kind === "file" ? 11 : 9;
  const fanInScale = Math.min(6, Math.log2(Math.max(0, fanIn) + 1) * 1.35);
  return kindBase + fanInScale + (selected ? 3 : 0);
}

export function atlasNodeVisual(
  node: Pick<ApiNode, "kind" | "fanIn" | "provenance" | "aggregateCapabilities">,
  selected = false
): AtlasNodeVisual {
  const shape = atlasShapeForKind(node.kind);
  const capability = atlasCapabilityForNode(node);
  return {
    shape,
    capability,
    type: `atlas-${shape}-${capability}`,
    color: selected ? "#315f8c" : CAPABILITY_COLORS[capability],
    size: atlasNodeSize(node.kind, node.fanIn, selected),
    formLabel: SHAPE_LABELS[shape],
    capabilityLabel: CAPABILITY_LABELS[capability]
  };
}

export function atlasEdgeVisual(
  edge: {
    origin?: Origin;
    confidence?: Confidence;
    resolution?: Resolution;
    aggregateProvenance?: readonly AggregatedProvenance[];
  }
): AtlasEdgeVisual {
  const buckets = edge.aggregateProvenance !== undefined && edge.aggregateProvenance.length > 0
    ? edge.aggregateProvenance : (edge.origin !== undefined
    && edge.confidence !== undefined && edge.resolution !== undefined
    ? [{ origin: edge.origin, confidence: edge.confidence, resolution: edge.resolution, count: 1 }]
    : []);
  if (buckets.length === 0) {
    return { type: "dotted", color: "#9a968c", size: 1.25, provenanceLabel: "provenance not attributed" };
  }
  const styles = buckets.map((bucket) => edgeVisualStyle(bucket.origin, bucket.confidence, bucket.resolution));
  const type: AtlasEdgePattern = styles.some((style) => style.dash?.[0] === 1)
    ? "dotted"
    : styles.some((style) => style.dash !== null) ? "dashed" : "solid";
  return {
    type,
    color: styles.every((style) => style.muted) ? "#9a968c" : "#7c4d27",
    size: type === "dotted" ? 1.25 : 1.5,
    provenanceLabel: buckets.map((bucket) =>
      `${bucket.count} ${bucket.confidence}/${bucket.resolution}/${bucket.origin}`
    ).join(", ")
  };
}
