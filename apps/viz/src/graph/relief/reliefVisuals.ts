import type { ApiNode } from "../../api/types.ts";
import { atlasCapabilityForNode, atlasShapeForKind, type AtlasCapability, type AtlasNodeShape } from "../atlasVisuals.ts";

export interface ReliefNodeVisual {
  form: AtlasNodeShape;
  capability: AtlasCapability;
  footprintWidth: number;
  footprintDepth: number;
  formLabel: string;
}

const FORM_LABELS: Readonly<Record<AtlasNodeShape, string>> = {
  foundation: "stepped package foundation",
  slab: "inscribed file slab",
  pillar: "function pillar",
  stele: "method stele",
  colonnade: "class colonnade",
  gateway: "interface gateway",
  seal: "type seal",
  gatehouse: "route gatehouse",
  tablet: "documentation tablet",
  scaffold: "test scaffolding",
  outpost: "external dependency outpost",
  terminus: "unresolved circuit terminus"
};

const FOOTPRINTS: Readonly<Record<AtlasNodeShape, readonly [number, number]>> = {
  foundation: [34, 22],
  slab: [27, 17],
  pillar: [14, 11],
  stele: [15, 10],
  colonnade: [30, 16],
  gateway: [27, 14],
  seal: [18, 14],
  gatehouse: [31, 19],
  tablet: [19, 10],
  scaffold: [26, 18],
  outpost: [21, 17],
  terminus: [18, 14]
};

/** Exhaustive, language-neutral mapping from canonical node facts to built form. */
export function reliefVisualForNode(node: ApiNode): ReliefNodeVisual {
  const form = atlasShapeForKind(node.kind);
  const footprint = FOOTPRINTS[form];
  return {
    form,
    capability: atlasCapabilityForNode(node),
    footprintWidth: footprint[0],
    footprintDepth: footprint[1],
    formLabel: FORM_LABELS[form]
  };
}

export function reliefHeight(fanIn: number): number {
  const finiteFanIn = Number.isFinite(fanIn) ? Math.max(0, fanIn) : 0;
  return Math.min(40, 8 + Math.log2(finiteFanIn + 1) * 5);
}
