import type { Confidence, GraphEdge, GraphNode } from "@tadori/core";

export const RANKING_POLICY_VERSION = "tadori-v2.1-week5-linear-v1";

/** Frozen v2.1 linear weights. Unavailable signals remain explicit and contribute zero. */
export const RANKING_WEIGHTS = Object.freeze({
  bm25: 3,
  proximity: 2.5,
  fanIn: 1,
  churn: 1,
  linkedTest: 1.5,
  linkedDecision: 1,
  samePackage: 0.5
});

export type HardRequirement =
  | "direct_caller_or_callee"
  | "signature_type_definition"
  | "certain_linked_test"
  | "declared_boundary_neighbor";

export interface RankingComponent {
  raw: number | null;
  weight: number;
  contribution: number;
  status: "applied" | "unavailable";
}

export interface RankedCandidate {
  node: GraphNode;
  score: number;
  confidence: Confidence | null;
  hardRequirements: HardRequirement[];
  hardPriority: 0 | 1 | 2;
  components: {
    bm25: RankingComponent;
    proximity: RankingComponent;
    fanIn: RankingComponent;
    churn: RankingComponent;
    linkedTest: RankingComponent;
    linkedDecision: RankingComponent;
    samePackage: RankingComponent;
  };
}

export interface RankCandidateInput {
  node: GraphNode;
  distance: number;
  connectingEdges: readonly GraphEdge[];
  fanIn: number;
  samePackage: boolean | null;
  linkedTestToAnchor: boolean;
  hardRequirements: readonly HardRequirement[];
  hardPriority: 0 | 1 | 2;
}

const CONFIDENCE_PRIORITY: Record<Confidence, number> = {
  certain: 3,
  likely: 2,
  inferred: 1
};

function confidencePriority(confidence: Confidence | null): number {
  return confidence === null ? 0 : CONFIDENCE_PRIORITY[confidence];
}

function bestConfidence(edges: readonly GraphEdge[]): Confidence | null {
  return edges.reduce<Confidence | null>(
    (best, edge) =>
      confidencePriority(edge.confidence) > confidencePriority(best)
        ? edge.confidence
        : best,
    null
  );
}

function applied(raw: number, weight: number): RankingComponent {
  return { raw, weight, contribution: raw * weight, status: "applied" };
}

function unavailable(weight: number): RankingComponent {
  return { raw: null, weight, contribution: 0, status: "unavailable" };
}

export function signatureReferencesType(
  anchorSignature: string | null,
  node: GraphNode
): boolean {
  if (anchorSignature === null || (node.kind !== "type" && node.kind !== "interface")) {
    return false;
  }
  const identifiers = new Set(anchorSignature.match(/[$A-Z_a-z][$\w]*/g) ?? []);
  return identifiers.has(node.displayName) || identifiers.has(node.qualifiedName);
}

export function rankCandidates(inputs: readonly RankCandidateInput[]): RankedCandidate[] {
  return inputs
    .map((input): RankedCandidate => {
      const confidence = bestConfidence(input.connectingEdges);
      const linkedTest = input.linkedTestToAnchor ? 1 : 0;
      const hardRequirements = [...input.hardRequirements];
      const proximityRaw = 1 / (1 + input.distance);
      const components: RankedCandidate["components"] = {
        bm25: unavailable(RANKING_WEIGHTS.bm25),
        proximity: applied(proximityRaw, RANKING_WEIGHTS.proximity),
        fanIn: applied(Math.log1p(input.fanIn), RANKING_WEIGHTS.fanIn),
        churn: unavailable(RANKING_WEIGHTS.churn),
        linkedTest: applied(linkedTest, RANKING_WEIGHTS.linkedTest),
        linkedDecision: unavailable(RANKING_WEIGHTS.linkedDecision),
        samePackage:
          input.samePackage === null
            ? unavailable(RANKING_WEIGHTS.samePackage)
            : applied(input.samePackage ? 1 : 0, RANKING_WEIGHTS.samePackage)
      };
      const score = Object.values(components).reduce(
        (total, component) => total + component.contribution,
        0
      );
      return {
        node: input.node,
        score,
        confidence,
        hardRequirements,
        hardPriority: input.hardPriority,
        components
      };
    })
    .sort(
      (left, right) =>
        right.hardPriority - left.hardPriority ||
        right.score - left.score ||
        confidencePriority(right.confidence) - confidencePriority(left.confidence) ||
        left.node.entityKey.localeCompare(right.node.entityKey)
    );
}
