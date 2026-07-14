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

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64-char lowercase hex");
const oneBasedLine = z.number().int().min(1);

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
  evidence: z.array(evidenceSchema)
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
  evidence: z.array(evidenceSchema)
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
  edges: z.array(graphEdgeSchema)
});
export type SnapshotGraph = z.infer<typeof snapshotGraphSchema>;
