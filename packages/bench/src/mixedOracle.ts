import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { GraphEdge, GraphNode, SnapshotGraph } from "@tadori/core";
import { indexRepository, type IndexDiagnostic, type ScanResult } from "@tadori/indexer";
import { z } from "zod";

const normalizedPath = z.string().min(1).refine((value) => !value.includes("\\"), {
  message: "oracle paths must use forward slashes"
});
const selectorSchema = z.object({
  language: z.string().min(1),
  symbol: z.string().min(1).optional(),
  file: normalizedPath
});
const expectedEvidenceSchema = z.object({
  file: normalizedPath,
  line: z.number().int().min(1),
  contains: z.string().min(1)
});
const relationSchema = z.object({
  id: z.string().min(1),
  relation: z.string().min(1),
  boundaryKind: z.string().min(1),
  source: selectorSchema,
  target: selectorSchema,
  derivation: z.string().min(1),
  resolution: z.string().min(1),
  evidence: z.array(expectedEvidenceSchema).min(1)
});
const oracleSchema = z.object({
  schemaVersion: z.literal(1),
  fixtureId: z.string().min(1),
  root: z.literal("."),
  determinism: z.object({
    networkAccess: z.literal(false),
    repositoryCodeExecution: z.literal(false),
    generatedArtifactsRequired: z.literal(false),
    expectedTotalFileCount: z.number().int().min(1),
    subjectFileCount: z.number().int().min(1),
    excludedFromSubject: z.array(normalizedPath),
    pathSeparator: z.literal("/"),
    evidenceLinesAreOneBased: z.literal(true)
  }),
  languageCoverage: z.array(
    z.object({
      language: z.string().min(1),
      capability: z.enum(["semantic", "structural", "repository-only"]),
      valid: z.array(normalizedPath).min(1),
      recovery: normalizedPath.optional(),
      notApplicable: z.array(z.string().min(1)).optional()
    })
  ).min(1),
  sameNamedSymbolInvariant: z.object({
    name: z.string().min(1),
    minimumDistinctLanguageCount: z.number().int().min(2),
    definitions: z.array(
      selectorSchema.extend({
        line: z.number().int().min(1),
        qualifiedName: z.string().min(1).optional()
      })
    ),
    expected: z.string().min(1)
  }),
  expectedCrossLanguageRelations: z.array(relationSchema),
  expectedUnresolvedCalls: z.array(
    z.object({
      language: z.string().min(1),
      file: normalizedPath,
      line: z.number().int().min(1),
      reason: z.string().min(1)
    })
  ),
  expectedTestFiles: z.array(normalizedPath),
  recoveryInvariant: z.object({
    expectedDiagnosticFileCount: z.number().int().min(1),
    unaffectedValidFilesMustRemainIndexed: z.literal(true),
    recoveredDeclarations: z.array(
      z.object({
        language: z.string().min(1),
        file: normalizedPath,
        name: z.string().min(1),
        line: z.number().int().min(1)
      })
    ),
    repositoryFallbackFiles: z.array(normalizedPath)
  }),
  integrityInvariants: z.object({
    duplicateCanonicalIdentities: z.literal(0),
    danglingEdges: z.literal(0),
    invalidEvidenceSpans: z.literal(0),
    crossLanguageEdgesWithoutConcreteEvidence: z.literal(0),
    compilerResolvedFactsOutsideTypeScriptJavaScript: z.literal(0),
    runtimeObservedEdges: z.literal(0)
  })
}).strict();

export type MixedLanguageOracle = z.infer<typeof oracleSchema>;

export interface MixedOracleReport {
  fixtureRoot: string;
  fileCount: number;
  subjectFileCount: number;
  graphFileCount: number;
  nodeCount: number;
  edgeCount: number;
  diagnosticFileCount: number;
  issues: string[];
}

function slash(value: string): string {
  return value.split(path.sep).join("/");
}

