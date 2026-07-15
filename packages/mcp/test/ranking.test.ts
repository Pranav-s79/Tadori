import { describe, expect, it } from "vitest";
import {
  rankCandidates,
  RANKING_POLICY_VERSION,
  RANKING_WEIGHTS,
  signatureReferencesType
} from "../src/ranking.js";
import { makeEdge, makeNode } from "./helpers.js";

describe("Week 5 context ranking", () => {
  it("uses the frozen weights, exposes unavailable signals, and puts hard facts first", () => {
    const anchor = makeNode("function", "src/app.ts.anchor", "src/app.ts", {
      signature: "function anchor(value: RequestShape): void"
    });
    const direct = makeNode("function", "src/app.ts.direct", "src/app.ts");
    const requestShape = makeNode("interface", "src/types.ts.RequestShape", "src/types.ts", {
      displayName: "RequestShape"
    });
    const heuristic = makeNode("function", "src/app.ts.heuristic", "src/app.ts");
    const test = makeNode("test", "test/app.test.ts.anchor", "test/app.test.ts");
    const ranked = rankCandidates([
      {
        node: heuristic,
        distance: 1,
        connectingEdges: [makeEdge(heuristic, "imports", anchor)],
        fanIn: 10_000,
        samePackage: true,
        linkedTestToAnchor: false,
        hardRequirements: [],
        hardPriority: 0
      },
      {
        node: direct,
        distance: 1,
        connectingEdges: [makeEdge(direct, "calls", anchor)],
        fanIn: 0,
        samePackage: false,
        linkedTestToAnchor: false,
        hardRequirements: ["direct_caller_or_callee"],
        hardPriority: 2
      },
      {
        node: requestShape,
        distance: 1,
        connectingEdges: [makeEdge(anchor, "references", requestShape)],
        fanIn: 0,
        samePackage: false,
        linkedTestToAnchor: false,
        hardRequirements: ["signature_type_definition"],
        hardPriority: 2
      },
      {
        node: test,
        distance: 1,
        connectingEdges: [makeEdge(test, "tests", anchor)],
        fanIn: 0,
        samePackage: false,
        linkedTestToAnchor: true,
        hardRequirements: ["certain_linked_test"],
        hardPriority: 2
      }
    ]);

    expect(RANKING_POLICY_VERSION).toBe("tadori-v2.1-week5-linear-v1");
    expect(RANKING_WEIGHTS).toEqual({
      bm25: 3,
      proximity: 2.5,
      fanIn: 1,
      churn: 1,
      linkedTest: 1.5,
      linkedDecision: 1,
      samePackage: 0.5
    });
    expect(ranked.slice(0, 3).map((entry) => entry.node.entityKey)).toEqual(
      expect.arrayContaining([direct.entityKey, requestShape.entityKey, test.entityKey])
    );
    expect(ranked[3]?.node.entityKey).toBe(heuristic.entityKey);
    expect(ranked.find((entry) => entry.node === direct)?.hardRequirements).toContain(
      "direct_caller_or_callee"
    );
    expect(
      ranked.find((entry) => entry.node === requestShape)?.hardRequirements
    ).toContain("signature_type_definition");
    expect(ranked.find((entry) => entry.node === test)?.hardRequirements).toContain(
      "certain_linked_test"
    );
    expect(ranked[0]?.components.bm25).toMatchObject({
      raw: null,
      contribution: 0,
      status: "unavailable"
    });
    expect(ranked[0]?.components.churn.status).toBe("unavailable");
    expect(ranked[0]?.components.linkedDecision.status).toBe("unavailable");

    const substringOnly = makeNode("interface", "src/types.ts.Shape", "src/types.ts", {
      displayName: "Shape"
    });
    expect(signatureReferencesType(anchor.signature, substringOnly)).toBe(false);
    expect(signatureReferencesType(anchor.signature, requestShape)).toBe(true);

    const unavailablePackage = rankCandidates([{
      node: substringOnly,
      distance: 1,
      connectingEdges: [],
      fanIn: 0,
      samePackage: null,
      linkedTestToAnchor: false,
      hardRequirements: [],
      hardPriority: 0
    }])[0];
    expect(unavailablePackage?.components.samePackage).toMatchObject({
      raw: null,
      contribution: 0,
      status: "unavailable"
    });
    expect(unavailablePackage?.confidence).toBeNull();
  });

  it("orders confidence-aware proximity deterministically and preserves ties by identity", () => {
    const anchor = makeNode("function", "src/app.ts.anchor", "src/app.ts");
    const certain = makeNode("function", "src/app.ts.certain", "src/app.ts");
    const inferred = makeNode("function", "src/app.ts.inferred", "src/app.ts");
    const certainEdge = makeEdge(certain, "imports", anchor);
    const inferredEdge = {
      ...makeEdge(inferred, "imports", anchor),
      origin: "heuristic" as const,
      confidence: "inferred" as const,
      resolution: "unresolved" as const
    };
    const confidenceRanked = rankCandidates(
      [
        { node: inferred, connectingEdges: [inferredEdge] },
        { node: certain, connectingEdges: [certainEdge] }
      ].map((input) => ({
        ...input,
        distance: 1,
        fanIn: 0,
        samePackage: false,
        linkedTestToAnchor: false,
        hardRequirements: [],
        hardPriority: 0 as const
      }))
    );
    expect(confidenceRanked.map((entry) => entry.node.entityKey)).toEqual([
      certain.entityKey,
      inferred.entityKey
    ]);
    expect(confidenceRanked[0]?.components.proximity.raw).toBe(0.5);
    expect(confidenceRanked[1]?.components.proximity.raw).toBe(0.5);

    const tied = [
      makeNode("function", "src/app.ts.tie-b", "src/app.ts"),
      makeNode("function", "src/app.ts.tie-a", "src/app.ts")
    ];
    const tiedRanked = rankCandidates(
      tied.map((node) => ({
        node,
        distance: 2,
        connectingEdges: [makeEdge(node, "imports", anchor)],
        fanIn: 0,
        samePackage: false,
        linkedTestToAnchor: false,
        hardRequirements: [],
        hardPriority: 0 as const
      }))
    );
    expect(tiedRanked.map((entry) => entry.node.entityKey)).toEqual(
      [...tied].sort((left, right) => left.entityKey.localeCompare(right.entityKey)).map(
        (node) => node.entityKey
      )
    );
  });
});
