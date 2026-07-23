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
  "documents",
  // 09-04: git co-change is now extracted (additively, on the live serve path).
  "changed_with"
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

/** No relations remain deferred — `changed_with` was un-deferred in 09-04. */
export const DEFERRED_RELATIONS: readonly Relation[] = [];

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
