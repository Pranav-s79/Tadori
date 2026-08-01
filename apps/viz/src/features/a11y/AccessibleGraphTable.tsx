import { useMemo, type ReactElement } from "react";
import type { ApiEdge, ApiNode } from "../../api/types.ts";
import { applyFiltersToGraph, defaultFilters, type SearchFilters } from "../search/filterState.ts";
import type { StoryMapEmphasis } from "../../graph/PackageMapCanvas.tsx";
import { atlasNodeVisual } from "../../graph/atlasVisuals.ts";

interface AccessibleGraphTableProps {
  nodes: readonly ApiNode[];
  edges: readonly ApiEdge[];
  /** Open a node in the existing inspection panel. */
  onInspect?: (entityKey: string) => void;
  filters?: SearchFilters;
  /** Evidence-backed Story emphasis, when a Story has been selected. */
  storyEmphasis?: StoryMapEmphasis | null;
}

export function tableStoryState(entityKey: string, storyEmphasis: StoryMapEmphasis | null): string {
  if (storyEmphasis === null) return "no active story";
  if (storyEmphasis.unresolvedFromEntityKey === entityKey) return "active unresolved termination source";
  if (storyEmphasis.activeEntityKey === entityKey) return "active story step";
  if (storyEmphasis.pathEntityKeys.includes(entityKey)) return "on active story path";
  return "outside active story path";
}

/**
 * The WCAG-AA, non-canvas accessible alternative to the Sigma graph (08-11).
 * The Sigma canvas is inaccessible to screen readers and keyboard-only users;
 * this renders the SAME nodes/edges as a real semantic `<table>` so the graph's
 * content — every node with its kind, name, file, fan-in, and outgoing-edge
 * summary — is fully reachable by assistive tech and by keyboard alone. It
 * carries the same provenance/data fields as the canvas view (no information is
 * available only visually). Rows link into the same inspection panel.
 */
export function AccessibleGraphTable({
  nodes,
  edges,
  onInspect,
  filters = defaultFilters(),
  storyEmphasis = null
}: AccessibleGraphTableProps): ReactElement {
  const filtered = useMemo(() => applyFiltersToGraph({ nodes: [...nodes], edges: [...edges] }, filters), [nodes, edges, filters]);
  const nodeEmphasis = useMemo(() => new Map(filtered.nodes.map((item) => [item.node.entityKey, item.visible])), [filtered]);
  const edgeEmphasis = useMemo(() => new Map(filtered.edges.map((item) => [item.edge.entityKey, item.visible])), [filtered]);
  // Per-node outgoing-edge summary: "relation → N" grouped, so a screen reader
  // hears "calls → 3, imports → 1" instead of navigating an invisible canvas.
  const outSummaryByNode = useMemo(() => {
    const byNode = new Map<string, Map<string, number>>();
    for (const edge of edges) {
      const relations = byNode.get(edge.srcEntityKey) ?? new Map<string, number>();
      relations.set(edge.relation, (relations.get(edge.relation) ?? 0) + (edge.aggregateCount ?? 1));
      byNode.set(edge.srcEntityKey, relations);
    }
    const text = new Map<string, string>();
    for (const [key, relations] of byNode) {
      text.set(
        key,
        [...relations.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([relation, count]) => `${relation} → ${count}`)
          .join(", ")
      );
    }
    return text;
  }, [edges]);
  const outProvenanceByNode = useMemo(() => {
    const byNode = new Map<string, string[]>();
    for (const edge of edges) {
      const entries = byNode.get(edge.srcEntityKey) ?? [];
      const provenance = edge.aggregateProvenance?.map((bucket) =>
        `${bucket.count} ${bucket.confidence}, ${bucket.resolution}, ${bucket.origin}`
      ).join("; ") ?? (edge.origin !== undefined && edge.confidence !== undefined && edge.resolution !== undefined
        ? `${edge.confidence}, ${edge.resolution}, ${edge.origin}` : "not attributed");
      entries.push(`${edge.relation}: ${provenance}`);
      byNode.set(edge.srcEntityKey, entries);
    }
    return new Map([...byNode].map(([key, entries]) => [key, entries.sort().join("; ")]));
  }, [edges]);

  return (
    <section className="a11y-graph" aria-label="Accessible graph table">
      <h2>Graph (accessible table view)</h2>
      <p className="a11y-graph-caption">
        A non-visual, keyboard-navigable alternative to the graph canvas — the same nodes and
        relations as the visual map.
      </p>
      {nodes.length === 0 ? (
        <p role="status">No nodes in this snapshot.</p>
      ) : (
        <table>
          <caption className="a11y-graph-table-caption">
            {`${nodes.length} node${nodes.length === 1 ? "" : "s"}`}
          </caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Archaeological form</th>
              <th scope="col">Material</th>
              <th scope="col">Language</th>
              <th scope="col">Capability</th>
              <th scope="col">Derivation</th>
              <th scope="col">File</th>
              <th scope="col">Fan-in</th>
              <th scope="col">Outgoing relations</th>
              <th scope="col">Outgoing provenance</th>
              <th scope="col">Filter emphasis</th>
              <th scope="col">Story state</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => {
              const visual = atlasNodeVisual(node);
              return (
              <tr key={node.entityKey} data-filter-dimmed={nodeEmphasis.get(node.entityKey) === false ? "true" : "false"}>
                <th scope="row">
                  <button
                    type="button"
                    data-entity-key={node.entityKey}
                    onClick={() => onInspect?.(node.entityKey)}
                  >
                    {node.displayName}
                  </button>
                </th>
                <td>{node.kind}</td>
                <td>{visual.formLabel}</td>
                <td>{`${visual.materialLabel}; ${visual.capabilityLabel}`}</td>
                <td>{node.language ?? node.aggregateLanguages?.join(", ") ?? "not attributed"}</td>
                <td>{node.provenance?.capability ?? node.aggregateCapabilities?.join(", ") ?? "not attributed"}</td>
                <td>{node.provenance?.derivation ?? node.aggregateDerivations?.join(", ") ?? "not attributed"}</td>
                <td>{node.file ?? "—"}</td>
                <td>{node.fanIn}</td>
                <td>
                  {outSummaryByNode.get(node.entityKey) ?? "none"}
                  {edges.some((edge) => edge.srcEntityKey === node.entityKey && edgeEmphasis.get(edge.entityKey) === false) ? " (some relations dimmed by filters)" : ""}
                </td>
                <td>{outProvenanceByNode.get(node.entityKey) ?? "none"}</td>
                <td>{nodeEmphasis.get(node.entityKey) === false ? "dimmed by filters" : "emphasized"}</td>
                <td>{tableStoryState(node.entityKey, storyEmphasis)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
