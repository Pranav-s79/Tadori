export type LodLevel = "package" | "file" | "symbol";

export interface LevelBudget {
  nodes: number;
  edges: number;
}

/** Frozen 08-10 client request/acceptance ceilings (server remains authoritative). */
export const LOD_BUDGETS: Readonly<Record<LodLevel, LevelBudget>> = {
  package: { nodes: 500, edges: 1_000 },
  file: { nodes: 500, edges: 1_000 },
  symbol: { nodes: 1_000, edges: 1_000 }
};

export const LABEL_BUDGET = { minRadiusPx: 6, maxSimultaneous: 200 } as const;

export function clampLodRequestLimit(
  level: LodLevel,
  kind: "nodes" | "edges",
  requested?: number
): number {
  const maximum = LOD_BUDGETS[level][kind];
  if (requested === undefined) return maximum;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`LOD ${kind} limit must be a positive integer`);
  }
  return Math.min(requested, maximum);
}

export function assertLodResponseWithinBudget(
  level: LodLevel,
  kind: "nodes" | "edges",
  itemCount: number
): void {
  const maximum = LOD_BUDGETS[level][kind];
  if (itemCount > maximum) {
    throw new Error(
      `${level} ${kind} response contained ${String(itemCount)} items; budget is ${String(maximum)}`
    );
  }
}

export interface LabelCandidate {
  entityKey: string;
  radiusPx: number;
  /**
   * The selected/focused node. Its label always shows, so it skips the size
   * floor and takes the first of the capped slots rather than a 201st.
   */
  pinned?: boolean;
}

/** Deterministic defense against label hairballs: footprint first, then hard cap. */
export function visibleLabelEntityKeys(candidates: readonly LabelCandidate[]): string[] {
  return candidates
    .filter((candidate) => candidate.pinned === true || candidate.radiusPx >= LABEL_BUDGET.minRadiusPx)
    .sort((left, right) =>
      Number(right.pinned === true) - Number(left.pinned === true)
      || right.radiusPx - left.radiusPx
      || left.entityKey.localeCompare(right.entityKey)
    )
    .slice(0, LABEL_BUDGET.maxSimultaneous)
    .map((candidate) => candidate.entityKey);
}
