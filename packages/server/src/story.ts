import type { Confidence, GraphEdge, GraphNode, Relation } from "@tadori/core";
import type { GraphService } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { toToolEdge, toToolNode } from "./routes/graph.js";
import type {
  BehaviorStory,
  StoryStep,
  StoryStepLabel,
  StoryTransition
} from "./types.js";

/**
 * BehaviorStory derivation (08-07A). Frozen contract:
 * blueprints/09-behavior-story-contract.md.
 *
 * Static behavior story only — never a runtime/execution claim. Every step and
 * transition carries the real origin/confidence/resolution and evidence of the
 * edge/node that produced it, verbatim. Dynamic dispatch dead-ends at a
 * kind:"unresolved" node (the wall is rendered, no destination invented).
 * branches[] is always empty in v1 (no control-flow source exists yet).
 */

/** Relations the story traversal follows. */
const STORY_RELATIONS: ReadonlySet<Relation> = new Set<Relation>([
  "routes_to",
  "calls",
  "references"
]);

/** Weakest-wins ordering for the aggregate story confidence. */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  inferred: 0,
  likely: 1,
  certain: 2
};

/**
 * Honesty label for a reached step, derived from the reaching edge + the
 * incoming tests/documents edges of the destination. Order matters: the more
 * specific/honest label wins (unresolved > ambiguous > inferred >
 * test-backed/documented > statically-resolved).
 */
function stepLabel(
  edge: GraphEdge,
  dst: GraphNode | undefined,
  hasTestsEdge: boolean,
  hasDocumentsEdge: boolean
): StoryStepLabel {
  if (edge.resolution === "unresolved" || dst?.kind === "unresolved") {
    return "unresolved";
  }
  if (edge.origin === "heuristic" && edge.resolution === "partial") {
    return "ambiguous";
  }
  if (edge.confidence === "inferred") {
    return "inferred";
  }
  if (hasTestsEdge) {
    return "test-backed";
  }
  if (hasDocumentsEdge) {
    return "documented";
  }
  if (edge.origin === "compiler" && edge.resolution === "resolved") {
    return "statically-resolved";
  }
  // A resolved but non-compiler edge: report the closest honest bucket rather
  // than upgrading it to statically-resolved.
  return "inferred";
}

/** True if any incoming edge of `dstKey` has the given relation. */
function hasIncoming(service: GraphService, dstKey: string, relation: Relation): boolean {
  const incoming = service.inEdges.get(dstKey) ?? [];
  return incoming.some((edge) => edge.relation === relation);
}

/**
 * Derive the behavior story for a route node. Pure over the served snapshot:
 * reads GraphService maps only, produces a byte-stable BehaviorStory.
 */
export function deriveRouteStory(
  app: FastifyInstance,
  service: GraphService,
  routeNode: GraphNode
): BehaviorStory {
  const snapshotId = service.snapshot.id;
  const entryPoint = routeNode.entityKey;

  const steps: StoryStep[] = [];
  const transitions: StoryTransition[] = [];
  const testKeys = new Set<string>();

  // BFS over STORY_RELATIONS; sort each node's outgoing edges by edge.entityKey
  // ascending for determinism; first-visit wins.
  const visited = new Set<string>([entryPoint]);
  const queue: string[] = [entryPoint];
  let head = 0;
  while (head < queue.length) {
    const currentKey = queue[head];
    head += 1;
    if (currentKey === undefined) {
      continue;
    }
    const outgoing = (service.outEdges.get(currentKey) ?? [])
      .filter((edge) => STORY_RELATIONS.has(edge.relation))
      .slice()
      .sort((a, b) => (a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0));

    for (const edge of outgoing) {
      const dstKey = edge.dstEntityKey;
      const dst = service.nodesByKey.get(dstKey);
      const toolEdge = toToolEdge(app, edge);
      const isUnresolved = edge.resolution === "unresolved" || dst?.kind === "unresolved";

      transitions.push({
        from: currentKey,
        to: dstKey,
        relation: edge.relation,
        origin: toolEdge.origin,
        confidence: toolEdge.confidence,
        resolution: toolEdge.resolution,
        resolved: edge.resolution !== "unresolved",
        evidence: toolEdge.evidence
      });

      if (visited.has(dstKey)) {
        continue;
      }
      visited.add(dstKey);

      const hasTestsEdge = hasIncoming(service, dstKey, "tests");
      const hasDocumentsEdge = hasIncoming(service, dstKey, "documents");
      if (hasTestsEdge) {
        for (const inc of service.inEdges.get(dstKey) ?? []) {
          if (inc.relation === "tests") {
            testKeys.add(inc.srcEntityKey);
          }
        }
      }

      const stepIndex = steps.length;
      const toolNode = dst ? toToolNode(app, dst) : null;
      steps.push({
        id: `step:${stepIndex}:${isUnresolved ? "unresolved" : dstKey}`,
        entityKey: isUnresolved ? null : dstKey,
        kind: dst?.kind ?? "unresolved",
        resolved: dst !== undefined && dst.kind !== "unresolved" && edge.resolution !== "unresolved",
        label: stepLabel(edge, dst, hasTestsEdge, hasDocumentsEdge),
        origin: toolEdge.origin,
        confidence: toolEdge.confidence,
        resolution: toolEdge.resolution,
        evidence: toolNode ? toolNode.evidence : []
      });

      // Do not traverse past an unresolved wall — there is no real destination.
      if (!isUnresolved && dst !== undefined) {
        queue.push(dstKey);
      }
    }
  }

  const unresolvedTransitions = transitions
    .filter((t) => t.resolution === "unresolved")
    .slice()
    .sort((a, b) => (a.from + (a.to ?? "") < b.from + (b.to ?? "") ? -1 : 1));

  const tests = [...testKeys].sort();

  // Weakest confidence across all transitions (certain when there are none).
  const confidence: Confidence = transitions.reduce<Confidence>((weakest, t) => {
    return CONFIDENCE_RANK[t.confidence] < CONFIDENCE_RANK[weakest] ? t.confidence : weakest;
  }, "certain");

  return {
    id: `story:route:${entryPoint}:${snapshotId}`,
    title: routeNode.displayName,
    trigger: routeNode.displayName,
    entryPoint,
    steps,
    transitions,
    tests,
    unresolvedTransitions,
    branches: [],
    evidenceOmittedCount: 0,
    snapshotId,
    confidence,
    runtimeObserved: false
  };
}
