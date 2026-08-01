import { useEffect, useMemo, useRef, type ReactElement } from "react";
import type { RegionProjectionDto } from "../../api/types.ts";
import type { SearchFilters } from "../../features/search/filterState.ts";
import { edgeMatchesFilters, nodeMatchesFilters } from "../../features/search/filterState.ts";
import { atlasEdgeVisual } from "../atlasVisuals.ts";
import type { RenderedGraphSnapshot, StoryMapEmphasis, ViewportPosition } from "../PackageMapCanvas.tsx";
import { buildReliefScene, RELIEF_VIEWBOX, type ReliefMark } from "./projectRelief.ts";

const REGION_TOKENS = ["ochre", "green", "clay", "violet", "gold", "blue"] as const;

export interface ReliefStageProps {
  graph: RenderedGraphSnapshot;
  regions: RegionProjectionDto | null;
  regionsLoading: boolean;
  regionsError: Error | null;
  filters: SearchFilters;
  storyEmphasis: StoryMapEmphasis | null;
  onInspect(entityKey: string): void;
  onViewportPositionsChange?(positions: ReadonlyMap<string, ViewportPosition>): void;
}

function regionToken(index: number): string {
  return REGION_TOKENS[index % REGION_TOKENS.length] ?? "ochre";
}

function markLabel(mark: ReliefMark, regionAttribution: string | null): string {
  return [
    mark.node.displayName,
    mark.visual.formLabel,
    regionAttribution ?? "region not attributed",
    `fan-in ${String(mark.node.fanIn)}`,
    mark.visual.capability === "unknown" ? "capability not attributed" : `${mark.visual.capability} capability`
  ].join(", ");
}

function structurePoints(mark: ReliefMark) {
  const { x, y } = mark.point;
  const width = mark.visual.footprintWidth;
  const depth = mark.visual.footprintDepth;
  const topY = y - mark.height;
  return {
    top: `${x},${topY - depth / 2} ${x + width / 2},${topY} ${x},${topY + depth / 2} ${x - width / 2},${topY}`,
    left: `${x - width / 2},${topY} ${x},${topY + depth / 2} ${x},${y + depth / 2} ${x - width / 2},${y}`,
    right: `${x},${topY + depth / 2} ${x + width / 2},${topY} ${x + width / 2},${y} ${x},${y + depth / 2}`
  };
}

