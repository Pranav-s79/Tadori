import type { GraphFile, GraphNode } from "@tadori/core";
import { LOD_NODE_RESPONSE_CAPS } from "./lodBudgets.js";
import type { ServerPackageProjection } from "./packageProjection.js";

export type LodLevel = "package" | "file" | "symbol";

interface ScopeGraph {
  nodes: readonly GraphNode[];
  files: readonly GraphFile[];
}

export interface LodScope {
  level: LodLevel;
  allNodes: readonly GraphNode[];
  nodes: readonly GraphNode[];
  allKeys: ReadonlySet<string>;
  keys: ReadonlySet<string>;
  omittedNodeCount: number;
}

/** Canonical deterministic node/key set shared by nodes, edges, and layout. */
export function selectLodScope(
  graph: ScopeGraph,
  level: LodLevel,
  filters: { packageName?: string; file?: string } = {},
  packageProjection?: ServerPackageProjection
): LodScope {
  const filesByPath = new Map(graph.files.map((entry) => [entry.normalizedPath, entry]));
  const candidates = level === "package"
    ? (packageProjection?.nodes ?? graph.nodes.filter((node) => node.kind === "package"))
    : graph.nodes.filter((node) => {
        if (level === "file") {
          return node.kind === "file"
            && (filters.packageName === undefined
              || (node.file !== null && filesByPath.get(node.file)?.packageName === filters.packageName));
        }
        return node.kind !== "package" && node.kind !== "file"
          && (filters.file === undefined || node.file === filters.file);
      });
  const allNodes = [...candidates].sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const nodes = allNodes.slice(0, LOD_NODE_RESPONSE_CAPS[level]);
  return Object.freeze({
    level,
    allNodes: Object.freeze(allNodes),
    nodes: Object.freeze(nodes),
    allKeys: new Set(allNodes.map((node) => node.entityKey)),
    keys: new Set(nodes.map((node) => node.entityKey)),
    omittedNodeCount: allNodes.length - nodes.length
  });
}
