import type { GraphNode } from "@tadori/core";

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