/** Fixed-projection, graph-backed archaeological relief; never the default renderer. */
export function ReliefStage({
  graph,
  regions,
  regionsLoading,
  regionsError,
  filters,
  storyEmphasis,
  onInspect,
  onViewportPositionsChange
}: ReliefStageProps): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null);
  const scene = useMemo(() => buildReliefScene({
    nodes: graph.nodes,
    edges: graph.edges,
    positions: graph.positions,
    packageKeyByEntityKey: graph.packageKeyByEntityKey,
    regions: regions?.regions ?? []
  }), [graph, regions]);
  const regionAttributionByKey = useMemo(
    () => new Map((regions?.regions ?? []).map((region) => [
      region.regionKey,
      `${region.label} region, ${region.role.status.replaceAll("_", " ")} role`
    ])),
    [regions]
  );
  const storyNodes = useMemo(() => new Set(storyEmphasis?.pathEntityKeys ?? []), [storyEmphasis]);
  const storyTransitions = useMemo(() => new Set((storyEmphasis?.transitions ?? []).flatMap((transition) =>
    transition.toEntityKey === null ? [] : [`${transition.fromEntityKey}\u0000${transition.relation}\u0000${transition.toEntityKey}`]
  )), [storyEmphasis]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || onViewportPositionsChange === undefined) return;
    const publish = (): void => {
      const bounds = stage.getBoundingClientRect();
      onViewportPositionsChange(new Map(scene.marks.map((mark) => [mark.node.entityKey, {
        x: mark.point.x / RELIEF_VIEWBOX.width * bounds.width,
        y: mark.point.y / RELIEF_VIEWBOX.height * bounds.height
      }])));
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(publish);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [onViewportPositionsChange, scene.marks]);

  return (
    <div ref={stageRef} className="relief-stage" role="region" aria-label="Repository archaeological relief">
      <svg
        className="relief-scene"
        viewBox={`0 0 ${String(RELIEF_VIEWBOX.width)} ${String(RELIEF_VIEWBOX.height)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <pattern id="relief-structural" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M-2 2L2-2M0 8L8 0M6 10L10 6" />
          </pattern>
          <pattern id="relief-repository" width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" />
          </pattern>
        </defs>
        <g className="relief-plates">
          {scene.plates.map((plate, index) => (
            <g key={plate.region.regionKey} data-region-token={regionToken(index)}>
              <polygon points={plate.points.map((point) => `${String(point.x)},${String(point.y)}`).join(" ")} />
              <text x={plate.center.x} y={plate.points[0].y - 10}>{plate.region.label}</text>
              <text className="relief-region-role" x={plate.center.x} y={plate.points[0].y + 7}>
                {plate.region.role.text ?? "Role derived from graph only"}
              </text>
            </g>
          ))}
        </g>
        <g className="relief-traces">
          {scene.traces.map((trace) => {
            const visual = atlasEdgeVisual(trace.edge);
            const active = storyTransitions.has(`${trace.edge.srcEntityKey}\u0000${trace.edge.relation}\u0000${trace.edge.dstEntityKey}`);
            return (
              <line
                key={trace.edge.entityKey}
                x1={trace.from.x}
                y1={trace.from.y}
                x2={trace.to.x}
                y2={trace.to.y}
                stroke={visual.color}
                data-pattern={visual.type}
                data-story-active={active ? "true" : "false"}
                data-filter-dimmed={edgeMatchesFilters(trace.edge, filters) ? "false" : "true"}
              />
            );
          })}
        </g>
        <g className="relief-structures">
          {scene.marks.map((mark) => {
            const faces = structurePoints(mark);
            const active = storyNodes.has(mark.node.entityKey);
            return (
              <g
                key={mark.node.entityKey}
                data-form={mark.visual.form}
                data-capability={mark.visual.capability}
                data-selected={graph.selectedEntityKey === mark.node.entityKey ? "true" : "false"}
                data-story-active={active ? "true" : "false"}
                data-story-dimmed={storyEmphasis !== null && !active ? "true" : "false"}
                data-filter-dimmed={nodeMatchesFilters(mark.node, filters) ? "false" : "true"}
              >
                <polygon className="relief-face-left" points={faces.left} />
                <polygon className="relief-face-right" points={faces.right} />
                <polygon className="relief-face-top" points={faces.top} />
                <path className="relief-form-carving" d={`M ${String(mark.point.x - mark.visual.footprintWidth / 4)} ${String(mark.point.y - mark.height)} L ${String(mark.point.x + mark.visual.footprintWidth / 4)} ${String(mark.point.y - mark.height)}`} />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="relief-hit-targets">
        {scene.marks.map((mark) => (
          <button
            key={mark.node.entityKey}
            type="button"
            className="relief-hit-target"
            data-entity-key={mark.node.entityKey}
            data-selected={graph.selectedEntityKey === mark.node.entityKey ? "true" : "false"}
            style={{
              left: `${String(mark.point.x / RELIEF_VIEWBOX.width * 100)}%`,
              top: `${String((mark.point.y - mark.height) / RELIEF_VIEWBOX.height * 100)}%`
            }}
            aria-label={markLabel(mark, mark.regionKey === null ? null : regionAttributionByKey.get(mark.regionKey) ?? null)}
            onClick={() => onInspect(mark.node.entityKey)}
          >
            <span>{mark.node.displayName}</span>
          </button>
        ))}
      </div>

      <aside className="relief-metric-card" aria-label="Relief encoding">
        <strong>Relief · height: fan-in</strong>
        <span>{`${String(scene.marks.length)} structures · ${String(scene.traces.length)} traces`}</span>
        {regionsLoading && <span>Loading attributed regions…</span>}
        {regionsError !== null && <span>Region attribution unavailable; no districts inferred.</span>}
        {!regionsLoading && regionsError === null && regions !== null && (
          <span>{`${String(regions.accounting.regionCount)} attributed regions · ${String(regions.accounting.unownedEntityCount)} unowned entities`}</span>
        )}
        {scene.unassignedPackageCount > 0 && <span>{`${String(scene.unassignedPackageCount)} visible packages not assigned to a region`}</span>}
      </aside>
    </div>
  );
}
