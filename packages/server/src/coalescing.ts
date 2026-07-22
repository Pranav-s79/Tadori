import type { GraphNode, Relation } from "@tadori/core";
import type { EdgeDiffRow } from "@tadori/store";

/**
 * Rename/move coalescing — Stage A / Stage B node matchers (09-02).
 *
 * Pure, additive presentation transform over an already-computed raw diff.
 * Raw rows are never deleted; coalescing only *pairs* removed+added nodes that
 * are the same entity moved or renamed. It NEVER claims certainty — a pair is
 * always "moved or renamed — likely".
 *
 * Contract deviation from the blueprint (ASSUMPTION): the blueprint typed the
 * matchers over `ToolNode`, but `ToolNode` carries no `bodyHash`,
 * `unqualifiedName`, or `analyzerVersion`. `bodyHash` lives on `GraphNode`;
 * `unqualifiedName` is derived from `qualifiedName` (last path/dot segment);
 * `analyzerVersion` is snapshot-level and is threaded in as an argument. The
 * matchers therefore operate on `GraphNode` + an `analyzerVersion` string.
 *
 * The recursive-self-reference Stage-B miss is preserved BY CONSTRUCTION: Stage
 * B keys on `bodyHash`, which the frozen extractor computes over the
 * declaration text (including self-calls by name); renaming a recursive
 * function changes its own name at the self-call site, so its body hash changes
 * and it cannot Stage-B match. This is intentional (tadori-indexer SKILL.md
 * lines 18-20) and must never be worked around by normalizing identifiers
 * before hashing.
 */

export interface NodePairCandidate {
  removed: GraphNode;
  added: GraphNode;
  basis: string[];
  stage: "A" | "B";
}

export interface AmbiguousNodeGroup {
  candidates: GraphNode[];
  reason: string;
}

const STAGE_A_BASIS = ["kind", "unqualifiedName", "bodyHash", "analyzerVersion"] as const;
const STAGE_B_BASIS = ["kind", "bodyHash", "analyzerVersion", "uniqueCandidate"] as const;

/**
 * The last path or dot segment of a qualifiedName — the name that stays
 * invariant under a pure move (path changes) but not under a rename.
 * `src/legacy/helper.ts` → `helper.ts`; `a/b.ts.Foo.bar` → `bar`.
 */
export function unqualifiedName(node: GraphNode): string {
  const afterSlash = node.qualifiedName.slice(node.qualifiedName.lastIndexOf("/") + 1);
  // File/package nodes keep the basename (has a dotted extension); symbol nodes
  // take the trailing dot-segment. Files are distinguished by kind.
  if (node.kind === "file" || node.kind === "package") {
    return afterSlash;
  }
  return afterSlash.slice(afterSlash.lastIndexOf(".") + 1);
}

/**
 * Stage A: identity-basis match. A removed node and an added node pair when
 * kind + unqualifiedName + bodyHash + analyzerVersion are all equal AND the
 * pairing is unique (exactly one candidate on each side of the basis key).
 * Non-unique groups are left for Stage B / ambiguity handling.
 */
export function stageAMatch(
  removedNodes: readonly GraphNode[],
  addedNodes: readonly GraphNode[],
  analyzerVersion: string
): { pairs: NodePairCandidate[]; remainingRemoved: GraphNode[]; remainingAdded: GraphNode[] } {
  const keyOf = (n: GraphNode): string | null =>
    n.bodyHash === null ? null : [n.kind, unqualifiedName(n), n.bodyHash, analyzerVersion].join(" ");

  const removedByKey = groupByKey(removedNodes, keyOf);
  const addedByKey = groupByKey(addedNodes, keyOf);

  const pairs: NodePairCandidate[] = [];
  const pairedRemoved = new Set<GraphNode>();
  const pairedAdded = new Set<GraphNode>();

  for (const [key, removedGroup] of removedByKey) {
    const addedGroup = addedByKey.get(key);
    if (!addedGroup) {
      continue;
    }
    // Unique on both sides → a confident Stage-A pair.
    if (removedGroup.length === 1 && addedGroup.length === 1) {
      const removed = removedGroup[0];
      const added = addedGroup[0];
      if (removed && added) {
        pairs.push({ removed, added, basis: [...STAGE_A_BASIS], stage: "A" });
        pairedRemoved.add(removed);
        pairedAdded.add(added);
      }
    }
    // Non-unique: leave both groups for Stage B (which folds in uniqueness) or
    // ambiguity handling — never guess a pairing here.
  }

  return {
    pairs,
    remainingRemoved: removedNodes.filter((n) => !pairedRemoved.has(n)),
    remainingAdded: addedNodes.filter((n) => !pairedAdded.has(n))
  };
}

