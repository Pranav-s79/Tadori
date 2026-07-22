import { describe, expect, it } from "vitest";
import type { GraphNode, NodeKind, Relation } from "@tadori/core";
import type { EdgeDiffRow } from "@tadori/store";
import {
  buildCoalescedChanges,
  coalesceEdges,
  stageAMatch,
  stageBMatch,
  unqualifiedName,
  type NodePairCandidate
} from "../src/coalescing.js";

const AV = "analyzer-v1";

/** Minimal synthetic GraphNode; only the fields the matchers read matter. */
function node(kind: NodeKind, qualifiedName: string, bodyHash: string | null): GraphNode {
  return {
    kind,
    qualifiedName,
    displayName: qualifiedName,
    canonicalIdentity: `${kind}|${qualifiedName}`,
    entityKey: bodyHash ?? qualifiedName.padEnd(64, "0").slice(0, 64),
    file: kind === "file" ? qualifiedName : qualifiedName.split(".").slice(0, 2).join("."),
    exported: true,
    spanStart: 0,
    spanEnd: 1,
    lineStart: 1,
    lineEnd: 2,
    signature: null,
    bodyHash,
    evidence: []
  } as GraphNode;
}

describe("unqualifiedName", () => {
  it("file → basename; symbol → trailing dot segment", () => {
    expect(unqualifiedName(node("file", "src/legacy/helper.ts", "h"))).toBe("helper.ts");
    expect(unqualifiedName(node("function", "src/legacy/helper.ts.normalize", "h"))).toBe("normalize");
    expect(unqualifiedName(node("method", "src/formatter.ts.Formatter.formatValue", "h"))).toBe("formatValue");
  });
});

describe("stageAMatch (identity basis: kind + unqualifiedName + bodyHash + analyzerVersion)", () => {
  it("pairs a pure file move (path changes, basename+hash+kind stable) — fixture-04 shape", () => {
    const removed = [node("file", "src/legacy/helper.ts", "hashA")];
    const added = [node("file", "src/helpers/helper.ts", "hashA")];
    const { pairs, remainingRemoved, remainingAdded } = stageAMatch(removed, added, AV);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.stage).toBe("A");
    expect(pairs[0]?.basis).toEqual(["kind", "unqualifiedName", "bodyHash", "analyzerVersion"]);
    expect(remainingRemoved).toHaveLength(0);
    expect(remainingAdded).toHaveLength(0);
  });

  it("pairs a moved function (same trailing name + body hash)", () => {
    const removed = [node("function", "src/legacy/helper.ts.normalize", "fnHash")];
    const added = [node("function", "src/helpers/helper.ts.normalize", "fnHash")];
    const { pairs } = stageAMatch(removed, added, AV);
    expect(pairs).toHaveLength(1);
  });

  it("does NOT pair when body hash differs", () => {
    const removed = [node("file", "src/legacy/helper.ts", "hashA")];
    const added = [node("file", "src/helpers/helper.ts", "hashB")];
    const { pairs, remainingRemoved, remainingAdded } = stageAMatch(removed, added, AV);
    expect(pairs).toHaveLength(0);
    expect(remainingRemoved).toHaveLength(1);
    expect(remainingAdded).toHaveLength(1);
  });

  it("matches when analyzerVersion is shared (basis element participates in the key)", () => {
    const removed = [node("file", "a/x.ts", "h")];
    const added = [node("file", "b/x.ts", "h")];
    expect(stageAMatch(removed, added, "v1").pairs).toHaveLength(1);
  });

  it("leaves a non-unique basis group unpaired (deferred to Stage B / ambiguity)", () => {
    // two removed files share basename+hash → not unique on removed side
    const removed = [node("file", "a/helper.ts", "h"), node("file", "b/helper.ts", "h")];
    const added = [node("file", "c/helper.ts", "h")];
    const { pairs, remainingRemoved } = stageAMatch(removed, added, AV);
    expect(pairs).toHaveLength(0);
    expect(remainingRemoved).toHaveLength(2);
  });

  it("excludes nodes with null bodyHash from matching", () => {
    const removed = [node("file", "a/x.ts", null)];
    const added = [node("file", "b/x.ts", null)];
    const { pairs, remainingRemoved, remainingAdded } = stageAMatch(removed, added, AV);
    expect(pairs).toHaveLength(0);
    expect(remainingRemoved).toHaveLength(1);
    expect(remainingAdded).toHaveLength(1);
  });
});

