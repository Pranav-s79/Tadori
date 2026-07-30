import type { ApiEdge, ApiNode, LayoutPositionDto, RegionDto } from "../../api/types.ts";
import type { ReliefNodeVisual } from "./reliefVisuals.ts";
import { reliefHeight, reliefVisualForNode } from "./reliefVisuals.ts";

export const RELIEF_VIEWBOX = { width: 1000, height: 700, padding: 82 } as const;

export interface ReliefPoint { x: number; y: number }

export interface ReliefMark {
  node: ApiNode;
  point: ReliefPoint;
  height: number;
  depthOrder: number;
  visual: ReliefNodeVisual;
  packageKey: string | null;
  regionKey: string | null;
}

export interface ReliefTrace {
  edge: ApiEdge;
  from: ReliefPoint;
  to: ReliefPoint;
}

export interface ReliefPlate {
  region: RegionDto;
  memberPackageKeys: string[];
  center: ReliefPoint;
  points: [ReliefPoint, ReliefPoint, ReliefPoint, ReliefPoint];
}

export interface ReliefScene {
  marks: ReliefMark[];
  traces: ReliefTrace[];
  plates: ReliefPlate[];
  unassignedPackageCount: number;
}

export function projectReliefPoint(position: Pick<LayoutPositionDto, "x" | "y">): ReliefPoint {
  return { x: position.x - position.y, y: (position.x + position.y) / 2 };
}

function regionMembers(region: RegionDto): string[] {
  return [...new Set(region.memberPackageKeys
    ?? (region.packageEntityKey === undefined ? [] : [region.packageEntityKey]))].sort();
}

function fitPoints(raw: ReadonlyMap<string, ReliefPoint>): Map<string, ReliefPoint> {
  const values = [...raw.values()];
  if (values.length === 0) return new Map();
  const minX = Math.min(...values.map((point) => point.x));
  const maxX = Math.max(...values.map((point) => point.x));
  const minY = Math.min(...values.map((point) => point.y));
  const maxY = Math.max(...values.map((point) => point.y));
  const availableWidth = RELIEF_VIEWBOX.width - RELIEF_VIEWBOX.padding * 2;
  const availableHeight = RELIEF_VIEWBOX.height - RELIEF_VIEWBOX.padding * 2;
  const scale = Math.min(
    availableWidth / Math.max(1, maxX - minX),
    availableHeight / Math.max(1, maxY - minY)
  );
  const occupiedWidth = (maxX - minX) * scale;
  const occupiedHeight = (maxY - minY) * scale;
  const offsetX = (RELIEF_VIEWBOX.width - occupiedWidth) / 2;
  const offsetY = (RELIEF_VIEWBOX.height - occupiedHeight) / 2;
  return new Map([...raw].map(([key, point]) => [key, {
    x: offsetX + (point.x - minX) * scale,
    y: offsetY + (point.y - minY) * scale
  }]));
}

export function buildReliefScene(input: {
  nodes: readonly ApiNode[];
  edges: readonly ApiEdge[];
  positions: readonly LayoutPositionDto[];
  packageKeyByEntityKey: Readonly<Record<string, string>>;
  regions: readonly RegionDto[];
}): ReliefScene {
  const orderedRegions = [...input.regions].sort((left, right) => left.regionKey.localeCompare(right.regionKey));
  const positionByKey = new Map(input.positions.map((position) => [position.entityKey, position]));
  const rawPoints = new Map<string, ReliefPoint>();
  for (const node of input.nodes) {
    const position = positionByKey.get(node.entityKey);
    if (position !== undefined) rawPoints.set(node.entityKey, projectReliefPoint(position));
  }
  const points = fitPoints(rawPoints);
  const regionByPackageKey = new Map<string, string>();
  for (const region of orderedRegions) {
    for (const packageKey of regionMembers(region)) {
      if (!regionByPackageKey.has(packageKey)) regionByPackageKey.set(packageKey, region.regionKey);
    }
  }
  const marks = input.nodes.flatMap((node) => {
    const point = points.get(node.entityKey);
    if (point === undefined) return [];
    const packageKey = input.packageKeyByEntityKey[node.entityKey] ?? (node.kind === "package" ? node.entityKey : null);
    return [{
      node,
      point,
      height: reliefHeight(node.fanIn),
      depthOrder: point.y,
      visual: reliefVisualForNode(node),
      packageKey,
      regionKey: packageKey === null ? null : regionByPackageKey.get(packageKey) ?? null
    } satisfies ReliefMark];
  }).sort((left, right) => left.depthOrder - right.depthOrder || left.node.entityKey.localeCompare(right.node.entityKey));
  const traces = input.edges.flatMap((edge) => {
    const from = points.get(edge.srcEntityKey);
    const to = points.get(edge.dstEntityKey);
    return from === undefined || to === undefined ? [] : [{ edge, from, to }];
  }).sort((left, right) => left.edge.entityKey.localeCompare(right.edge.entityKey));
  const plates = orderedRegions.flatMap((region) => {
    const members = regionMembers(region);
    const memberPoints = members.flatMap((key) => {
      const point = points.get(key);
      return point === undefined ? [] : [point];
    });
    if (memberPoints.length === 0) return [];
    const minX = Math.min(...memberPoints.map((point) => point.x)) - 48;
    const maxX = Math.max(...memberPoints.map((point) => point.x)) + 48;
    const minY = Math.min(...memberPoints.map((point) => point.y)) - 34;
    const maxY = Math.max(...memberPoints.map((point) => point.y)) + 34;
    return [{
      region,
      memberPackageKeys: members,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      points: [
        { x: (minX + maxX) / 2, y: minY },
        { x: maxX, y: (minY + maxY) / 2 },
        { x: (minX + maxX) / 2, y: maxY },
        { x: minX, y: (minY + maxY) / 2 }
      ]
    } satisfies ReliefPlate];
  });
  const packageKeys = new Set(input.nodes.filter((node) => node.kind === "package").map((node) => node.entityKey));
  const unassignedPackageCount = [...packageKeys].filter((key) => !regionByPackageKey.has(key)).length;
  return { marks, traces, plates, unassignedPackageCount };
}
