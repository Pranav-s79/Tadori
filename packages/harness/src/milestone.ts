import type { NodeKind, Relation } from "@tadori/core";

/**
 * Weeks 1-2 milestone scope. Everything outside this subset is explicitly
 * deferred and must be reported, never silently discarded.
 */
export const SUPPORTED_RELATIONS: readonly Relation[] = ["contains", "imports", "exports"];

export const SUPPORTED_NODE_KINDS: readonly NodeKind[] = [
  "package",
  "file",
  "function",
  "method",
  "class",
  "interface",
  "type",
  "external_dep"
];

/** Later-milestone relations the fixtures cover but Weeks 1-2 defer. */
export const DEFERRED_RELATIONS: readonly Relation[] = [
  "references",
  "calls",
  "implements",
  "extends",
  "tests",
  "routes_to",
  "documents",
  "changed_with"
];

/** Node kinds owned by deferred extractors (routes, tests, ADRs, call graph). */
export const DEFERRED_NODE_KINDS: readonly NodeKind[] = [
  "route",
  "test",
  "adr",
  "doc_section",
  "unresolved"
];

export function isSupportedRelation(relation: Relation): boolean {
  return SUPPORTED_RELATIONS.includes(relation);
}

export function isSupportedNodeKind(kind: NodeKind): boolean {
  return SUPPORTED_NODE_KINDS.includes(kind);
}

export function isDeferredRelation(relation: Relation): boolean {
  return DEFERRED_RELATIONS.includes(relation);
}

export function isDeferredNodeKind(kind: NodeKind): boolean {
  return DEFERRED_NODE_KINDS.includes(kind);
}
