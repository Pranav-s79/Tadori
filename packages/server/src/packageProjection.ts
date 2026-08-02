import type {
  ExtractionCapability,
  ExtractionDerivation,
  GraphEdge,
  GraphNode
} from "@tadori/core";
import { sha256Hex } from "@tadori/core";

interface ProjectionGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export interface PackageNodeAggregates {
  aggregateLanguages: string[];
  aggregateCapabilities: ExtractionCapability[];
  aggregateDerivations: ExtractionDerivation[];
}

export interface ProjectedPackageEdge {
  entityKey: string;
  srcPackageKey: string;
  dstPackageKey: string;
  relation: GraphEdge["relation"];
  sourceEdges: readonly GraphEdge[];
  projectionKind: "package_aggregate";
}

export interface PackageProjectionAccounting {
  candidateEdgeCount: number;
  projectedEdgeCount: number;
  omittedEdgeCount: number;
  ambiguousEntityCount: number;
  unownedEntityCount: number;
}

export interface ServerPackageProjection {
  nodes: GraphNode[];
  edges: ProjectedPackageEdge[];
  representativeByEntityKey: ReadonlyMap<string, string>;
  descendantPackageKeysByPackageKey: ReadonlyMap<string, ReadonlySet<string>>;
  ambiguousEntityKeys: ReadonlySet<string>;
  unownedEntityKeys: ReadonlySet<string>;
  aggregatesByPackageKey: ReadonlyMap<string, PackageNodeAggregates>;
  accounting: PackageProjectionAccounting;
}

const projectionCache = new WeakMap<object, ServerPackageProjection>();

function readonlyMap<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  return Object.freeze({
    get size() { return source.size; },
    get: (key: K) => source.get(key),
    has: (key: K) => source.has(key),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      const view = readonlyMap(source);
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    entries: () => source.entries(),
    keys: () => source.keys(),
    values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator]()
  });
}

function readonlySet<T>(source: Set<T>): ReadonlySet<T> {
  return Object.freeze({
    get size() { return source.size; },
    has: (value: T) => source.has(value),
    forEach: (callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown) => {
      const view = readonlySet(source);
      source.forEach((value) => callback.call(thisArg, value, value, view));
    },
    entries: () => source.entries(),
    keys: () => source.keys(),
    values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator]()
  });
}

function immutableSourceEdge(edge: GraphEdge): GraphEdge {
  return Object.freeze({
    ...edge,
    evidence: Object.freeze([...edge.evidence]),
    ...(edge.provenance === undefined ? {} : { provenance: Object.freeze({ ...edge.provenance }) })
  }) as GraphEdge;
}

/** One immutable projection per captured snapshot graph object. */
export function getPackageProjection(graph: ProjectionGraph): ServerPackageProjection {
  const cached = projectionCache.get(graph);
  if (cached !== undefined) return cached;
  const projection = projectSnapshotPackages(graph);
  projectionCache.set(graph, projection);
  return projection;
}

/**
 * Deterministic package projection over the canonical snapshot. Ownership is
 * proven only by transitive `contains` edges. Shared descendants are marked
 * ambiguous and left unowned; names and paths never participate.
 */