/**
 * Stage B: applied only to Stage-A residuals. Pairs a removed and an added node
 * when kind + bodyHash + analyzerVersion match and exactly one candidate
 * remains on each side (the `uniqueCandidate` basis element). When 2+ residual
 * candidates share a body-hash key, none are paired — they become one
 * AmbiguousNodeGroup (raw fallback + reason), never a "best guess".
 */
export function stageBMatch(
  remainingRemoved: readonly GraphNode[],
  remainingAdded: readonly GraphNode[],
  analyzerVersion: string
): {
  pairs: NodePairCandidate[];
  ambiguousGroups: AmbiguousNodeGroup[];
  residualRemoved: GraphNode[];
  residualAdded: GraphNode[];
} {
  const keyOf = (n: GraphNode): string | null =>
    n.bodyHash === null ? null : [n.kind, n.bodyHash, analyzerVersion].join(" ");

  const removedByKey = groupByKey(remainingRemoved, keyOf);
  const addedByKey = groupByKey(remainingAdded, keyOf);

  const pairs: NodePairCandidate[] = [];
  const ambiguousGroups: AmbiguousNodeGroup[] = [];
  const pairedRemoved = new Set<GraphNode>();
  const pairedAdded = new Set<GraphNode>();

  for (const [key, removedGroup] of removedByKey) {
    const addedGroup = addedByKey.get(key);
    if (!addedGroup) {
      continue;
    }
    if (removedGroup.length === 1 && addedGroup.length === 1) {
      const removed = removedGroup[0];
      const added = addedGroup[0];
      if (removed && added) {
        pairs.push({ removed, added, basis: [...STAGE_B_BASIS], stage: "B" });
        pairedRemoved.add(removed);
        pairedAdded.add(added);
      }
    } else {
      // 2+ candidates share a body hash → cannot disambiguate. Report, don't guess.
      const candidates = [...removedGroup, ...addedGroup];
      const hash = candidates[0]?.bodyHash ?? "unknown";
      ambiguousGroups.push({
        candidates,
        reason: `${removedGroup.length} removed and ${addedGroup.length} added node(s) share bodyHash ${hash}; cannot disambiguate — shown as raw add/remove`
      });
      for (const n of removedGroup) {
        pairedRemoved.add(n);
      }
      for (const n of addedGroup) {
        pairedAdded.add(n);
      }
    }
  }

  return {
    pairs,
    ambiguousGroups,
    residualRemoved: remainingRemoved.filter((n) => !pairedRemoved.has(n)),
    residualAdded: remainingAdded.filter((n) => !pairedAdded.has(n))
  };
}

/**
 * A raw added+removed edge pair that collapses because its endpoints are
 * covered by node pairs (a moved/renamed endpoint). Indexes reference the raw
 * `edges` array positions so the UI can expand back to the underlying rows.
 */
export interface EdgePair {
  removedRowIndex: number;
  addedRowIndex: number;
  relation: Relation;
}

/**
 * One coalesced presentation row (ARCHITECTURE.md §9). Additive over the raw
 * `edges` array — never a replacement. `rawRowIndexes` always point into that
 * same raw array.
 */
export interface CoalescedChange {
  kind: "rename" | "move";
  fromKey: string | null;
  toKey: string | null;
  rawRowIndexes: number[];
}

/**
 * Coalesce raw added/removed edge rows using the node pairs. A removed edge and
 * an added edge pair when applying the node-pair (removed→added qualifiedName)
 * substitution to the removed edge's endpoints yields the added edge's
 * (source, relation, destination). At least one endpoint must be a paired node
 * — an edge with no moved endpoint is a genuine add/remove, never coalesced.
 * Residual indexes are the added/removed rows not absorbed by any edge pair.
 */
