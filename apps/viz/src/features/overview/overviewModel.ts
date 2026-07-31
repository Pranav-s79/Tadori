import type { ClaimBasis } from "../../design/ClaimBadge.tsx";
import type { RouteRow } from "../explore/exploreApi.ts";
import type {
  ApiContext,
  ApiNode,
  CapabilityMatrixDto,
  RegionProjectionDto,
  SnapshotAnalysisDto
} from "../../api/types.ts";

/**
 * One statement on the overview, carrying how it is supported and what to open
 * to check it. `evidence` lists repository paths or extractor identities the
 * user can inspect; an empty list is only ever paired with `unknown`.
 */
export interface OverviewClaim {
  label: string;
  value: string;
  basis: ClaimBasis;
  evidence: string[];
  /** Entity key to select in Atlas, when the claim points at a graph node. */
  entityKey?: string;
}

export interface OverviewSection {
  id: string;
  heading: string;
  question: string;
  claims: OverviewClaim[];
}

/**
 * Registered entry points come from `/api/v1/routes`, which reports the whole
 * snapshot. The rendered graph is level-of-detail bounded — at the landing view
 * it holds a single repository node — so counting `route` nodes there reported
 * "no entry points" for a repository that plainly has them. Loading and
 * unavailable stay distinct from a genuine zero for the same reason.
 */
export type RoutesState =
  | { status: "loading" }
  | { status: "ready"; routes: readonly RouteRow[] }
  | { status: "error" };

/**
 * Symbol-level nodes for the whole snapshot, used to answer which entities the
 * rest of the system leans on. Ranking fan-in over the rendered graph answered
 * "unknown" for every real repository, because the landing view holds a single
 * repository node whose fan-in is zero.
 */
export type CouplingState =
  | { status: "loading" }
  | { status: "ready"; nodes: readonly ApiNode[] }
  | { status: "error" };