function listFixtureFiles(root: string, directory = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFixtureFiles(root, absolutePath));
    } else if (entry.isFile()) {
      files.push(slash(path.relative(root, absolutePath)));
    } else {
      throw new Error(`Mixed-language fixture contains unsupported filesystem entry: ${absolutePath}`);
    }
  }
  return files.sort();
}

function hashFixture(root: string, files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(path.join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function lineAt(root: string, file: string, line: number): string | undefined {
  return readFileSync(path.join(root, file), "utf8").split(/\r?\n/u)[line - 1];
}

function lineCount(root: string, file: string): number {
  const text = readFileSync(path.join(root, file), "utf8");
  return Math.max(1, text.split(/\r?\n/u).length - (text.endsWith("\n") ? 1 : 0));
}

function findNodes(graph: SnapshotGraph, selector: z.infer<typeof selectorSchema>): GraphNode[] {
  return graph.nodes.filter((node) => {
    if (node.file !== selector.file || node.language !== selector.language) return false;
    if (selector.symbol === undefined) return node.kind === "file";
    return node.displayName === selector.symbol ||
      node.qualifiedName === selector.symbol ||
      node.qualifiedName.endsWith(selector.symbol) ||
      node.qualifiedName.endsWith(`.${selector.symbol}`) ||
      node.qualifiedName.endsWith(`::${selector.symbol}`);
  });
}

function edgeFor(
  graph: SnapshotGraph,
  relation: z.infer<typeof relationSchema>
): GraphEdge | undefined {
  const sources = new Set(findNodes(graph, relation.source).map((node) => node.entityKey));
  const targets = new Set(findNodes(graph, relation.target).map((node) => node.entityKey));
  return graph.edges.find(
    (edge) =>
      edge.relation === relation.relation &&
      sources.has(edge.srcEntityKey) &&
      targets.has(edge.dstEntityKey)
  );
}

function addDuplicateIssues(
  issues: string[],
  label: string,
  values: readonly string[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) issues.push(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function validateSpans(
  fixtureRoot: string,
  fixtureFiles: ReadonlySet<string>,
  graph: SnapshotGraph,
  issues: string[]
): void {
  const validateEvidence = (owner: string, evidence: GraphNode["evidence"]): void => {
    for (const item of evidence) {
      if (!fixtureFiles.has(item.file)) {
        issues.push(`${owner} evidence references absent fixture file ${item.file}`);
        continue;
      }
      const count = lineCount(fixtureRoot, item.file);
      if (item.lineStart < 1 || item.lineEnd < item.lineStart || item.lineEnd > count) {
        issues.push(`${owner} has invalid evidence lines ${item.file}:${item.lineStart}-${item.lineEnd}`);
      }
      if (item.columnStart !== undefined && item.columnStart < 1) {
        issues.push(`${owner} has invalid evidence start column ${item.columnStart}`);
      }
      if (
        item.columnEnd !== undefined && item.lineStart === item.lineEnd &&
        item.columnEnd < (item.columnStart ?? 1)
      ) {
        issues.push(`${owner} has invalid evidence end column ${item.columnEnd}`);
      }
    }
  };
  for (const node of graph.nodes) {
    if ((node.spanStart === null) !== (node.spanEnd === null)) {
      issues.push(`node ${node.canonicalIdentity} has a partial byte span`);
    } else if (node.spanStart !== null && node.spanEnd !== null) {
      if (node.spanStart < 0 || node.spanEnd < node.spanStart) {
        issues.push(`node ${node.canonicalIdentity} has invalid byte span`);
      } else if (node.file !== null && fixtureFiles.has(node.file)) {
        const length = readFileSync(path.join(fixtureRoot, node.file), "utf8").length;
        if (node.spanEnd > length) issues.push(`node ${node.canonicalIdentity} exceeds its file span`);
      }
    }
    if ((node.lineStart === null) !== (node.lineEnd === null)) {
      issues.push(`node ${node.canonicalIdentity} has a partial line span`);
    } else if (node.lineStart !== null && node.lineEnd !== null && node.file !== null) {
      const count = lineCount(fixtureRoot, node.file);
      if (node.lineStart < 1 || node.lineEnd < node.lineStart || node.lineEnd > count) {
        issues.push(`node ${node.canonicalIdentity} has invalid line span`);
      }
    }
    validateEvidence(`node ${node.canonicalIdentity}`, node.evidence);
  }
  for (const edge of graph.edges) {
    validateEvidence(`edge ${edge.canonicalIdentity}`, edge.evidence);
  }
}

function validateIntegrity(
  fixtureRoot: string,
  fixtureFiles: ReadonlySet<string>,
  graph: SnapshotGraph,
  issues: string[]
): void {
  addDuplicateIssues(issues, "node canonical identity", graph.nodes.map((node) => node.canonicalIdentity));
  addDuplicateIssues(issues, "node entity key", graph.nodes.map((node) => node.entityKey));
  addDuplicateIssues(issues, "edge canonical identity", graph.edges.map((edge) => edge.canonicalIdentity));
  addDuplicateIssues(issues, "edge entity key", graph.edges.map((edge) => edge.entityKey));
  addDuplicateIssues(issues, "file key", graph.files.map((file) => file.fileKey));
  const nodeKeys = new Set(graph.nodes.map((node) => node.entityKey));
  const nodeByKey = new Map(graph.nodes.map((node) => [node.entityKey, node]));
  for (const edge of graph.edges) {
    if (!nodeKeys.has(edge.srcEntityKey)) issues.push(`edge ${edge.canonicalIdentity} has dangling source`);
    if (!nodeKeys.has(edge.dstEntityKey)) issues.push(`edge ${edge.canonicalIdentity} has dangling target`);
    const source = nodeByKey.get(edge.srcEntityKey);
    const target = nodeByKey.get(edge.dstEntityKey);
    if (
      source?.language && target?.language && source.language !== target.language &&
      edge.evidence.length === 0
    ) {
      issues.push(`cross-language edge ${edge.canonicalIdentity} has no concrete evidence`);
    }
  }
  for (const item of [...graph.nodes, ...graph.edges]) {
    if (
      item.provenance?.derivation === "compiler-resolved" && item.language !== null &&
      item.language !== undefined &&
      item.language !== "typescript" && item.language !== "javascript"
    ) {
      issues.push(`${item.canonicalIdentity} claims compiler resolution for ${String(item.language)}`);
    }
  }
  for (const edge of graph.edges) {
    if (edge.evidence.some((evidence) => evidence.kind === "tool_event")) {
      issues.push(`edge ${edge.canonicalIdentity} claims runtime/tool-event evidence`);
    }
  }
  validateSpans(fixtureRoot, fixtureFiles, graph, issues);
}

function validateLanguageCoverage(
  oracle: MixedLanguageOracle,
  scan: ScanResult,
  issues: string[]
): void {
  const scanned = new Map(
    [...scan.indexedFiles, ...scan.supportFiles].map((file) => [file.normalizedPath, file])
  );
  for (const coverage of oracle.languageCoverage) {
    const capability = coverage.capability === "repository-only" ? "repository" : coverage.capability;
    for (const file of [...coverage.valid, ...(coverage.recovery ? [coverage.recovery] : [])]) {
      const actual = scanned.get(file);
      if (!actual) {
        issues.push(`${coverage.language} coverage file was not scanned: ${file}`);
        continue;
      }
      const isLanguageManifest = file === "src/go/go.mod" || file === "src/rust/Cargo.toml";
      if (!isLanguageManifest && actual.language !== coverage.language) {
        issues.push(`${file} detected as ${actual.language}, expected ${coverage.language}`);
      }
      if (!isLanguageManifest && actual.registration.capability !== capability) {
        issues.push(`${file} capability is ${actual.registration.capability}, expected ${capability}`);
      }
    }
  }
}

function validateExpectedClaims(
  fixtureRoot: string,
  oracle: MixedLanguageOracle,
  graph: SnapshotGraph,
  diagnostics: readonly IndexDiagnostic[],
  issues: string[]
): void {
  for (const relation of oracle.expectedCrossLanguageRelations) {
    const edge = edgeFor(graph, relation);
    if (!edge) {
      issues.push(`missing expected relation ${relation.id}`);
      continue;
    }
    if (edge.provenance?.derivation !== relation.derivation) {
      issues.push(`${relation.id} derivation is ${String(edge.provenance?.derivation)}, expected ${relation.derivation}`);
    }
    if (edge.resolution !== relation.resolution) {
      issues.push(`${relation.id} resolution is ${edge.resolution}, expected ${relation.resolution}`);
    }
    for (const expected of relation.evidence) {
      const sourceLine = lineAt(fixtureRoot, expected.file, expected.line);
      if (!sourceLine?.includes(expected.contains)) {
        issues.push(`${relation.id} oracle evidence text is absent at ${expected.file}:${expected.line}`);
      }
      if (!edge.evidence.some((item) =>
        item.file === expected.file && item.lineStart <= expected.line && item.lineEnd >= expected.line
      )) {
        issues.push(`${relation.id} lacks graph evidence at ${expected.file}:${expected.line}`);
      }
    }
  }

  const invariant = oracle.sameNamedSymbolInvariant;
  const definitions = invariant.definitions.flatMap((definition) => {
    const nodes = findNodes(graph, { language: definition.language, file: definition.file, symbol: invariant.name })
      .filter((node) => node.lineStart === definition.line);
    if (nodes.length !== 1) {
      issues.push(`expected one ${definition.language} ${invariant.name} definition at ${definition.file}:${definition.line}, found ${nodes.length}`);
    } else if (definition.qualifiedName && nodes[0]?.qualifiedName !== definition.qualifiedName) {
      issues.push(`${definition.file}:${definition.line} qualified name is ${String(nodes[0]?.qualifiedName)}, expected ${definition.qualifiedName}`);
    }
    return nodes;
  });
  const languages = new Set(definitions.map((node) => node.language));
  const keys = new Set(definitions.map((node) => node.entityKey));
  if (languages.size < invariant.minimumDistinctLanguageCount) {
    issues.push(`${invariant.name} spans ${languages.size} languages, expected at least ${invariant.minimumDistinctLanguageCount}`);
  }
  if (keys.size !== definitions.length) issues.push(`${invariant.name} definitions do not have distinct canonical identities`);
  for (const edge of graph.edges) {
    if (keys.has(edge.srcEntityKey) && keys.has(edge.dstEntityKey)) {
      issues.push(`matching ${invariant.name} names fabricated edge ${edge.canonicalIdentity}`);
    }
  }

  for (const expected of oracle.expectedUnresolvedCalls) {
    const found = graph.edges.some((edge) =>
      edge.relation === "calls" && edge.resolution === "unresolved" &&
      edge.language === expected.language &&
      edge.provenance?.unresolvedReason === expected.reason &&
      edge.evidence.some((evidence) =>
        evidence.file === expected.file && evidence.lineStart <= expected.line && evidence.lineEnd >= expected.line
      )
    );
    if (!found) issues.push(`missing unresolved call ${expected.reason} at ${expected.file}:${expected.line}`);
  }

  for (const file of oracle.expectedTestFiles) {
    if (!graph.nodes.some((node) => node.kind === "test" && node.file === file)) {
      issues.push(`missing test node for ${file}`);
    }
  }
  for (const declaration of oracle.recoveryInvariant.recoveredDeclarations) {
    const found = findNodes(graph, {
      language: declaration.language,
      file: declaration.file,
      symbol: declaration.name
    }).some((node) => node.lineStart === declaration.line);
    if (!found) issues.push(`missing recovered declaration ${declaration.name} at ${declaration.file}:${declaration.line}`);
  }
  const diagnosticFiles = new Set(
    diagnostics.flatMap((diagnostic) => diagnostic.file === null ? [] : [diagnostic.file])
  );
  const expectedRecoveryFiles = new Set(
    oracle.languageCoverage.flatMap((coverage) => coverage.recovery === undefined ? [] : [coverage.recovery])
  );
  const diagnosedRecoveryCount = [...expectedRecoveryFiles].filter((file) => diagnosticFiles.has(file)).length;
  if (diagnosedRecoveryCount !== oracle.recoveryInvariant.expectedDiagnosticFileCount) {
    issues.push(`diagnostics cover ${diagnosedRecoveryCount} recovery files, expected ${oracle.recoveryInvariant.expectedDiagnosticFileCount}`);
  }
  for (const coverage of oracle.languageCoverage) {
    if (coverage.recovery && !diagnosticFiles.has(coverage.recovery)) {
      issues.push(`missing recovery diagnostic for ${coverage.recovery}`);
    }
    for (const valid of coverage.valid) {
      if (valid === "src/go/go.mod" || valid === "src/rust/Cargo.toml") continue;
      if (!graph.files.some((file) => file.normalizedPath === valid)) {
        issues.push(`unaffected valid file is absent from graph: ${valid}`);
      }
    }
  }
  for (const fallback of oracle.recoveryInvariant.repositoryFallbackFiles) {
    if (!graph.nodes.some((node) => node.kind === "file" && node.file === fallback)) {
      issues.push(`repository fallback file is absent: ${fallback}`);
    }
  }
}

export function runMixedLanguageOracle(fixtureRoot: string): MixedOracleReport {
  const root = path.resolve(fixtureRoot);
  const oracle = oracleSchema.parse(
    JSON.parse(readFileSync(path.join(root, "expected-oracle.json"), "utf8"))
  );
  const filesBefore = listFixtureFiles(root);
  const hashBefore = hashFixture(root, filesBefore);
  const first = indexRepository(root, { kind: "working_tree" });
  const second = indexRepository(root, { kind: "working_tree" });
  const filesAfter = listFixtureFiles(root);
  const hashAfter = hashFixture(root, filesAfter);
  const issues: string[] = [];

  if (filesBefore.length !== oracle.determinism.expectedTotalFileCount) {
    issues.push(`fixture has ${filesBefore.length} files, expected ${oracle.determinism.expectedTotalFileCount}`);
  }
  const excluded = new Set(oracle.determinism.excludedFromSubject);
  const subjectFileCount = filesBefore.filter((file) => !excluded.has(file)).length;
  if (subjectFileCount !== oracle.determinism.subjectFileCount) {
    issues.push(`fixture has ${subjectFileCount} subject files, expected ${oracle.determinism.subjectFileCount}`);
  }
  if (JSON.stringify(first.graph) !== JSON.stringify(second.graph)) {
    issues.push("repeated indexing produced different snapshot graphs");
  }
  if (JSON.stringify(first.diagnostics) !== JSON.stringify(second.diagnostics)) {
    issues.push("repeated indexing produced different diagnostics");
  }
  if (filesBefore.join("\n") !== filesAfter.join("\n") || hashBefore !== hashAfter) {
    issues.push("indexing mutated the mixed-language fixture source tree");
  }

  const fixtureFileSet = new Set(filesBefore);
  validateIntegrity(root, fixtureFileSet, first.graph, issues);
  validateLanguageCoverage(oracle, first.scan, issues);
  validateExpectedClaims(root, oracle, first.graph, first.diagnostics, issues);

  return {
    fixtureRoot: slash(root),
    fileCount: filesBefore.length,
    subjectFileCount,
    graphFileCount: first.graph.files.length,
    nodeCount: first.graph.nodes.length,
    edgeCount: first.graph.edges.length,
    diagnosticFileCount: new Set(
      first.diagnostics.flatMap((diagnostic) =>
        diagnostic.file !== null && oracle.languageCoverage.some((coverage) => coverage.recovery === diagnostic.file)
          ? [diagnostic.file]
          : []
      )
    ).size,
    issues: [...new Set(issues)].sort()
  };
}

export function assertMixedLanguageOracle(report: MixedOracleReport): void {
  if (report.issues.length > 0) {
    throw new Error(`Mixed-language oracle failed:\n- ${report.issues.join("\n- ")}`);
  }
}
