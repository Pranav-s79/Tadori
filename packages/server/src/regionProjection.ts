import {
  NODE_KINDS,
  sha256Hex,
  type Evidence,
  type GraphEdge,
  type GraphNode,
  type GraphProject,
  type NodeKind
} from "@tadori/core";
import { getPackageProjection } from "./packageProjection.js";
import type {
  RegionBasisDto,
  RegionCountsDto,
  RegionDto,
  RegionProjectionDto,
  RegionRoleDto
} from "./types.js";

interface RegionProjectionGraph {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  projects?: readonly GraphProject[];
}

interface RegionSeed {
  regionKey: string;
  label: string;
  project: GraphProject | null;
  packageKeys: string[];
}

const EVIDENCE_LIMIT = 25;
const regionProjectionCache = new WeakMap<object, RegionProjectionDto>();

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function emptyKindCounts(): Record<NodeKind, number> {
  return Object.fromEntries(NODE_KINDS.map((kind) => [kind, 0])) as Record<NodeKind, number>;
}

function evidenceKey(evidence: Evidence): string {
  return [
    evidence.file,
    evidence.kind,
    evidence.lineStart,
    evidence.lineEnd,
    evidence.columnStart ?? "",
    evidence.columnEnd ?? "",
    evidence.commitSha ?? "",
    evidence.excerptHash ?? ""
  ].join("\0");
}

function boundedEvidence(items: readonly Evidence[]): Pick<RegionRoleDto, "evidence" | "evidenceOmittedCount"> {
  const unique = new Map<string, Evidence>();
  for (const item of items) unique.set(evidenceKey(item), item);
  const ordered = [...unique.entries()]
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([, item]) => ({ ...item }));
  return {
    evidence: ordered.slice(0, EVIDENCE_LIMIT),
    evidenceOmittedCount: Math.max(0, ordered.length - EVIDENCE_LIMIT)
  };
}

function rootDepth(root: string): number {
  return root === "." ? 0 : root.split("/").length;
}

function containsPath(root: string, file: string): boolean {
  return root === "." || file === root || file.startsWith(`${root}/`);
}

function projectForPackage(
  packageKey: string,
  graph: RegionProjectionGraph,
  projects: readonly GraphProject[],
  ownerByEntityKey: ReadonlyMap<string, string>
): GraphProject | undefined {
  const files = new Set(graph.nodes.flatMap((node) => {
    if (ownerByEntityKey.get(node.entityKey) !== packageKey) return [];
    return [
      ...(node.file === null ? [] : [node.file]),
      ...(node.entityKey === packageKey ? node.evidence.map((item) => item.file) : [])
    ];
  }));
  return projects
    .filter((project) => [...files].some((file) => containsPath(project.root, file)))
    .sort((left, right) =>
      rootDepth(right.root) - rootDepth(left.root)
      || compareKeys(left.projectId, right.projectId)
    )[0];
}

function graphDerivedRole(): RegionRoleDto {
  return {
    text: null,
    status: "derived_from_graph",
    evidence: [],
    evidenceOmittedCount: 0
  };
}

function freezeProjection(projection: RegionProjectionDto): RegionProjectionDto {
  for (const region of projection.regions) {
    Object.freeze(region.role.evidence);
    Object.freeze(region.role);
    Object.freeze(region.basis.evidence);
    Object.freeze(region.basis);
    Object.freeze(region.counts.byKind);
    Object.freeze(region.counts);
    Object.freeze(region.memberPackageKeys);
    Object.freeze(region.languages);
    Object.freeze(region.capabilities);
    Object.freeze(region.derivations);
    Object.freeze(region);
  }
  Object.freeze(projection.regions);
  Object.freeze(projection.accounting);
  return Object.freeze(projection);
}

/**
 * Deterministic repository-region projection. Each canonical package is
 * assigned as a unit to the deepest matching extractor-discovered project
 * root. Unmatched packages remain separate containment regions. Project paths
 * establish boundaries only; they never infer semantic responsibilities.
 */
