import { z } from "zod";

/** Canonical compatibility vocabulary currently implemented and retained by migration 001. */
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

/** Canonical compatibility vocabulary currently implemented and retained by migration 001. */
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

/** Canonical evidence origins shared by every language extractor. */
export const ORIGINS = ["compiler", "heuristic", "git", "doc", "human", "llm"] as const;
export type Origin = (typeof ORIGINS)[number];
export const originSchema = z.enum(ORIGINS);

/** Canonical coarse confidence values shared by every language extractor. */
export const CONFIDENCES = ["certain", "likely", "inferred"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const confidenceSchema = z.enum(CONFIDENCES);

/** Canonical resolution states shared by every language extractor. */
export const RESOLUTIONS = ["resolved", "partial", "unresolved"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const resolutionSchema = z.enum(RESOLUTIONS);

/** Canonical repository-state kinds. */
export const REPO_STATE_KINDS = ["commit", "working_tree", "staged", "patch"] as const;
export type RepoStateKind = (typeof REPO_STATE_KINDS)[number];
export const repoStateKindSchema = z.enum(REPO_STATE_KINDS);

/** Canonical evidence kinds retained by the active multi-language contract. */
export const EVIDENCE_KINDS = [
  "source",
  "documentation",
  "git",
  "human_annotation",
  "tool_event"
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const evidenceKindSchema = z.enum(EVIDENCE_KINDS);