export function coalesceEdges(
  rawEdges: readonly EdgeDiffRow[],
  nodePairs: readonly NodePairCandidate[]
): {
  edgePairs: EdgePair[];
  residualAddedRowIndexes: number[];
  residualRemovedRowIndexes: number[];
} {
  // removed-qualifiedName → added-qualifiedName endpoint substitution.
  const rename = new Map<string, string>();
  for (const pair of nodePairs) {
    rename.set(pair.removed.qualifiedName, pair.added.qualifiedName);
  }
  const subst = (name: string): string => rename.get(name) ?? name;

  // Index added edges by their (src|relation|dst) key → row indexes.
  const addedByKey = new Map<string, number[]>();
  rawEdges.forEach((edge, index) => {
    if (edge.change_kind !== "added") {
      return;
    }
    const key = `${edge.source} ${edge.relation} ${edge.destination}`;
    const group = addedByKey.get(key) ?? [];
    group.push(index);
    addedByKey.set(key, group);
  });

  const edgePairs: EdgePair[] = [];
  const consumedAdded = new Set<number>();
  const consumedRemoved = new Set<number>();

  rawEdges.forEach((edge, removedIndex) => {
    if (edge.change_kind !== "removed") {
      return;
    }
    const newSrc = subst(edge.source);
    const newDst = subst(edge.destination);
    // No endpoint moved → not a coalescing candidate; stays a genuine removal.
    if (newSrc === edge.source && newDst === edge.destination) {
      return;
    }
    const key = `${newSrc} ${edge.relation} ${newDst}`;
    const candidates = addedByKey.get(key);
    const addedIndex = candidates?.find((i) => !consumedAdded.has(i));
    if (addedIndex === undefined) {
      return;
    }
    consumedAdded.add(addedIndex);
    consumedRemoved.add(removedIndex);
    edgePairs.push({ removedRowIndex: removedIndex, addedRowIndex: addedIndex, relation: edge.relation });
  });

  const residualAddedRowIndexes: number[] = [];
  const residualRemovedRowIndexes: number[] = [];
  rawEdges.forEach((edge, index) => {
    if (edge.change_kind === "added" && !consumedAdded.has(index)) {
      residualAddedRowIndexes.push(index);
    } else if (edge.change_kind === "removed" && !consumedRemoved.has(index)) {
      residualRemovedRowIndexes.push(index);
    }
  });

  return { edgePairs, residualAddedRowIndexes, residualRemovedRowIndexes };
}

/**
 * Build the coalesced presentation rows: one per node pair (rename vs. move by
 * whether the unqualified name changed), each carrying the raw edge-row indexes
 * that pair references it as an endpoint. Node pairs come first (the headline
 * "moved/renamed" rows), each collecting its absorbing edge-pair row indexes.
 */
export function buildCoalescedChanges(
  nodePairs: readonly NodePairCandidate[],
  edgePairs: readonly EdgePair[],
  rawEdges: readonly EdgeDiffRow[]
): CoalescedChange[] {
  return nodePairs.map((pair) => {
    const removedName = pair.removed.qualifiedName;
    const addedName = pair.added.qualifiedName;
    // Rename = the trailing name changed; move = only the path changed.
    const kind: "rename" | "move" =
      unqualifiedName(pair.removed) === unqualifiedName(pair.added) ? "move" : "rename";

    // Raw edge rows whose endpoints touch this node pair (either side).
    const rawRowIndexes: number[] = [];
    for (const ep of edgePairs) {
      const removedEdge = rawEdges[ep.removedRowIndex];
      const addedEdge = rawEdges[ep.addedRowIndex];
      const touches =
        removedEdge !== undefined &&
        (removedEdge.source === removedName || removedEdge.destination === removedName);
      const touchesAdded =
        addedEdge !== undefined &&
        (addedEdge.source === addedName || addedEdge.destination === addedName);
      if (touches || touchesAdded) {
        rawRowIndexes.push(ep.removedRowIndex, ep.addedRowIndex);
      }
    }

    return {
      kind,
      fromKey: pair.removed.entityKey,
      toKey: pair.added.entityKey,
      rawRowIndexes: [...new Set(rawRowIndexes)].sort((a, b) => a - b)
    };
  });
}

/** Group nodes by a string key, skipping any whose key is null. */
function groupByKey(
  nodes: readonly GraphNode[],
  keyOf: (n: GraphNode) => string | null
): Map<string, GraphNode[]> {
  const map = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = keyOf(node);
    if (key === null) {
      continue;
    }
    const group = map.get(key) ?? [];
    group.push(node);
    map.set(key, group);
  }
  return map;
}
