import type { NodeKind, Relation } from "@tadori/core";

/**
 * Week 3 milestone scope (semantic extraction). Everything outside this subset
 * is explicitly deferred and must be reported, never silently discarded.
 */
export const SUPPORTED_RELATIONS: readonly Relation[] = [
  "contains",
  "imports",
  "exports",
  "references",
  "calls",
  "implements",
  "extends",
  "tests",
  "routes_to",
  "documents"
];

export const SUPPORTED_NODE_KINDS: readonly NodeKind[] = [
  "package",
  "file",
  "function",
  "method",
  "class",
  "interface",
  "type",
  "external_dep",
  "route",
  "test",
  "adr",
  "unresolved"
];

/** Later-milestone relations (Week 9 review mode). */
export const DEFERRED_RELATIONS: readonly Relation[] = ["changed_with"];

/** Node kinds no fixture covers yet (doc sections are later work). */
export const DEFERRED_NODE_KINDS: readonly NodeKind[] = ["doc_section"];

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
