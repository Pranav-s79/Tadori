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
  const packageKeysByName = new Map<string, Set<string>>();
  for (const node of packageProjection?.nodes ?? []) {
    const keys = packageKeysByName.get(node.qualifiedName) ?? new Set<string>();
    keys.add(node.entityKey);
    packageKeysByName.set(node.qualifiedName, keys);
  }
  const representedPackagesByFile = new Map<string, Set<string>>();
  if (packageProjection !== undefined) {
    for (const node of graph.nodes) {
      if (node.file === null) continue;
      const owner = packageProjection.representativeByEntityKey.get(node.entityKey);
      if (owner === undefined) continue;
      const owners = representedPackagesByFile.get(node.file) ?? new Set<string>();
      owners.add(owner);
      representedPackagesByFile.set(node.file, owners);
    }
  }
  const requestedPackageKeys = filters.packageName === undefined
    ? undefined
    : packageKeysByName.get(filters.packageName);
  const candidates = level === "package"
    ? (packageProjection?.nodes ?? graph.nodes.filter((node) => node.kind === "package"))
    : graph.nodes.filter((node) => {
        if (level === "file") {
          return node.kind === "file"
            && (filters.packageName === undefined
              || (node.file !== null && (
                (requestedPackageKeys !== undefined
                  && [...(representedPackagesByFile.get(node.file) ?? [])]
                    .some((key) => requestedPackageKeys.has(key)))
                || (requestedPackageKeys === undefined
                  && filesByPath.get(node.file)?.packageName === filters.packageName)
              )));
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