export function projectSnapshotRegions(graph: RegionProjectionGraph): RegionProjectionDto {
  const packages = getPackageProjection(graph);
  const nodeByKey = new Map(graph.nodes.map((node) => [node.entityKey, node]));
  const projects = [...(graph.projects ?? [])].sort((left, right) =>
    compareKeys(left.projectId, right.projectId)
  );
  const seedByKey = new Map<string, RegionSeed>();
  const regionByPackageKey = new Map<string, string>();

  for (const packageNode of packages.nodes) {
    const project = projectForPackage(
      packageNode.entityKey,
      graph,
      projects,
      packages.representativeByEntityKey
    );
    const regionKey = project === undefined
      ? sha256Hex(`region|package_containment|${packageNode.entityKey}`)
      : sha256Hex(`region|project_root|${project.projectId}`);
    const seed = seedByKey.get(regionKey) ?? {
      regionKey,
      label: project?.name ?? project?.root ?? packageNode.displayName,
      project: project ?? null,
      packageKeys: []
    };
    seed.packageKeys.push(packageNode.entityKey);
    seedByKey.set(regionKey, seed);
    regionByPackageKey.set(packageNode.entityKey, regionKey);
  }
  for (const seed of seedByKey.values()) seed.packageKeys.sort(compareKeys);

  const regionByEntityKey = new Map<string, string>();
  for (const node of graph.nodes) {
    const owner = packages.representativeByEntityKey.get(node.entityKey);
    const region = owner === undefined ? undefined : regionByPackageKey.get(owner);
    if (region !== undefined) regionByEntityKey.set(node.entityKey, region);
  }

  const nodesByRegion = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const regionKey = regionByEntityKey.get(node.entityKey);
    if (regionKey === undefined) continue;
    const bucket = nodesByRegion.get(regionKey) ?? [];
    bucket.push(node);
    nodesByRegion.set(regionKey, bucket);
  }
  for (const bucket of nodesByRegion.values()) {
    bucket.sort((left, right) => compareKeys(left.entityKey, right.entityKey));
  }

  const crossCounts = new Map<string, { incoming: number; outgoing: number }>();
  for (const edge of graph.edges) {
    const source = regionByEntityKey.get(edge.srcEntityKey);
    const target = regionByEntityKey.get(edge.dstEntityKey);
    if (source === undefined || target === undefined || source === target) continue;
    const sourceCounts = crossCounts.get(source) ?? { incoming: 0, outgoing: 0 };
    sourceCounts.outgoing += 1;
    crossCounts.set(source, sourceCounts);
    const targetCounts = crossCounts.get(target) ?? { incoming: 0, outgoing: 0 };
    targetCounts.incoming += 1;
    crossCounts.set(target, targetCounts);
  }

  const regions: RegionDto[] = [...seedByKey.values()].map((seed) => {
    const nodes = nodesByRegion.get(seed.regionKey) ?? [];
    const byKind = emptyKindCounts();
    for (const node of nodes) byKind[node.kind] += 1;
    const cross = crossCounts.get(seed.regionKey) ?? { incoming: 0, outgoing: 0 };
    const counts: RegionCountsDto = {
      entities: nodes.length,
      byKind,
      incomingCrossRegionRelations: cross.incoming,
      outgoingCrossRegionRelations: cross.outgoing
    };
    const packageSet = new Set(seed.packageKeys);
    const basisEdges = graph.edges
      .filter((edge) => {
        if (edge.relation !== "contains") return false;
        const sourceOwner = packages.representativeByEntityKey.get(edge.srcEntityKey);
        const targetOwner = packages.representativeByEntityKey.get(edge.dstEntityKey);
        return sourceOwner !== undefined && targetOwner !== undefined
          && packageSet.has(sourceOwner) && packageSet.has(targetOwner);
      })
      .sort((left, right) => compareKeys(left.entityKey, right.entityKey));
    const basisEvidence = boundedEvidence([
      ...seed.packageKeys.flatMap((key) => nodeByKey.get(key)?.evidence ?? []),
      ...basisEdges.flatMap((edge) => edge.evidence),
      ...(seed.project?.manifest === null || seed.project === null ? [] : graph.nodes
        .filter((node) => node.kind === "file" && node.file === seed.project!.manifest)
        .flatMap((node) => node.evidence))
    ]);
    const basis: RegionBasisDto = seed.project === null
      ? {
          kind: "package_containment",
          packageEntityKey: seed.packageKeys[0]!,
          sourceEdgeCount: basisEdges.length,
          ...basisEvidence
        }
      : {
          kind: "project_root",
          projectId: seed.project.projectId,
          root: seed.project.root,
          manifest: seed.project.manifest,
          ...basisEvidence
        };
    return {
      regionKey: seed.regionKey,
      label: seed.label,
      memberPackageKeys: seed.packageKeys,
      role: graphDerivedRole(),
      basis,
      counts,
      languages: [...new Set([
        ...nodes.flatMap((node) => node.language === undefined || node.language === null ? [] : [node.language]),
        ...(seed.project?.languages ?? [])
      ])].sort(compareKeys),
      capabilities: [...new Set(nodes.flatMap((node) =>
        node.provenance === undefined ? [] : [node.provenance.capability]
      ))].sort(compareKeys),
      derivations: [...new Set(nodes.flatMap((node) =>
        node.provenance === undefined ? [] : [node.provenance.derivation]
      ))].sort(compareKeys)
    };
  }).sort((left, right) => compareKeys(left.regionKey, right.regionKey));

  return freezeProjection({
    regions,
    accounting: {
      packageCount: packages.nodes.length,
      projectCount: projects.length,
      regionCount: regions.length,
      assignedEntityCount: regionByEntityKey.size,
      ambiguousEntityCount: packages.ambiguousEntityKeys.size,
      unownedEntityCount: packages.unownedEntityKeys.size
    }
  });
}

/** One immutable projection per captured snapshot graph object. */
export function getRegionProjection(graph: RegionProjectionGraph): RegionProjectionDto {
  const cached = regionProjectionCache.get(graph);
  if (cached !== undefined) return cached;
  const projected = projectSnapshotRegions(graph);
  regionProjectionCache.set(graph, projected);
  return projected;
}
