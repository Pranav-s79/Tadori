import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiffBadgeOverlay,
  changedEntityKeys,
  type BadgePosition
} from "../src/features/review/DiffBadgeOverlay.tsx";
import type { AccumulatedDiff } from "../src/features/review/useReviewDiffStore.ts";
import type { ReviewDiffNode } from "../src/features/review/reviewDiffApi.ts";
import { mockContext } from "./mockServer.ts";

afterEach(cleanup);

function node(entityKey: string): ReviewDiffNode {
  return {
    entityKey,
    kind: "function",
    qualifiedName: entityKey,
    displayName: entityKey,
    file: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: true,
    fanIn: 0,
    evidence: [],
    evidenceOmittedCount: 0,
    freshness: "fresh",
    stale: false,
    staleReason: null
  };
}

function diff(over: Partial<AccumulatedDiff> = {}): AccumulatedDiff {
  return {
    context: mockContext,
    base: { id: 1, kind: "snapshot", label: "base", baseCommitSha: null, workspaceHash: null, pinned: false, status: "sealed", createdAt: null },
    head: { id: 2, kind: "snapshot", label: "head", baseCommitSha: null, workspaceHash: null, pinned: false, status: "sealed", createdAt: null },
    nodesAdded: [],
    nodesRemoved: [],
    edges: [],
    nodesAddedOmitted: 0,
    nodesRemovedOmitted: 0,
    edgesOmitted: 0,
    presentation: "raw",
    coalesced: undefined,
    ambiguousGroups: undefined,
    ...over
  };
}

describe("DiffBadgeOverlay placement (positions read verbatim)", () => {
  it("places a badge at the exact passed-in coordinate for each changed node", () => {
    const positions = new Map<string, BadgePosition>([
      ["a", { x: 12, y: 34 }],
      ["b", { x: 56, y: 78 }]
    ]);
    render(<DiffBadgeOverlay page={diff({ nodesAdded: [node("a")], nodesRemoved: [node("b")] })} positions={positions} />);
    const added = screen.getByRole("button", { name: /added a/ });
    expect(added.style.left).toBe("12px");
    expect(added.style.top).toBe("34px");
    const removed = screen.getByRole("button", { name: /removed b/ });
    expect(removed.style.left).toBe("56px");
    expect(removed.style.top).toBe("78px");
  });

  it("lists nodes with no coordinate as unplaced (never placed at 0,0)", () => {
    const positions = new Map<string, BadgePosition>([["a", { x: 10, y: 20 }]]);
    render(<DiffBadgeOverlay page={diff({ nodesAdded: [node("a"), node("missing")] })} positions={positions} />);
    // Placed: only "a".
    expect(screen.getByRole("button", { name: /added a/ })).toBeInTheDocument();
    // Unplaced: "missing" appears in the unplaced list, and NOT as a positioned badge.
    const unplacedRegion = screen.getByRole("status", { name: "Unplaced diff badges" });
    expect(unplacedRegion).toHaveTextContent(/1 changed node without a layout position/);
    expect(unplacedRegion).toHaveTextContent(/missing/);
    expect(screen.queryByRole("button", { name: /added missing/ })).not.toBeInTheDocument();
  });

  it("shows no unplaced region when every changed node has a coordinate", () => {
    const positions = new Map<string, BadgePosition>([["a", { x: 1, y: 1 }]]);
    render(<DiffBadgeOverlay page={diff({ nodesAdded: [node("a")] })} positions={positions} />);
    expect(screen.queryByRole("status", { name: "Unplaced diff badges" })).not.toBeInTheDocument();
  });

  it("selecting a placed badge inspects its entityKey", () => {
    const onInspect = vi.fn();
    const positions = new Map<string, BadgePosition>([["a", { x: 1, y: 2 }]]);
    render(<DiffBadgeOverlay page={diff({ nodesAdded: [node("a")] })} positions={positions} onInspect={onInspect} />);
    fireEvent.click(screen.getByRole("button", { name: /added a/ }));
    expect(onInspect).toHaveBeenCalledWith("a", "node");
  });

  it("selecting an unplaced badge inspects its entityKey too", () => {
    const onInspect = vi.fn();
    render(<DiffBadgeOverlay page={diff({ nodesRemoved: [node("gone")] })} positions={new Map()} onInspect={onInspect} />);
    fireEvent.click(screen.getByRole("button", { name: /removed: gone/ }));
    expect(onInspect).toHaveBeenCalledWith("gone", "node");
  });
});

describe("changedEntityKeys derivation", () => {
  it("collects added + removed node entityKeys", () => {
    const keys = changedEntityKeys(diff({ nodesAdded: [node("a")], nodesRemoved: [node("b")] }));
    expect([...keys].sort()).toEqual(["a", "b"]);
  });

  it("is empty for a null page", () => {
    expect(changedEntityKeys(null).size).toBe(0);
  });
});

describe("DiffBadgeOverlay runs NO layout engine (zero recompute)", () => {
  it("does not import graphology or sigma in its source module", () => {
    // Resolved from the vitest cwd (apps/viz) rather than import.meta.url, which
    // jsdom does not expose as a file: URL.
    const src = readFileSync(resolve(process.cwd(), "src/features/review/DiffBadgeOverlay.tsx"), "utf8");
    expect(src).not.toMatch(/from\s+["']graphology/);
    expect(src).not.toMatch(/from\s+["']sigma/);
    expect(src).not.toMatch(/forceAtlas|forceLayout|circular\.assign|random\.assign/);
  });
});
