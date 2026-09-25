/**
 * Height on the 3D Atlas binds to exactly one named field: the abstraction
 * level a node was fetched at (`GET /api/v1/nodes?level=...`, the same enum
 * `layout_positions.abstraction_level` is CHECK-constrained to). It is computed
 * here, client-side, and never read from a server-provided `z` (blueprint 10-01,
 * decisions A and B).
 */
export type AbstractionLevel = "package" | "file" | "symbol";

export const LEVEL_DEPTH_ORDER: Readonly<Record<AbstractionLevel, number>> = {
  package: 0,
  file: 1,
  symbol: 2
};

export function depthOffsetForLevel(level: AbstractionLevel, depthUnit = 40): number {
  return LEVEL_DEPTH_ORDER[level] * depthUnit;
}