export function projectSnapshotPackages(graph: ProjectionGraph): ServerPackageProjection {
  const packages = graph.nodes
    .filter((node) => node.kind === "package")
    .sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.relation !== "contains") continue;
    const bucket = children.get(edge.srcEntityKey) ?? [];
    bucket.push(edge.dstEntityKey);
    children.set(edge.srcEntityKey, bucket);
  }
  for (const bucket of children.values()) bucket.sort();

  const ownershipCandidates = new Map<string, { distance: number; packages: Set<string> }>();
  for (const packageNode of packages) {
    const pending: Array<{ key: string; distance: number }> = [
      { key: packageNode.entityKey, distance: 0 }
    ];
    const visitedAt = new Map<string, number>();
    let pendingIndex = 0;
    while (pendingIndex < pending.length) {
      const current = pending[pendingIndex++];
      if (current === undefined) continue;
      const priorDistance = visitedAt.get(current.key);
      if (priorDistance !== undefined && priorDistance <= current.distance) continue;
      visitedAt.set(current.key, current.distance);

      const candidate = ownershipCandidates.get(current.key);
      if (candidate === undefined || current.distance < candidate.distance) {
        ownershipCandidates.set(current.key, {
          distance: current.distance,
          packages: new Set([packageNode.entityKey])
        });
      } else if (current.distance === candidate.distance) {
        candidate.packages.add(packageNode.entityKey);
      }
      for (const child of children.get(current.key) ?? []) {
        pending.push({ key: child, distance: current.distance + 1 });
      }
    }
  }
  const owners = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [key, candidate] of ownershipCandidates) {
    if (candidate.packages.size === 1) {
      const owner = candidate.packages.values().next().value as string | undefined;
      if (owner !== undefined) owners.set(key, owner);
    } else {
      ambiguous.add(key);
    }
  }

  const nodeByKey = new Map(graph.nodes.map((node) => [node.entityKey, node]));
  const ownedNodesByPackage = new Map<string, GraphNode[]>();
  for (const [key, owner] of owners) {
    const ownedNode = nodeByKey.get(key);
    if (ownedNode === undefined) continue;
    const bucket = ownedNodesByPackage.get(owner) ?? [];
    bucket.push(ownedNode);
    ownedNodesByPackage.set(owner, bucket);
  }
  const aggregates = new Map<string, PackageNodeAggregates>();
  const descendantPackageKeysByPackageKey = new Map<string, ReadonlySet<string>>();
  for (const packageNode of packages) {
    const includedPackages = new Set([packageNode.entityKey]);
    const pendingPackages = [packageNode.entityKey];
    for (let index = 0; index < pendingPackages.length; index += 1) {
      const current = pendingPackages[index];
      if (current === undefined) continue;
      for (const child of children.get(current) ?? []) {
        if (nodeByKey.get(child)?.kind !== "package" || includedPackages.has(child)) continue;
        includedPackages.add(child);
        pendingPackages.push(child);
      }
    }
    descendantPackageKeysByPackageKey.set(packageNode.entityKey, readonlySet(includedPackages));
    const ownedNodes = [...includedPackages].flatMap((key) => ownedNodesByPackage.get(key) ?? []);
    aggregates.set(packageNode.entityKey, {
      aggregateLanguages: [...new Set(ownedNodes.flatMap((node) => node.language ? [node.language] : []))].sort(),
      aggregateCapabilities: [...new Set(ownedNodes.flatMap((node) =>
        node.provenance ? [node.provenance.capability] : []
      ))].sort(),
      aggregateDerivations: [...new Set(ownedNodes.flatMap((node) =>
        node.provenance ? [node.provenance.derivation] : []
      ))].sort()
    });
  }

  const groupedEdges = new Map<string, ProjectedPackageEdge>();
  let omittedEdgeCount = 0;
  for (const edge of graph.edges) {
    const source = owners.get(edge.srcEntityKey);
    const target = owners.get(edge.dstEntityKey);
    if (source === undefined || target === undefined || source === target) {
      omittedEdgeCount += 1;
      continue;
    }
    const groupKey = `${source}\0${target}\0${edge.relation}`;
    const existing = groupedEdges.get(groupKey);
    if (existing === undefined) {
      groupedEdges.set(groupKey, {
        entityKey: `package-projection:${sha256Hex(groupKey)}`,
        srcPackageKey: source,
        dstPackageKey: target,
        relation: edge.relation,
        projectionKind: "package_aggregate",
        sourceEdges: [immutableSourceEdge(edge)]
      });
    } else {
      (existing.sourceEdges as GraphEdge[]).push(immutableSourceEdge(edge));
    }
  }
  const edges = [...groupedEdges.values()];
  for (const edge of edges) {
    (edge.sourceEdges as GraphEdge[]).sort((left, right) => left.entityKey.localeCompare(right.entityKey));
    Object.freeze(edge.sourceEdges);
    Object.freeze(edge);
  }
  edges.sort((left, right) => left.entityKey.localeCompare(right.entityKey));

  const ownedOrAmbiguous = new Set([...owners.keys(), ...ambiguous]);
  const unowned = new Set(
    graph.nodes
      .filter((node) => !ownedOrAmbiguous.has(node.entityKey))
      .map((node) => node.entityKey)
  );
  const unownedEntityCount = graph.nodes.reduce(
    (count, node) => count + (ownedOrAmbiguous.has(node.entityKey) ? 0 : 1),
    0
  );
  const projection: ServerPackageProjection = {
    nodes: Object.freeze(packages) as unknown as GraphNode[],
    edges: Object.freeze(edges) as unknown as ProjectedPackageEdge[],
    representativeByEntityKey: readonlyMap(owners),
    descendantPackageKeysByPackageKey: readonlyMap(descendantPackageKeysByPackageKey),
    ambiguousEntityKeys: readonlySet(ambiguous),
    unownedEntityKeys: readonlySet(unowned),
    aggregatesByPackageKey: readonlyMap(aggregates),
    accounting: {
      candidateEdgeCount: graph.edges.length,
      projectedEdgeCount: edges.length,
      omittedEdgeCount,
      ambiguousEntityCount: ambiguous.size,
      unownedEntityCount
    }
  };
  Object.freeze(projection.accounting);
  return Object.freeze(projection);
}
