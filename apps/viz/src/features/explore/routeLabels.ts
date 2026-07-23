import type { Origin } from "../../api/types.ts";
import type { ExploreNode } from "./exploreApi.ts";

/**
 * Honesty label for how a route's path was obtained, derived from the origin of
 * its provenance. `compiler` = literal path read from a route-registration call;
 * `heuristic` = a path derived by convention (e.g. Next.js file routing). We
 * never invent a "path source" node field — origin already carries this.
 *
 * The switch is exhaustive over the 6 frozen origins with no `default`, so a new
 * origin fails typecheck rather than being silently mislabeled.
 */
export function pathSourceLabel(origin: Origin): string {
  switch (origin) {
    case "compiler":
      return "path source: direct";
    case "heuristic":
      return "path source: derived (heuristic)";
    case "doc":
      return "path source: documented, not code-extracted";
    case "git":
      return "path source: derived from history";
    case "human":
      return "path source: human-annotated";
    case "llm":
      return "path source: LLM-derived";
  }
}

const METHOD_PATTERN =
  /\b(?:app|router)\.(get|post|put|delete|patch)\b|\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\b/i;

/**
 * Best-effort HTTP method label from a route node's signature/qualifiedName,
 * derived client-side (no frozen field carries it). Returns "unknown" — never a
 * blank, never a guessed method — when no recognizable Express/Next convention
 * is present, so the column reads "checked, couldn't tell" rather than "forgot".
 */
export function deriveMethodLabel(node: ExploreNode): string {
  const haystack = `${node.signature ?? ""} ${node.qualifiedName} ${node.displayName}`;
  const match = METHOD_PATTERN.exec(haystack);
  const verb = match?.[1] ?? match?.[2];
  return verb !== undefined ? verb.toUpperCase() : "unknown";
}
