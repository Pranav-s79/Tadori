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
  | "tile"
  | "marker"
  | "tablet"
  | "scaffold"
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
  foundation: "foundation block",
  tile: "inscribed tile",
  marker: "carved marker",
  tablet: "documentation tablet",
  scaffold: "test scaffold",
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
  if (kind === "file") return "tile";
  if (kind === "adr" || kind === "doc_section") return "tablet";
  if (kind === "test") return "scaffold";
  if (kind === "unresolved") return "terminus";
  return "marker";
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
  const kindBase = kind === "package" ? 8 : kind === "file" ? 6 : 4.5;
  const fanInScale = Math.min(7, Math.log2(Math.max(0, fanIn) + 1) * 1.6);
  return kindBase + fanInScale + (selected ? 2.5 : 0);
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
