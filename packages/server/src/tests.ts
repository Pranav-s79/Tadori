import type { GraphEdge, GraphNode, Origin } from "@tadori/core";
import type { GraphService } from "@tadori/mcp";
import type { FastifyInstance } from "fastify";
import { toToolEdge, toToolNode } from "./routes/graph.js";
import type { TestLink, TestLinkage } from "./types.js";

/**
 * Map a `tests`-edge origin to its linkage kind — the SAME mapping the MCP
 * find_tests tool uses (packages/mcp/src/tools.ts). `package_associated` exists
 * in the enum but is not produced by current extraction, so it is not emitted
 * here either; the UI still handles it forward-compatibly. This is a STATIC
 * linkage label, never a runtime-coverage claim.
 */
export function testLinkageFor(origin: Origin): TestLinkage {
  switch (origin) {
    case "compiler":
      return "statically_linked";
    case "heuristic":
      return "naming_associated";
    case "git":
      return "historically_associated";
    case "doc":
    case "human":
    case "llm":
      return "evidence_associated";
  }
}

/**
 * Likely-relevant tests for a target entity, with their linkage kind derived
 * from the `tests` edge that connects them. Reads GraphService maps directly
 * (same idiom as deriveRouteStory) — no MCP tool invocation. Deterministic:
 * sorted by the test node's entityKey.
 */
export function deriveTestLinks(
  app: FastifyInstance,
  service: GraphService,
  target: GraphNode
): TestLink[] {
  const edges: GraphEdge[] = [
    ...(service.inEdges.get(target.entityKey) ?? []),
    ...(service.outEdges.get(target.entityKey) ?? [])
  ].filter((edge) => edge.relation === "tests");

  const links: TestLink[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    const otherKey = edge.srcEntityKey === target.entityKey ? edge.dstEntityKey : edge.srcEntityKey;
    const testNode = service.nodesByKey.get(otherKey);
    if (testNode?.kind !== "test" || seen.has(testNode.entityKey)) {
      continue;
    }
    seen.add(testNode.entityKey);
    links.push({
      node: toToolNode(app, testNode),
      linkage: testLinkageFor(edge.origin),
      edge: toToolEdge(app, edge)
    });
  }

  links.sort((a, b) =>
    a.node.entityKey < b.node.entityKey ? -1 : a.node.entityKey > b.node.entityKey ? 1 : 0
  );
  return links;
}