export interface OverviewInput {
  context: ApiContext | null;
  analysis: SnapshotAnalysisDto | null;
  regions: RegionProjectionDto | null;
  capabilities: CapabilityMatrixDto | null;
  routes: RoutesState;
  coupling: CouplingState;
  nodes: readonly ApiNode[];
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * An external dependency with high fan-in is a real answer to "what is this
 * system leaning on", so it is kept rather than filtered out — but its kind is
 * named, because "the whole app depends on express" and "the whole app depends
 * on UserService" are different facts and must not read alike.
 */
function couplingClaims(coupling: CouplingState): OverviewClaim[] {
  if (coupling.status !== "ready") {
    return [{
      label: "Coupling",
      value: coupling.status === "loading"
        ? "Ranking the most depended-upon entities…"
        : "Coupling is unavailable: the symbol projection could not be read. "
          + "This is not a statement that nothing depends on anything.",
      basis: "unknown",
      evidence: []
    }];
  }
  const ranked = [...coupling.nodes]
    .filter((node) => node.fanIn > 0)
    .sort((left, right) => right.fanIn - left.fanIn || left.displayName.localeCompare(right.displayName))
    .slice(0, 8);
  if (ranked.length === 0) {
    return [{
      label: "Coupling",
      value: "No incoming references were recorded anywhere in this snapshot.",
      basis: "unknown",
      evidence: []
    }];
  }
  return ranked.map((node) => ({
    label: node.displayName,
    value: `${plural(node.fanIn, "incoming reference", "incoming references")}`
      + ` · ${node.kind.replace(/_/gu, " ")}`
      + " — changing this affects every dependent",
    basis: "observed" as ClaimBasis,
    evidence: node.file === null ? [] : [node.file],
    entityKey: node.entityKey
  }));
}

/**
 * Four outcomes, four sentences. "Still loading" and "the endpoint failed" must
 * never be rendered as "this repository has no entry points".
 */
function entryPointClaims(routes: RoutesState): OverviewClaim[] {
  if (routes.status === "loading") {
    return [{
      label: "Registered entry points",
      value: "Reading registered entry points from the snapshot…",
      basis: "unknown",
      evidence: []
    }];
  }
  if (routes.status === "error") {
    return [{
      label: "Registered entry points",
      value: "Entry points are unavailable: the route projection could not be "
        + "read. This is not a statement that the repository has none.",
      basis: "unknown",
      evidence: []
    }];
  }
  if (routes.routes.length === 0) {
    return [{
      label: "Registered entry points",
      value: "No route node was extracted from this repository. That means no "
        + "registered HTTP entry point was found, not that the system has none.",
      basis: "unknown",
      evidence: []
    }];
  }
  return routes.routes.slice(0, 12).map(({ node }) => ({
    label: node.displayName,
    value: node.file === null
      ? "no file recorded"
      : `${node.file}:${String(node.lineStart ?? 0)}`,
    basis: "observed" as ClaimBasis,
    evidence: node.file === null ? [] : [node.file],
    entityKey: node.entityKey
  }));
}

/**
 * `GET /api/v1/overview` reports `available: false`, so this view is ASSEMBLED
 * from the endpoints that do carry evidence rather than served whole. Anything
 * those endpoints cannot support stays `unknown` instead of being invented —
 * notably repository purpose, which nothing served today establishes.
 */
export function buildOverview(input: OverviewInput): OverviewSection[] {
  const { context, analysis, regions, capabilities, routes, coupling, nodes } = input;
  const sections: OverviewSection[] = [];

  sections.push({
    id: "purpose",
    heading: "Repository purpose",
    question: "What does this repository do?",
    claims: [{
      label: "Stated purpose",
      value: "No documented purpose is available from the served snapshot. "
        + "Tadori does not infer intent from names.",
      basis: "unknown",
      evidence: []
    }]
  });

  const languageClaims: OverviewClaim[] = (analysis?.languages ?? []).map((language) => ({
    label: language.id,
    value: plural(language.fileCount, "file", "files")
      + (language.generatedFileCount > 0
        ? `, ${String(language.generatedFileCount)} generated`
        : "")
      + (language.capabilities.length > 0
        ? ` · ${language.capabilities.join(", ")} extraction`
        : " · no extraction capability recorded"),
    basis: "observed",
    evidence: language.extractors.map((extractor) => `${extractor.id}@${extractor.version}`)
  }));
  sections.push({
    id: "languages",
    heading: "Languages observed",
    question: "What is this built with?",
    claims: languageClaims.length > 0 ? languageClaims : [{
      label: "Languages",
      value: "No language was observed in this snapshot.",
      basis: "unknown",
      evidence: []
    }]
  });

  sections.push({
    id: "entry-points",
    heading: "Entry points",
    question: "Where does execution begin?",
    claims: entryPointClaims(routes)
  });

  const regionClaims: OverviewClaim[] = (regions?.regions ?? []).map((region) => ({
    label: region.label,
    value: region.role.text
      ?? plural(region.counts.entities, "entity", "entities")
        + ` · ${plural(region.counts.outgoingCrossRegionRelations, "outgoing relation", "outgoing relations")}`,
    basis: region.role.text === null
      ? "observed"
      : region.role.status === "documented" ? "documented" : "inferred",
    evidence: region.role.evidence.map((item) => `${item.file}:${String(item.lineStart)}`),
    entityKey: region.packageEntityKey ?? region.memberPackageKeys[0]
  }));
  sections.push({
    id: "regions",
    heading: "Major regions",
    question: "How is the system structured, and which modules own what?",
    claims: regionClaims.length > 0 ? regionClaims : [{
      label: "Regions",
      value: "No region projection is available for this snapshot.",
      basis: "unknown",
      evidence: []
    }]
  });

  sections.push({
    id: "risk",
    heading: "Most depended-upon",
    question: "What is technically important or fragile?",
    claims: couplingClaims(coupling)
  });

  const diagnostics = analysis?.diagnostics;
  if (diagnostics !== undefined && diagnostics.total > 0) {
    sections.push({
      id: "limits",
      heading: "Analysis limits",
      question: "What could Tadori not read?",
      claims: [{
        label: "Extraction diagnostics",
        value: `${plural(diagnostics.total, "diagnostic", "diagnostics")} recorded`
          + ` (${String(diagnostics.bySeverity.error)} error,`
          + ` ${String(diagnostics.bySeverity.warning)} warning,`
          + ` ${String(diagnostics.bySeverity.info)} info).`
          + " Affected files may appear thinner than they are.",
        basis: "observed",
        evidence: diagnostics.items.slice(0, 5).flatMap((item) => item.file === null ? [] : [item.file])
      }]
    });
  }

  if (context !== null) {
    sections.push({
      id: "snapshot",
      heading: "Snapshot",
      question: "What exactly am I looking at?",
      claims: [{
        label: "Served snapshot",
        value: `#${String(context.snapshotId)} · ${context.snapshotKind} · ${context.freshness}`
          + (capabilities === null ? "" : ` · contract v${String(capabilities.version)}`),
        basis: "observed",
        evidence: [context.repository]
      }]
    });
  }

  return sections;
}