describe("stageBMatch (body-hash-only among Stage-A residuals + uniqueCandidate)", () => {
  it("pairs a method rename with a unique matching body hash — fixture-04 Stage-B shape", () => {
    // formatValue → renderValue: name changed, body hash identical (body did not
    // reference its own name), unique remaining candidate on each side.
    const removed = [node("method", "src/formatter.ts.Formatter.formatValue", "mHash")];
    const added = [node("method", "src/formatter.ts.Formatter.renderValue", "mHash")];
    const { pairs, ambiguousGroups, residualRemoved, residualAdded } = stageBMatch(removed, added, AV);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.stage).toBe("B");
    expect(pairs[0]?.basis).toEqual(["kind", "bodyHash", "analyzerVersion", "uniqueCandidate"]);
    expect(ambiguousGroups).toHaveLength(0);
    expect(residualRemoved).toHaveLength(0);
    expect(residualAdded).toHaveLength(0);
  });

  it("recursive function rename does not Stage-B match (intentional, per tadori-indexer skill note)", () => {
    // factorial → factorialImpl. Its body self-calls by name, so the rename
    // changes the body text → a DIFFERENT bodyHash. It must fall into residuals,
    // never be disguised as a match. (SKILL.md lines 18-20.)
    const removed = [node("function", "src/math.ts.factorial", "hashOldBody")];
    const added = [node("function", "src/math.ts.factorialImpl", "hashNewBody")];
    const { pairs, residualRemoved, residualAdded } = stageBMatch(removed, added, AV);
    expect(pairs).toHaveLength(0);
    expect(residualRemoved).toHaveLength(1);
    expect(residualAdded).toHaveLength(1);
  });

  it("reports an ambiguous group (2+ residuals share a body hash), pairing none", () => {
    const removed = [
      node("function", "a.ts.f", "shared"),
      node("function", "a.ts.g", "shared")
    ];
    const added = [node("function", "a.ts.h", "shared")];
    const { pairs, ambiguousGroups, residualRemoved, residualAdded } = stageBMatch(removed, added, AV);
    expect(pairs).toHaveLength(0);
    expect(ambiguousGroups).toHaveLength(1);
    expect(ambiguousGroups[0]?.candidates).toHaveLength(3);
    expect(ambiguousGroups[0]?.reason).toContain("cannot disambiguate");
    // none left as plain residuals — they are accounted for in the ambiguous group
    expect(residualRemoved).toHaveLength(0);
    expect(residualAdded).toHaveLength(0);
  });

  it("a body hash present only on one side stays residual (genuine add or remove)", () => {
    const removed = [node("function", "a.ts.gone", "onlyRemoved")];
    const added = [node("function", "a.ts.new", "onlyAdded")];
    const { pairs, residualRemoved, residualAdded } = stageBMatch(removed, added, AV);
    expect(pairs).toHaveLength(0);
    expect(residualRemoved).toHaveLength(1);
    expect(residualAdded).toHaveLength(1);
  });
});

function edge(
  change_kind: EdgeDiffRow["change_kind"],
  source: string,
  relation: Relation,
  destination: string
): EdgeDiffRow {
  return {
    change_kind,
    source,
    relation,
    destination,
    before_origin: null,
    before_confidence: null,
    before_resolution: null,
    after_origin: null,
    after_confidence: null,
    after_resolution: null
  };
}

