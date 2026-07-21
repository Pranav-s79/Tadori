import { describe, expect, it } from "vitest";
import type { EdgeDiffRow } from "@tadori/store";
import type { ToolNode } from "@tadori/mcp";
import {
  paginateReviewDiff,
  parseReviewCursor,
  parseReviewLimit,
  type ReviewDiffPageInput
} from "../src/reviewDiffAssembly.js";

function node(key: string): ToolNode {
  return {
    entityKey: key,
    kind: "function",
    qualifiedName: `pkg/${key}`,
    displayName: key,
    file: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: true,
    fanIn: 0,
    representation: "name",
    body: null,
    evidence: [],
    evidenceOmittedCount: 0,
    freshness: "fresh",
    stale: false,
    staleReason: "matches_snapshot"
  } as ToolNode;
}

function edge(source: string): EdgeDiffRow {
  return {
    change_kind: "added",
    source,
    relation: "calls",
    destination: "z",
    before_origin: null,
    before_confidence: null,
    before_resolution: null,
    after_origin: "compiler",
    after_confidence: "certain",
    after_resolution: "resolved"
  };
}

function input(added: number, removed: number, edges: number): ReviewDiffPageInput {
  return {
    nodesAdded: Array.from({ length: added }, (_, i) => node(`a${i}`)),
    nodesRemoved: Array.from({ length: removed }, (_, i) => node(`r${i}`)),
    edges: Array.from({ length: edges }, (_, i) => edge(`e${i}`))
  };
}

describe("parseReviewCursor / parseReviewLimit", () => {
  it("defaults cursor to 0 and rejects non-integers", () => {
    expect(parseReviewCursor(undefined)).toBe(0);
    expect(parseReviewCursor("12")).toBe(12);
    expect(parseReviewCursor("-1")).toBeNull();
    expect(parseReviewCursor("x")).toBeNull();
  });

  it("defaults limit and enforces the 1..MAX range", () => {
    expect(parseReviewLimit(undefined)).toBe(500);
    expect(parseReviewLimit("10")).toBe(10);
    expect(parseReviewLimit("0")).toBeNull();
    expect(parseReviewLimit("999999")).toBeNull();
  });
});

describe("paginateReviewDiff", () => {
  it("returns the whole diff and a null cursor when it fits in one page", () => {
    const page = paginateReviewDiff(input(2, 1, 3), 0, 500);
    expect(page.nodesAdded).toHaveLength(2);
    expect(page.nodesRemoved).toHaveLength(1);
    expect(page.edges).toHaveLength(3);
    expect(page.nodesAddedOmitted).toBe(0);
    expect(page.nodesRemovedOmitted).toBe(0);
    expect(page.edgesOmitted).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it("reports per-list omitted counts and a nextCursor on a partial first page", () => {
    // 2 added + 2 removed + 2 edges = 6 total; limit 3 → first page is the 2
    // added + 1 removed; the other removed + both edges are omitted.
    const page = paginateReviewDiff(input(2, 2, 2), 0, 3);
    expect(page.nodesAdded).toHaveLength(2);
    expect(page.nodesRemoved).toHaveLength(1);
    expect(page.edges).toHaveLength(0);
    expect(page.nodesAddedOmitted).toBe(0);
    expect(page.nodesRemovedOmitted).toBe(1);
    expect(page.edgesOmitted).toBe(2);
    expect(page.nextCursor).toBe("3");
  });

  it("reconstructs the full diff across pages with zero duplicate or missing rows", () => {
    const data = input(3, 3, 4); // 10 total
    const seenAdded = new Set<string>();
    const seenRemoved = new Set<string>();
    const seenEdges = new Set<string>();
    let cursor: string | null = "0";
    let pages = 0;
    while (cursor !== null) {
      const offset: number = parseReviewCursor(cursor) ?? 0;
      const page = paginateReviewDiff(data, offset, 3);
      page.nodesAdded.forEach((n) => seenAdded.add(n.entityKey));
      page.nodesRemoved.forEach((n) => seenRemoved.add(n.entityKey));
      page.edges.forEach((e) => seenEdges.add(e.source));
      cursor = page.nextCursor;
      pages += 1;
      if (pages > 20) {
        throw new Error("pagination did not terminate");
      }
    }
    expect(seenAdded.size).toBe(3);
    expect(seenRemoved.size).toBe(3);
    expect(seenEdges.size).toBe(4);
    expect(pages).toBe(4); // ceil(10 / 3)
  });

  it("handles an empty diff", () => {
    const page = paginateReviewDiff(input(0, 0, 0), 0, 500);
    expect(page.nextCursor).toBeNull();
    expect(page.nodesAdded).toEqual([]);
    expect(page.edgesOmitted).toBe(0);
  });
});
