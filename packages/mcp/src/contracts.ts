import { z } from "zod";
import {
  confidenceSchema,
  evidenceKindSchema,
  nodeKindSchema,
  originSchema,
  relationSchema,
  repoStateKindSchema,
  resolutionSchema
} from "@tadori/core";

export const TOOL_NAMES = [
  "repo_overview",
  "find_symbol",
  "symbol_context",
  "find_tests",
  "impact",
  "path"
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

const hex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const oneBasedLineSchema = z.number().int().min(1);
const cursorSchema = z.string().regex(/^\d+$/, "cursor must be a decimal offset");

export const freshnessStatusSchema = z.enum(["fresh", "stale", "unknown"]);
export const freshnessReasonSchema = z.enum([
  "matches_snapshot",
  "content_changed",
  "unreadable",
  "outside_repository",
  "not_in_snapshot"
]);

export const toolEvidenceSchema = z
  .object({
    file: z.string().min(1),
    kind: evidenceKindSchema,
    lineStart: oneBasedLineSchema,
    lineEnd: oneBasedLineSchema,
    columnStart: oneBasedLineSchema.nullable(),
    columnEnd: oneBasedLineSchema.nullable(),
    commitSha: z.string().nullable(),
    excerptHash: hex64Schema.nullable()
  })
  .strict();

export const toolNodeSchema = z
  .object({
    entityKey: hex64Schema,
    kind: nodeKindSchema,
    qualifiedName: z.string().min(1),
    displayName: z.string().min(1),
    file: z.string().nullable(),
    lineStart: oneBasedLineSchema.nullable(),
    lineEnd: oneBasedLineSchema.nullable(),
    signature: z.string().nullable(),
    exported: z.boolean(),
    fanIn: z.number().int().min(0),
    representation: z.enum(["body", "signature", "name", "aggregate"]),
    body: z.string().nullable(),
    evidence: z.array(toolEvidenceSchema),
    evidenceOmittedCount: z.number().int().min(0),
    freshness: freshnessStatusSchema,
    stale: z.boolean(),
    staleReason: freshnessReasonSchema
  })
  .strict();

export const toolEdgeSchema = z
  .object({
    entityKey: hex64Schema,
    srcEntityKey: hex64Schema,
    srcQualifiedName: z.string().min(1),
    relation: relationSchema,
    dstEntityKey: hex64Schema,
    dstQualifiedName: z.string().min(1),
    origin: originSchema,
    confidence: confidenceSchema,
    resolution: resolutionSchema,
    evidence: z.array(toolEvidenceSchema),
    evidenceOmittedCount: z.number().int().min(0),
    freshness: freshnessStatusSchema,
    stale: z.boolean(),
    staleReason: freshnessReasonSchema
  })
  .strict();

export const omissionSchema = z
  .object({
    targetKind: z.enum(["node", "edge"]),
    entityKey: hex64Schema,
    rank: z.number().int().min(1),
    score: z.number().nullable(),
    reason: z.string().min(1)
  })
  .strict();

export const aggregateOmissionSchema = z
  .object({
    category: z.string().min(1),
    count: z.number().int().positive(),
    reason: z.string().min(1),
    continuation: z.string().nullable(),
    criticalContextPreserved: z.boolean()
  })
  .strict();

export const responseContextSchema = z
  .object({
    repository: z.string().min(1),
    snapshotId: z.number().int().positive(),
    snapshotKind: repoStateKindSchema,
    baseCommitSha: z.string().nullable(),
    workspaceHash: hex64Schema,
    freshness: freshnessStatusSchema,
    stale: z.boolean(),
    staleReason: freshnessReasonSchema
  })
  .strict();

const responseBaseShape = {
  context: responseContextSchema,
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
  omissions: z.array(omissionSchema).max(100),
  aggregateOmissions: z.array(aggregateOmissionSchema).max(20)
};

export const repoOverviewInputSchema = z.object({}).strict();
export const repoOverviewOutputSchema = z
  .object({
    ...responseBaseShape,
    packages: z.array(
      z
        .object({
          node: toolNodeSchema,
          fileCount: z.number().int().min(0),
          symbolCount: z.number().int().min(0),
          dependencies: z.array(
            z
              .object({
                targetPackage: z.string().min(1),
                direction: z.literal("outgoing"),
                edgeCount: z.number().int().positive()
              })
              .strict()
          ),
          dependencyOmittedCount: z.number().int().min(0),
          loc: z.number().int().min(0).nullable(),
          locStatus: z.literal("unavailable_in_snapshot")
        })
        .strict()
    ),
    routes: z.array(toolNodeSchema),
    entryPoints: z
      .object({
        available: z.boolean(),
        nodes: z.array(toolNodeSchema),
        reason: z.string().nullable()
      })
      .strict(),
    directoryRoles: z.array(
      z
        .object({
          directory: z.string().min(1),
          fileCount: z.number().int().min(0),
          role: z.string().nullable(),
          roleStatus: z.literal("unavailable_in_snapshot")
        })
        .strict()
    ),
    counts: z
      .object({
        files: z.number().int().min(0),
        nodes: z.number().int().min(0),
        edges: z.number().int().min(0),
        relations: z.record(relationSchema, z.number().int().min(0))
      })
      .strict(),
    boundaryRules: z
      .object({
        available: z.boolean(),
        count: z.number().int().min(0),
        reason: z.string().nullable()
      })
      .strict()
  })
  .strict();

export const findSymbolInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    kind: nodeKindSchema.optional(),
    limit: z.number().int().min(1).max(50).default(10),
    cursor: cursorSchema.optional()
  })
  .strict();
