export type LodLevel = "package" | "file" | "symbol";

/** Frozen 08-10 server response ceilings. The server is authoritative. */
export const LOD_NODE_RESPONSE_CAPS: Readonly<Record<LodLevel, number>> = {
  package: 500,
  file: 500,
  symbol: 1_000
};

export const LOD_EDGE_RESPONSE_CAP = 1_000;
export const DEFAULT_GRAPH_PAGE_LIMIT = 100;

export function clampResponseLimit(raw: unknown, maximum: number): number | null {
  if (raw === undefined) return DEFAULT_GRAPH_PAGE_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  return Math.min(value, maximum);
}
