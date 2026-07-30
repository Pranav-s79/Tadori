import { z } from "zod";
import {
  confidenceSchema,
  evidenceKindSchema,
  nodeKindSchema,
  originSchema,
  relationSchema,
  repoStateKindSchema,
  resolutionSchema
} from "./enums.js";

export const EXTRACTION_CAPABILITIES = ["semantic", "structural", "repository"] as const;
export type ExtractionCapability = (typeof EXTRACTION_CAPABILITIES)[number];
export const extractionCapabilitySchema = z.enum(EXTRACTION_CAPABILITIES);

export const EXTRACTION_DERIVATIONS = [
  "compiler-resolved",
  "parser-derived",
  "convention-derived",
  "repository-derived",
  "inferred"
] as const;
export type ExtractionDerivation = (typeof EXTRACTION_DERIVATIONS)[number];
export const extractionDerivationSchema = z.enum(EXTRACTION_DERIVATIONS);

/** Additive per-item attribution. Legacy snapshots legitimately omit it. */
export const extractionProvenanceSchema = z.object({
  extractorId: z.string().min(1),
  extractorVersion: z.string().min(1),
  capability: extractionCapabilitySchema,
  derivation: extractionDerivationSchema,
  unresolvedReason: z.string().min(1).nullable()
});
export type ExtractionProvenance = z.infer<typeof extractionProvenanceSchema>;

export const snapshotExtractorSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  capability: extractionCapabilitySchema,
  languages: z.array(z.string().min(1)).min(1)
});
export type SnapshotExtractor = z.infer<typeof snapshotExtractorSchema>;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64-char lowercase hex");
const oneBasedLine = z.number().int().min(1);
const projectPath = z.string().min(1).refine(
  (value) => value === "." || (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  ),
  "expected a normalized repository-relative path or '.'"
);

/** One extractor-discovered, language-neutral project in a snapshot. */
export const graphProjectSchema = z.object({
  projectId: hex64,
  root: projectPath,
  manifest: projectPath.nullable(),
  kind: z.string().regex(/^[a-z][a-z0-9_-]*$/, "expected a stable lowercase project kind"),
  name: z.string().min(1).nullable(),
  languages: z.array(z.string().min(1)).min(1).superRefine((languages, context) => {
    if (new Set(languages).size !== languages.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "project languages must be unique" });
    }
    const sorted = [...languages].sort((left, right) => left.localeCompare(right));
    if (languages.some((language, index) => language !== sorted[index])) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "project languages must be sorted" });
    }
  })
});
export type GraphProject = z.infer<typeof graphProjectSchema>;

/** One evidence anchor: repository-relative file plus one-based line range. */
export const evidenceSchema = z
  .object({
    file: z.string().min(1),
    kind: evidenceKindSchema,
    lineStart: oneBasedLine,
    lineEnd: oneBasedLine,
    columnStart: z.number().int().min(1).optional(),
    columnEnd: z.number().int().min(1).optional(),
    commitSha: z.string().optional(),
    excerptHash: hex64.optional()
  })
  .refine((e) => e.lineEnd >= e.lineStart, {
    message: "lineEnd must be >= lineStart"
  });
export type Evidence = z.infer<typeof evidenceSchema>;

/** One file participating in a snapshot (stable file entity + membership data). */
export const graphFileSchema = z.object({
  path: z.string().min(1),
  normalizedPath: z.string().min(1),
  originIdentity: z.string().min(1),
  fileKey: hex64,
  packageName: z.string().nullable(),
  language: z.string().nullable(),
  contentHash: hex64,
  sizeBytes: z.number().int().min(0),
  isGenerated: z.boolean(),
  isBinary: z.boolean()
});
export type GraphFile = z.infer<typeof graphFileSchema>;

/** One graph node (stable identity + snapshot membership data). */
export const graphNodeSchema = z.object({
  kind: nodeKindSchema,
  qualifiedName: z.string().min(1),
  displayName: z.string().min(1),
  canonicalIdentity: z.string().min(1),
  entityKey: hex64,
  /** Normalized path of the containing file, or null (package/external nodes). */
  file: z.string().nullable(),
  exported: z.boolean(),
  spanStart: z.number().int().min(0).nullable(),
  spanEnd: z.number().int().min(0).nullable(),
  lineStart: oneBasedLine.nullable(),
  lineEnd: oneBasedLine.nullable(),
  signature: z.string().nullable(),
  bodyHash: hex64.nullable(),
  evidence: z.array(evidenceSchema),
  /** Additive metadata; absent only for snapshots written before migration 7. */
  language: z.string().min(1).nullable().optional(),
  provenance: extractionProvenanceSchema.optional()
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

/** One graph edge (stable identity + snapshot membership data). */
export const graphEdgeSchema = z.object({
  srcEntityKey: hex64,
  relation: relationSchema,
  dstEntityKey: hex64,
  canonicalIdentity: z.string().min(1),
  entityKey: hex64,
  origin: originSchema,
  confidence: confidenceSchema,
  resolution: resolutionSchema,
  evidence: z.array(evidenceSchema),
  /** Additive metadata; absent only for snapshots written before migration 7. */
  language: z.string().min(1).nullable().optional(),
  provenance: extractionProvenanceSchema.optional()
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

/** A complete extracted snapshot graph ready for storage. */
export const snapshotGraphSchema = z.object({
  repoRootPath: z.string().min(1),
  kind: repoStateKindSchema,
  label: z.string().nullable(),
  baseCommitSha: z.string().nullable(),
  workspaceHash: hex64,
  analyzerVersion: z.string().min(1),
  files: z.array(graphFileSchema),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  /** Extractor-discovered projects. Missing in legacy serialized snapshots. */
  projects: z.array(graphProjectSchema).default([]),
  /** Extractors that contributed to this snapshot, sorted by id then version. */
  extractors: z.array(snapshotExtractorSchema).optional()
});
/** Legacy serialized input may omit projects; parsing materializes `projects: []`. */
export type SnapshotGraphInput = z.input<typeof snapshotGraphSchema>;
export type SnapshotGraph = z.infer<typeof snapshotGraphSchema>;