export const findSymbolOutputSchema = z
  .object({
    ...responseBaseShape,
    query: z.string(),
    matches: z.array(toolNodeSchema),
    totalMatches: z.number().int().min(0),
    remainderCount: z.number().int().min(0)
  })
  .strict();

export const symbolContextInputSchema = z
  .object({
    anchor: z.string().trim().min(1).max(1000),
    relations: z.array(relationSchema).min(1).max(11),
    depth: z.number().int().min(1).max(2).default(1),
    tokenBudget: z.number().int().min(1_024).max(50_000)
  })
  .strict();
export const symbolContextOutputSchema = z
  .object({
    ...responseBaseShape,
    status: z.enum(["ok", "not_found", "ambiguous"]),
    anchor: toolNodeSchema.nullable(),
    candidates: z.array(toolNodeSchema),
    nodes: z.array(toolNodeSchema),
    edges: z.array(toolEdgeSchema),
    relationGroups: z.array(
      z
        .object({
          relation: relationSchema,
          nodes: z.array(toolNodeSchema),
          edges: z.array(toolEdgeSchema)
        })
        .strict()
    ),
    linkedTests: z.array(toolNodeSchema),
    linkedDocuments: z.array(toolNodeSchema),
    decisionsAvailable: z.boolean(),
    bodySuppressedReason: z.string().nullable()
  })
  .strict();

export const findTestsInputSchema = z
  .object({ target: z.string().trim().min(1).max(1000) })
  .strict();
const testLinkSchema = z
  .object({
    test: toolNodeSchema,
    edge: toolEdgeSchema,
    linkage: z.enum([
      "statically_linked",
      "naming_associated",
      "package_associated",
      "historically_associated",
      "evidence_associated"
    ]),
    runHint: z.string().nullable(),
    runHintStatus: z.literal("unavailable_in_snapshot")
  })
  .strict();
export const findTestsOutputSchema = z
  .object({
    ...responseBaseShape,
    status: z.enum(["ok", "not_found", "ambiguous"]),
    heading: z.literal("Likely relevant tests"),
    message: z.string(),
    target: toolNodeSchema.nullable(),
    candidates: z.array(toolNodeSchema),
    tests: z.array(testLinkSchema)
  })
  .strict();

export const impactInputSchema = z
  .object({
    targets: z.array(z.string().trim().min(1).max(1000)).min(1).max(50).optional(),
    diff: z.string().min(1).max(200_000).optional(),
    depth: z.number().int().min(1).max(3).default(1),
    cursor: cursorSchema.optional()
  })
  .strict();
const impactNodeSchema = z
  .object({ node: toolNodeSchema, hop: z.number().int().min(0) })
  .strict();
export const impactOutputSchema = z
  .object({
    ...responseBaseShape,
    status: z.enum(["ok", "not_found", "ambiguous", "no_diff_targets"]),
    roots: z.array(toolNodeSchema),
    ambiguousTargets: z.array(
      z.object({ input: z.string(), candidates: z.array(toolNodeSchema) }).strict()
    ),
    unresolvedTargets: z.array(z.string()),
    dependents: z.array(impactNodeSchema),
    connectors: z.array(toolNodeSchema),
    edges: z.array(toolEdgeSchema),
    affectedTests: z.array(toolNodeSchema),
    beyondDepthByPackage: z.array(
      z
        .object({
          packageName: z.string().min(1),
          count: z.number().int().positive()
        })
        .strict()
    ),
    boundaryCrossings: z
      .object({
        available: z.boolean(),
        count: z.number().int().min(0),
        reason: z.string().nullable()
      })
      .strict(),
    message: z.string()
  })
  .strict();

export const pathInputSchema = z
  .object({
    from: z.string().trim().min(1).max(1000),
    to: z.string().trim().min(1).max(1000),
    relations: z.array(relationSchema).min(1).max(11).default(["calls", "imports"]),
    k: z.number().int().min(1).max(10).default(3)
  })
  .strict();
const graphPathSchema = z
  .object({ nodes: z.array(toolNodeSchema).min(1), edges: z.array(toolEdgeSchema) })
  .strict();
export const pathOutputSchema = z
  .object({
    ...responseBaseShape,
    status: z.enum(["ok", "not_found", "ambiguous", "no_path", "search_limit"]),
    from: toolNodeSchema.nullable(),
    to: toolNodeSchema.nullable(),
    fromCandidates: z.array(toolNodeSchema),
    toCandidates: z.array(toolNodeSchema),
    paths: z.array(graphPathSchema),
    nearestApproach: z.array(toolNodeSchema),
    message: z.string()
  })
  .strict();

export type RepoOverviewOutput = z.infer<typeof repoOverviewOutputSchema>;
export type FindSymbolInput = z.infer<typeof findSymbolInputSchema>;
export type FindSymbolOutput = z.infer<typeof findSymbolOutputSchema>;
export type SymbolContextInput = z.infer<typeof symbolContextInputSchema>;
export type SymbolContextOutput = z.infer<typeof symbolContextOutputSchema>;
export type FindTestsInput = z.infer<typeof findTestsInputSchema>;
export type FindTestsOutput = z.infer<typeof findTestsOutputSchema>;
export type ImpactInput = z.infer<typeof impactInputSchema>;
export type ImpactOutput = z.infer<typeof impactOutputSchema>;
export type PathInput = z.infer<typeof pathInputSchema>;
export type PathOutput = z.infer<typeof pathOutputSchema>;
export type ToolNode = z.infer<typeof toolNodeSchema>;
export type ToolEdge = z.infer<typeof toolEdgeSchema>;
export type Omission = z.infer<typeof omissionSchema>;
export type AggregateOmission = z.infer<typeof aggregateOmissionSchema>;
