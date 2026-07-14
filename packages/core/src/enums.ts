import { z } from "zod";

/** Frozen v2.1 node kinds (migration 001 CHECK constraint). */
export const NODE_KINDS = [
  "package",
  "file",
  "function",
  "method",
  "class",
  "interface",
  "type",
  "route",
  "test",
  "adr",
  "doc_section",
  "external_dep",
  "unresolved"
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const nodeKindSchema = z.enum(NODE_KINDS);

/** Frozen v2.1 edge relations (migration 001 CHECK constraint). */
export const RELATIONS = [
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
  "changed_with"
] as const;
export type Relation = (typeof RELATIONS)[number];
export const relationSchema = z.enum(RELATIONS);

/** Frozen v2.1 edge origins. */
export const ORIGINS = ["compiler", "heuristic", "git", "doc", "human", "llm"] as const;
export type Origin = (typeof ORIGINS)[number];
export const originSchema = z.enum(ORIGINS);

/** Frozen v2.1 coarse confidence enum. */
export const CONFIDENCES = ["certain", "likely", "inferred"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const confidenceSchema = z.enum(CONFIDENCES);

/** Frozen v2.1 resolution enum. */
export const RESOLUTIONS = ["resolved", "partial", "unresolved"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const resolutionSchema = z.enum(RESOLUTIONS);

/** Frozen v2.1 repository-state kinds. */
export const REPO_STATE_KINDS = ["commit", "working_tree", "staged", "patch"] as const;
export type RepoStateKind = (typeof REPO_STATE_KINDS)[number];
export const repoStateKindSchema = z.enum(REPO_STATE_KINDS);

/** Frozen v2.1 evidence kinds (evidence_items CHECK constraint). */
export const EVIDENCE_KINDS = [
  "source",
  "documentation",
  "git",
  "human_annotation",
  "tool_event"
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);