function pair(removed: GraphNode, added: GraphNode): NodePairCandidate {
  return { removed, added, basis: [], stage: "A" };
}

describe("coalesceEdges", () => {
  it("absorbs an added+removed edge that differ only by a moved endpoint (fixture-04 imports shape)", () => {
    // task.ts imports helper.ts, which moved legacy→helpers.
    const removedHelper = node("file", "src/legacy/helper.ts", "h");
    const addedHelper = node("file", "src/helpers/helper.ts", "h");
    const rawEdges = [
      edge("removed", "src/task.ts", "imports", "src/legacy/helper.ts"),
      edge("added", "src/task.ts", "imports", "src/helpers/helper.ts")
    ];
    const { edgePairs, residualAddedRowIndexes, residualRemovedRowIndexes } = coalesceEdges(rawEdges, [
      pair(removedHelper, addedHelper)
    ]);
    expect(edgePairs).toHaveLength(1);
    expect(edgePairs[0]).toMatchObject({ removedRowIndex: 0, addedRowIndex: 1, relation: "imports" });
    expect(residualAddedRowIndexes).toEqual([]);
    expect(residualRemovedRowIndexes).toEqual([]);
  });

  it("leaves a genuinely new edge as residual added (no moved endpoint)", () => {
    const removedHelper = node("file", "src/legacy/helper.ts", "h");
    const addedHelper = node("file", "src/helpers/helper.ts", "h");
    const rawEdges = [
      edge("removed", "src/task.ts", "imports", "src/legacy/helper.ts"),
      edge("added", "src/task.ts", "imports", "src/helpers/helper.ts"),
      edge("added", "src/task.ts", "calls", "src/notifier.ts.Notifier.send") // genuinely new
    ];
    const { edgePairs, residualAddedRowIndexes } = coalesceEdges(rawEdges, [pair(removedHelper, addedHelper)]);
    expect(edgePairs).toHaveLength(1);
    expect(residualAddedRowIndexes).toEqual([2]);
  });

  it("does not coalesce an edge whose endpoints did not move", () => {
    const rawEdges = [
      edge("removed", "src/a.ts", "calls", "src/b.ts.foo"),
      edge("added", "src/a.ts", "calls", "src/c.ts.bar")
    ];
    const { edgePairs, residualAddedRowIndexes, residualRemovedRowIndexes } = coalesceEdges(rawEdges, []);
    expect(edgePairs).toHaveLength(0);
    expect(residualAddedRowIndexes).toEqual([1]);
    expect(residualRemovedRowIndexes).toEqual([0]);
  });
});

describe("buildCoalescedChanges", () => {
  it("emits a move row for a pure path change with its absorbing edge indexes", () => {
    const removedHelper = node("file", "src/legacy/helper.ts", "h");
    const addedHelper = node("file", "src/helpers/helper.ts", "h");
    const rawEdges = [
      edge("removed", "src/task.ts", "imports", "src/legacy/helper.ts"),
      edge("added", "src/task.ts", "imports", "src/helpers/helper.ts")
    ];
    const nodePairs = [pair(removedHelper, addedHelper)];
    const { edgePairs } = coalesceEdges(rawEdges, nodePairs);
    const changes = buildCoalescedChanges(nodePairs, edgePairs, rawEdges);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("move"); // basename helper.ts unchanged → move
    expect(changes[0]?.fromKey).toBe(removedHelper.entityKey);
    expect(changes[0]?.toKey).toBe(addedHelper.entityKey);
    expect(changes[0]?.rawRowIndexes).toEqual([0, 1]);
  });

  it("emits a rename row when the trailing name changed", () => {
    const removedM = node("method", "src/formatter.ts.Formatter.formatValue", "m");
    const addedM = node("method", "src/formatter.ts.Formatter.renderValue", "m");
    const changes = buildCoalescedChanges([pair(removedM, addedM)], [], []);
    expect(changes[0]?.kind).toBe("rename");
  });
});
