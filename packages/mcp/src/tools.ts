import { RELATIONS, type GraphEdge, type GraphNode, type Relation } from "@tadori/core";
import type { EventLog, RetrievalCallLog } from "./events.js";
import {
  findSymbolInputSchema,
  findSymbolOutputSchema,
  findTestsInputSchema,
  findTestsOutputSchema,
  impactInputSchema,
  impactOutputSchema,
  pathInputSchema,
  pathOutputSchema,
  repoOverviewInputSchema,
  repoOverviewOutputSchema,
  symbolContextInputSchema,
  symbolContextOutputSchema,
  type AggregateOmission,
  type FindSymbolInput,
  type FindSymbolOutput,
  type FindTestsInput,
  type FindTestsOutput,
  type ImpactInput,
  type ImpactOutput,
  type Omission,
  type PathInput,
  type PathOutput,
  type RepoOverviewOutput,
  type SymbolContextInput,
  type SymbolContextOutput,
  type ToolEdge,
  type ToolName,
  type ToolNode
} from "./contracts.js";
import {
  rankCandidates,
  RANKING_POLICY_VERSION,
  RANKING_WEIGHTS,
  signatureReferencesType,
  type HardRequirement,
  type RankedCandidate
} from "./ranking.js";
import { estimateTokens, type EntityResolution, type GraphService } from "./service.js";

const IMPACT_RELATIONS: ReadonlySet<Relation> = new Set(["calls", "imports"]);
const OVERVIEW_RESULT_LIMIT = 100;
const IMPACT_PAGE_SIZE = 100;
const AMBIGUITY_LIMIT = 50;
const FIND_TESTS_LIMIT = 50;
const CONTEXT_PAGE_SIZE = 100;
const EDGE_RESULT_LIMIT = 200;
const EVIDENCE_RESULT_LIMIT = 20;
const PACKAGE_DEPENDENCY_LIMIT = 50;

function uniqueNodes(nodes: readonly GraphNode[]): GraphNode[] {
  return [...new Map(nodes.map((node) => [node.entityKey, node])).values()].sort((a, b) =>
    a.entityKey.localeCompare(b.entityKey)
  );
}

function uniqueEdges(edges: readonly GraphEdge[]): GraphEdge[] {
  return [...new Map(edges.map((edge) => [edge.entityKey, edge])).values()].sort((a, b) =>
    a.entityKey.localeCompare(b.entityKey)
  );
}

function parseOffset(cursor: string | undefined): number {
  if (cursor === undefined) {
    return 0;
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new RangeError("cursor offset is outside the supported range");
  }
  return offset;
}

function directoryOf(normalizedPath: string): string {
  const separator = normalizedPath.indexOf("/");
  return separator === -1 ? "." : normalizedPath.slice(0, separator);
}

interface DiffTarget {
  file: string;
  ranges: Array<{ start: number; end: number }>;
}

function diffPath(line: string): string | null {
  const value = line.slice(4).split("\t", 1)[0]?.trim();
  if (!value || value === "/dev/null") {
    return null;
  }
  return value.replace(/^[ab]\//, "").split("\\").join("/");
}

function extractDiffTargets(diff: string): DiffTarget[] {
  const targets = new Map<string, DiffTarget>();
  let oldFile: string | null = null;
  let newFile: string | null = null;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("--- ")) {
      oldFile = diffPath(line);
      continue;
    }
    if (line.startsWith("+++ ")) {
      newFile = diffPath(line);
      const file = newFile ?? oldFile;
      if (file !== null && !targets.has(file)) {
        targets.set(file, { file, ranges: [] });
      }
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) {
      continue;
    }
    const file = newFile ?? oldFile;
    const target = file === null ? undefined : targets.get(file);
    if (!target) {
      continue;
    }
    const oldStart = Number(hunk[1]);
    const oldCount = Number(hunk[2] ?? "1");
    const newStart = Number(hunk[3]);
    const newCount = Number(hunk[4] ?? "1");
    for (const [start, count] of [
      [oldStart, oldCount],
      [newStart, newCount]
    ] as const) {
      target.ranges.push({ start, end: start + Math.max(count, 1) - 1 });
    }
  }
  return [...targets.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coalesceAggregateOmissions(
  omissions: readonly AggregateOmission[]
): AggregateOmission[] {
  const grouped = new Map<string, AggregateOmission>();
  for (const omission of omissions) {
    const key = [
      omission.category,
      omission.reason,
      omission.continuation ?? "",
      String(omission.criticalContextPreserved)
    ].join("\0");
    const existing = grouped.get(key);
    grouped.set(
      key,
      existing ? { ...existing, count: existing.count + omission.count } : omission
    );
  }
  const entries = [...grouped.values()];
  if (entries.length <= 20) {
    return entries;
  }
  const retained = entries.slice(0, 19);
  retained.push({
    category: "other_omissions",
    count: entries.slice(19).reduce((total, item) => total + item.count, 0),
    reason: "aggregate_manifest_limit",
    continuation: null,
    criticalContextPreserved: false
  });
  return retained;
}

export class TadoriTools {
  constructor(
    readonly service: GraphService,
    private readonly eventLog: EventLog
  ) {}

  private context(): RepoOverviewOutput["context"] {
    const freshness = this.service.snapshotFreshness();
    return {
      repository: this.service.repoRoot,
      snapshotId: this.service.snapshot.id,
      snapshotKind: this.service.snapshot.kind,
      baseCommitSha: this.service.snapshot.base_commit_sha,
      workspaceHash: this.service.snapshot.workspace_hash,
      freshness: freshness.status,
      stale: freshness.stale,
      staleReason: freshness.reason
    };
  }

  private packageName(node: GraphNode): string | null {
    if (node.file === null) {
      return node.kind === "package" ? node.displayName : null;
    }
    return (
      this.service.graph.files.find((file) => file.normalizedPath === node.file)
        ?.packageName ?? null
    );
  }

  private selectionExplanation(
    ranked: readonly RankedCandidate[],
    pageOffset: number,
    returnedCandidateCount: number,
    estimatedResponseTokens: number,
    omittedExplanationLimit = 10,
    candidateRepresentation: "signature" | "name" = "signature",
    returnedConnectorKeys: ReadonlySet<string> = new Set()
  ): SymbolContextOutput["selection"] {
    const primary = ranked.slice(pageOffset, pageOffset + returnedCandidateCount);
    const tail = ranked
      .slice(pageOffset + returnedCandidateCount)
      .filter((entry) => !returnedConnectorKeys.has(entry.node.entityKey))
      .slice(0, omittedExplanationLimit);
    const explainedKeys = new Set([
      ...primary.map((entry) => entry.node.entityKey),
      ...returnedConnectorKeys,
      ...tail.map((entry) => entry.node.entityKey)
    ]);
    const explained = ranked.filter((entry) => explainedKeys.has(entry.node.entityKey));
    const omittedCritical = ranked
      .slice(pageOffset + returnedCandidateCount)
      .filter(
        (entry) =>
          !returnedConnectorKeys.has(entry.node.entityKey) &&
          entry.hardRequirements.length > 0
      );
    const unavailableSignals: SymbolContextOutput["selection"]["unavailableSignals"] = [
      "bm25_task_text",
      "churn_90d",
      "linked_decisions",
      "declared_boundaries"
    ];
    if (ranked.some((entry) => entry.components.samePackage.status === "unavailable")) {
      unavailableSignals.push("same_package");
    }
    return {
      policyVersion: RANKING_POLICY_VERSION,
      taskTextStatus: "unavailable",
      unavailableSignals,
      weights: { ...RANKING_WEIGHTS },
      pageOffset,
      returnedCandidateCount,
      returnedConnectorCount: returnedConnectorKeys.size,
      totalCandidateCount: ranked.length,
      criticalRequiredOmittedCount: omittedCritical.length,
      candidateRepresentation,
      hardRequiredContextRemaining: omittedCritical.length > 0,
      estimatedResponseTokens,
      ranking: explained.map((entry) => ({
        entityKey: entry.node.entityKey,
        rank: ranked.indexOf(entry) + 1,
        score: entry.score,
        confidence: entry.confidence,
        hardPriority: entry.hardPriority,
        hardRequirements: entry.hardRequirements,
        components: {
          bm25: entry.components.bm25.raw,
          proximity: entry.components.proximity.raw,
          fanIn: entry.components.fanIn.raw,
          churn: entry.components.churn.raw,
          linkedTest: entry.components.linkedTest.raw,
          linkedDecision: entry.components.linkedDecision.raw,
          samePackage: entry.components.samePackage.raw
        }
      }))
    };
  }

  private stableSymbolContextEstimate(
    build: (estimatedResponseTokens: number) => SymbolContextOutput
  ): SymbolContextOutput {
    let estimatedResponseTokens = 0;
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const output = build(estimatedResponseTokens);
      const actual = estimateTokens(JSON.stringify(output));
      if (actual === estimatedResponseTokens) {
        return output;
      }
      estimatedResponseTokens = actual;
    }
    throw new Error("symbol_context response token estimate did not converge");
  }

  private evidence(nodeOrEdge: GraphNode | GraphEdge): ToolNode["evidence"] {
    return nodeOrEdge.evidence.slice(0, EVIDENCE_RESULT_LIMIT).map((item) => ({
      file: item.file,
      kind: item.kind,
      lineStart: item.lineStart,
      lineEnd: item.lineEnd,
      columnStart: item.columnStart ?? null,
      columnEnd: item.columnEnd ?? null,
      commitSha:
        item.commitSha ??
        (this.service.snapshot.kind === "commit"
          ? this.service.snapshot.base_commit_sha
          : null),
      excerptHash: item.excerptHash ?? null
    }));
  }

  private node(
    node: GraphNode,
    preferred: ToolNode["representation"] = "signature",
    bodyTokenLimit = 0
  ): ToolNode {
    const freshness = this.service.nodeFreshness(node);
    let body: string | null = null;
    let representation = preferred;
    if (preferred === "body" && freshness.status === "fresh") {
      const read = this.service.readBody(node);
      if (read.body !== null && estimateTokens(read.body) <= bodyTokenLimit) {
        body = read.body;
      }
    }
    if (preferred === "body" && body === null) {
      representation = node.signature === null ? "name" : "signature";
    }
    if (preferred === "signature" && node.signature === null) {
      representation = "name";
    }
    return {
      entityKey: node.entityKey,
      kind: node.kind,
      qualifiedName: node.qualifiedName,
      displayName: node.displayName,
      file: node.file,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      signature: representation === "name" ? null : node.signature,
      exported: node.exported,
      fanIn: this.service.fanIn(node.entityKey),
      representation,
      body,
      evidence: this.evidence(node),
      evidenceOmittedCount: Math.max(0, node.evidence.length - EVIDENCE_RESULT_LIMIT),
      freshness: freshness.status,
      stale: freshness.stale,
      staleReason: freshness.reason
    };
  }

  private edge(edge: GraphEdge): ToolEdge {
    const source = this.service.nodesByKey.get(edge.srcEntityKey);
    const destination = this.service.nodesByKey.get(edge.dstEntityKey);
    if (!source || !destination) {
      throw new Error(`Snapshot edge ${edge.entityKey} has an unavailable endpoint`);
    }
    const freshness = this.service.edgeFreshness(edge);
    return {
      entityKey: edge.entityKey,
      srcEntityKey: edge.srcEntityKey,
      srcQualifiedName: source.qualifiedName,
      relation: edge.relation,
      dstEntityKey: edge.dstEntityKey,
      dstQualifiedName: destination.qualifiedName,
      origin: edge.origin,
      confidence: edge.confidence,
      resolution: edge.resolution,
      evidence: this.evidence(edge),
      evidenceOmittedCount: Math.max(0, edge.evidence.length - EVIDENCE_RESULT_LIMIT),
      freshness: freshness.status,
      stale: freshness.stale,
      staleReason: freshness.reason
    };
  }

  private resolve(reference: string): EntityResolution {
    return this.service.resolveEntity(reference);
  }

  private boundedCandidates(resolution: EntityResolution): {
    candidates: ToolNode[];
    omissions: Omission[];
    aggregateOmissions: AggregateOmission[];
  } {
    const ordered = uniqueNodes(resolution.candidates);
    const candidates = ordered.slice(0, AMBIGUITY_LIMIT).map((node) => this.node(node));
    const omitted = ordered.slice(AMBIGUITY_LIMIT);
    const manifest = omitted.slice(0, 100).map((node, index): Omission => ({
      targetKind: "node",
      entityKey: node.entityKey,
      rank: AMBIGUITY_LIMIT + index + 1,
      score: null,
      reason: "ambiguity_limit"
    }));
    const remaining = omitted.length - manifest.length;
    return {
      candidates,
      omissions: manifest,
      aggregateOmissions:
        remaining > 0
          ? [{
              category: "ambiguous_candidates",
              count: remaining,
              reason: "ambiguity_limit",
              continuation: "refine the entity reference with find_symbol",
              criticalContextPreserved: false
            }]
          : []
    };
  }

  private log(tool: ToolName, args: unknown, output: unknown, tokenBudget?: number): void {
    const resultNodes = new Map<string, ToolNode>();
    const resultEdges = new Map<string, ToolEdge>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!isRecord(value)) {
        return;
      }
      if (
        typeof value.entityKey === "string" &&
        typeof value.qualifiedName === "string" &&
        typeof value.kind === "string"
      ) {
        resultNodes.set(value.entityKey, value as ToolNode);
        return;
      }
      if (
        typeof value.entityKey === "string" &&
        typeof value.srcEntityKey === "string" &&
        typeof value.relation === "string"
      ) {
        resultEdges.set(value.entityKey, value as ToolEdge);
        return;
      }
      Object.values(value).forEach(visit);
    };
    visit(output);
    const outputRecord = output as {
      truncated: boolean;
      nextCursor: string | null;
      omissions: Omission[];
    };
    const call: RetrievalCallLog = {
      tool,
      args,
      requestedTokenBudget: tokenBudget ?? null,
      estimatedResponseTokens: estimateTokens(JSON.stringify(output)),
      truncated: outputRecord.truncated,
      nextCursor: outputRecord.nextCursor,
      resultNodes: [...resultNodes.values()].map((node, index) => ({
        entityKey: node.entityKey,
        rank: index + 1,
        score: null,
        representation: node.representation,
        stale: node.stale
      })),
      resultEdges: [...resultEdges.values()].map((edge, index) => ({
        entityKey: edge.entityKey,
        rank: index + 1,
        score: null,
        stale: edge.stale
      })),
      omissions: outputRecord.omissions,
      aggregateOmissionCount: Array.isArray(
        (output as { aggregateOmissions?: unknown }).aggregateOmissions
      )
        ? (output as { aggregateOmissions: unknown[] }).aggregateOmissions.length
        : 0
    };
    this.eventLog.logRetrieval(call);
  }

  repoOverview(raw: unknown = {}): RepoOverviewOutput {
    const input = repoOverviewInputSchema.parse(raw);
    const relations = Object.fromEntries(RELATIONS.map((relation) => [relation, 0])) as Record<
      Relation,
      number
    >;
    for (const edge of this.service.graph.edges) {
      relations[edge.relation] += 1;
    }
    const filesByPackage = new Map<string, Set<string>>();
    for (const file of this.service.graph.files) {
      if (file.packageName !== null) {
        const files = filesByPackage.get(file.packageName) ?? new Set<string>();
        files.add(file.normalizedPath);
        filesByPackage.set(file.packageName, files);
      }
    }
    const packageNameByFile = new Map(
      this.service.graph.files.map((file) => [file.normalizedPath, file.packageName])
    );
    const allPackages = this.service.graph.nodes
      .filter((node) => node.kind === "package")
      .map((packageNode) => {
        const containedFileKeys = new Set(
          (this.service.outEdges.get(packageNode.entityKey) ?? [])
            .filter((edge) => edge.relation === "contains")
            .map((edge) => edge.dstEntityKey)
        );
        const containedPaths = new Set(
          [...containedFileKeys]
            .map((key) => this.service.nodesByKey.get(key)?.file)
            .filter((file): file is string => file !== undefined && file !== null)
        );
        const packageFiles = filesByPackage.get(packageNode.displayName);
        for (const file of packageFiles ?? []) {
          containedPaths.add(file);
        }
        const dependencies = new Map<string, number>();
        for (const edge of this.service.graph.edges) {
          if (edge.relation !== "imports") {
            continue;
          }
          const sourceFile = this.service.nodesByKey.get(edge.srcEntityKey)?.file;
          const destinationFile = this.service.nodesByKey.get(edge.dstEntityKey)?.file;
          const sourcePackage = sourceFile ? packageNameByFile.get(sourceFile) : null;
          const destinationPackage = destinationFile
            ? packageNameByFile.get(destinationFile)
            : null;
          if (
            sourcePackage === packageNode.displayName &&
            destinationPackage &&
            destinationPackage !== sourcePackage
          ) {
            dependencies.set(
              destinationPackage,
              (dependencies.get(destinationPackage) ?? 0) + 1
            );
          }
        }
        return {
          node: this.node(packageNode, "aggregate"),
          fileCount: containedPaths.size,
          symbolCount: this.service.graph.nodes.filter(
            (node) => node.file !== null && containedPaths.has(node.file) && node.kind !== "file"
          ).length,
          dependencies: [...dependencies]
            .map(([targetPackage, edgeCount]) => ({
              targetPackage,
              direction: "outgoing" as const,
              edgeCount
            }))
            .sort((a, b) => a.targetPackage.localeCompare(b.targetPackage))
            .slice(0, PACKAGE_DEPENDENCY_LIMIT),
          dependencyOmittedCount: Math.max(
            0,
            dependencies.size - PACKAGE_DEPENDENCY_LIMIT
          ),
          loc: null,
          locStatus: "unavailable_in_snapshot" as const
        };
      })
      .sort((a, b) => a.node.entityKey.localeCompare(b.node.entityKey));
    const packages = allPackages.slice(0, OVERVIEW_RESULT_LIMIT);
    const allRoutes = this.service.graph.nodes.filter((node) => node.kind === "route");
    const routes = allRoutes.slice(0, OVERVIEW_RESULT_LIMIT).map((node) => this.node(node));
    const omittedNodes = [
      ...allPackages.slice(OVERVIEW_RESULT_LIMIT).map((item) => ({
        node: item.node,
        reason: "overview_package_limit"
      })),
      ...allRoutes.slice(OVERVIEW_RESULT_LIMIT).map((node) => ({
        node: this.node(node),
        reason: "overview_route_limit"
      }))
    ];
    const omissions: Omission[] = omittedNodes.slice(0, 100).map((item, index) => ({
      targetKind: "node",
      entityKey: item.node.entityKey,
      rank: OVERVIEW_RESULT_LIMIT + index + 1,
      score: null,
      reason: item.reason
    }));
    const directoryCounts = new Map<string, number>();
    for (const file of this.service.graph.files) {
      const directory = directoryOf(file.normalizedPath);
      directoryCounts.set(directory, (directoryCounts.get(directory) ?? 0) + 1);
    }
    const allDirectoryRoles = [...directoryCounts]
      .map(([directory, fileCount]) => ({
        directory,
        fileCount,
        role: null,
        roleStatus: "unavailable_in_snapshot" as const
      }))
      .sort((a, b) => a.directory.localeCompare(b.directory));
    const aggregateOmissions: AggregateOmission[] = [];
    if (omittedNodes.length > omissions.length) {
      aggregateOmissions.push({
        category: "repository_structure_nodes",
        count: omittedNodes.length - omissions.length,
        reason: "overview_result_limit",
        continuation: "use find_symbol for omitted packages or routes",
        criticalContextPreserved: false
      });
    }
    if (allDirectoryRoles.length > OVERVIEW_RESULT_LIMIT) {
      aggregateOmissions.push({
        category: "top_level_directories",
        count: allDirectoryRoles.length - OVERVIEW_RESULT_LIMIT,
        reason: "overview_directory_limit",
        continuation: null,
        criticalContextPreserved: false
      });
    }
    const output = repoOverviewOutputSchema.parse({
      context: this.context(),
      truncated: omissions.length > 0 || aggregateOmissions.length > 0,
      nextCursor: null,
      omissions,
      aggregateOmissions,
      packages,
      routes,
      entryPoints: {
        available: false,
        nodes: [],
        reason: "entry-point classification is not stored in the frozen snapshot schema"
      },
      directoryRoles: allDirectoryRoles.slice(0, OVERVIEW_RESULT_LIMIT),
      counts: {
        files: this.service.graph.files.length,
        nodes: this.service.graph.nodes.length,
        edges: this.service.graph.edges.length,
        relations
      },
      boundaryRules: {
        available: false,
        count: 0,
        reason: "boundary-rule results are not stored in the frozen snapshot schema"
      }
    });
    this.log("repo_overview", input, output);
    return output;
  }

  findSymbol(raw: unknown): FindSymbolOutput {
    const input: FindSymbolInput = findSymbolInputSchema.parse(raw);
    const offset = parseOffset(input.cursor);
    const search = this.service.searchNodes(input.query, input.limit + 1, input.kind, offset);
    const visible = search.matches.slice(0, input.limit);
    const matches = visible
      .map((match) => this.service.nodesByKey.get(match.entity_key))
      .filter((node): node is GraphNode => node !== undefined)
      .map((node) => this.node(node));
    const next = search.matches[input.limit];
    const omissions: Omission[] = next
      ? [
          {
            targetKind: "node",
            entityKey: next.entity_key,
            rank: offset + input.limit + 1,
            score: next.rank,
            reason: "page_limit"
          }
        ]
      : [];
    const remainderCount = Math.max(0, search.total - offset - matches.length);
    const output = findSymbolOutputSchema.parse({
      context: this.context(),
      truncated: remainderCount > 0,
      nextCursor: remainderCount > 0 ? String(offset + matches.length) : null,
      omissions,
      aggregateOmissions: [],
      query: input.query,
      matches,
      totalMatches: search.total,
      remainderCount
    });
    this.log("find_symbol", input, output);
    return output;
  }

  symbolContext(raw: unknown): SymbolContextOutput {
    const input: SymbolContextInput = symbolContextInputSchema.parse(raw);
    const resolved = this.resolve(input.anchor);
    if (resolved.node === null) {
      const wasAmbiguous = resolved.candidates.length > 0;
      const pageOffset = parseOffset(input.cursor);
      const orderedCandidates = uniqueNodes(resolved.candidates);
      if (pageOffset > orderedCandidates.length) {
        throw new RangeError("cursor is beyond the ambiguous candidate set");
      }
      const pageCandidateNodes = orderedCandidates.slice(
        pageOffset,
        pageOffset + AMBIGUITY_LIMIT
      );
      let candidateRepresentation: "signature" | "name" = pageCandidateNodes.some(
        (node) => node.signature !== null
      )
        ? "signature"
        : "name";
      let pageCandidates = pageCandidateNodes.map((node) =>
        this.node(node, candidateRepresentation)
      );
      const candidates = [...pageCandidates];
      const buildAmbiguousOutput = (estimatedResponseTokens: number): SymbolContextOutput => {
        const continuationOffset = pageOffset + candidates.length;
        const remaining = orderedCandidates.slice(continuationOffset);
        const omissions = remaining.slice(0, 10).map((node, index) => ({
          targetKind: "node" as const,
          entityKey: node.entityKey,
          rank: continuationOffset + index + 1,
          score: null,
          reason: "context_page_or_budget"
        }));
        const aggregateOmissions: AggregateOmission[] =
          remaining.length > omissions.length
            ? [{
                category: "ambiguous_candidates",
                count: remaining.length - omissions.length,
                reason: "context_page_or_budget",
                continuation: String(continuationOffset),
                criticalContextPreserved: false
              }]
            : [];
        const selection = {
          ...this.selectionExplanation(
            [],
            pageOffset,
            candidates.length,
            estimatedResponseTokens,
            0,
            candidateRepresentation
          ),
          totalCandidateCount: orderedCandidates.length
        };
        return symbolContextOutputSchema.parse({
          context: this.context(),
          truncated: remaining.length > 0,
          nextCursor: remaining.length > 0 ? String(continuationOffset) : null,
          omissions,
          aggregateOmissions,
          status: wasAmbiguous ? "ambiguous" : "not_found",
          anchor: null,
          candidates,
          nodes: [],
          connectors: [],
          edges: [],
          relationGroups: [],
          linkedTests: [],
          linkedDocuments: [],
          decisionsAvailable: false,
          bodySuppressedReason: null,
          selection
        });
      };
      let output = this.stableSymbolContextEstimate(buildAmbiguousOutput);
      if (
        estimateTokens(JSON.stringify(output)) > input.tokenBudget &&
        candidateRepresentation === "signature"
      ) {
        candidateRepresentation = "name";
        pageCandidates = pageCandidateNodes.map((node) => this.node(node, "name"));
        candidates.splice(0, candidates.length, ...pageCandidates);
        output = this.stableSymbolContextEstimate(buildAmbiguousOutput);
      }
      if (estimateTokens(JSON.stringify(output)) > input.tokenBudget) {
        let lowest = 0;
        let highest = candidates.length - 1;
        let bestCount = -1;
        let bestOutput: SymbolContextOutput | null = null;
        while (lowest <= highest) {
          const candidateCount = Math.floor((lowest + highest) / 2);
          candidates.splice(
            0,
            candidates.length,
            ...pageCandidates.slice(0, candidateCount)
          );
          const candidateOutput = this.stableSymbolContextEstimate(buildAmbiguousOutput);
          if (estimateTokens(JSON.stringify(candidateOutput)) <= input.tokenBudget) {
            bestCount = candidateCount;
            bestOutput = candidateOutput;
            lowest = candidateCount + 1;
          } else {
            highest = candidateCount - 1;
          }
        }
        if (bestOutput !== null) {
          candidates.splice(0, candidates.length, ...pageCandidates.slice(0, bestCount));
          output = bestOutput;
        }
      }
      if (orderedCandidates.length > pageOffset && candidates.length === 0) {
        throw new RangeError(
          `tokenBudget ${input.tokenBudget} cannot fit one ambiguous candidate; increase the budget`
        );
      }
      if (estimateTokens(JSON.stringify(output)) > input.tokenBudget) {
        throw new RangeError(
          `tokenBudget ${input.tokenBudget} cannot fit the required response envelope`
        );
      }
      this.log("symbol_context", input, output, input.tokenBudget);
      return output;
    }

    const anchor = resolved.node;
    const anchorBody = this.node(anchor, "body", Math.floor(input.tokenBudget / 2));
    const initialBodySuppressedReason =
      anchorBody.representation === "body"
        ? null
        : anchorBody.stale
          ? "source is stale or unavailable"
          : "body exceeds the response budget or has no source span";
    const anchorAdjacentEdges = uniqueEdges([
      ...(this.service.outEdges.get(anchor.entityKey) ?? []),
      ...(this.service.inEdges.get(anchor.entityKey) ?? [])
    ]);
    const hardByKey = new Map<
      string,
      { requirements: Set<HardRequirement>; priority: 0 | 1 | 2 }
    >();
    const addHardRequirement = (
      node: GraphNode,
      requirement: HardRequirement,
      priority: 1 | 2
    ): void => {
      const existing = hardByKey.get(node.entityKey);
      if (existing === undefined) {
        hardByKey.set(node.entityKey, {
          requirements: new Set([requirement]),
          priority
        });
        return;
      }
      existing.requirements.add(requirement);
      existing.priority = Math.max(existing.priority, priority) as 1 | 2;
    };
    const hardAdjacentEdges: GraphEdge[] = [];
    for (const edge of anchorAdjacentEdges) {
      const otherKey =
        edge.srcEntityKey === anchor.entityKey
          ? edge.dstEntityKey
          : edge.srcEntityKey;
      const other = this.service.nodesByKey.get(otherKey);
      if (other === undefined) {
        continue;
      }
      if (edge.relation === "calls") {
        const compilerCertain =
          edge.origin === "compiler" &&
          edge.confidence === "certain" &&
          edge.resolution === "resolved";
        addHardRequirement(
          other,
          "direct_caller_or_callee",
          compilerCertain ? 2 : 1
        );
        hardAdjacentEdges.push(edge);
      }
      if (
        edge.relation === "tests" &&
        edge.confidence === "certain" &&
        other.kind === "test"
      ) {
        addHardRequirement(other, "certain_linked_test", 2);
        hardAdjacentEdges.push(edge);
      }
    }
    const signatureTypes = this.service.graph.nodes.filter((node) =>
      signatureReferencesType(anchor.signature, node)
    );
    for (const node of signatureTypes) {
      addHardRequirement(node, "signature_type_definition", 2);
    }

    const allowed = new Set(input.relations);
    const distance = new Map<string, number>([[anchor.entityKey, 0]]);
    const parentByKey = new Map<string, { parentKey: string; edge: GraphEdge }>();
    const queue = [anchor.entityKey];
    const traversed: GraphEdge[] = [...hardAdjacentEdges];
    for (const edge of uniqueEdges(hardAdjacentEdges)) {
      const otherKey =
        edge.srcEntityKey === anchor.entityKey
          ? edge.dstEntityKey
          : edge.srcEntityKey;
      if (!distance.has(otherKey)) {
        distance.set(otherKey, 1);
        parentByKey.set(otherKey, { parentKey: anchor.entityKey, edge });
        queue.push(otherKey);
      }
    }
    while (queue.length > 0) {
      const current = queue.shift()!;
      const depth = distance.get(current)!;
      if (depth >= input.depth) {
        continue;
      }
      const adjacent = [
        ...(this.service.outEdges.get(current) ?? []),
        ...(this.service.inEdges.get(current) ?? [])
      ]
        .filter((edge) => allowed.has(edge.relation))
        .sort((a, b) => a.entityKey.localeCompare(b.entityKey));
      for (const edge of adjacent) {
        traversed.push(edge);
        const other = edge.srcEntityKey === current ? edge.dstEntityKey : edge.srcEntityKey;
        if (!distance.has(other)) {
          distance.set(other, depth + 1);
          parentByKey.set(other, { parentKey: current, edge });
          queue.push(other);
        }
      }
    }
    const detachedHardKeys = new Set<string>();
    for (const node of signatureTypes) {
      if (!distance.has(node.entityKey)) {
        distance.set(node.entityKey, 1);
        detachedHardKeys.add(node.entityKey);
      }
    }
    const traversedEdges = uniqueEdges(traversed);
    const candidateNodes = uniqueNodes(
      [...distance.keys()]
        .filter((key) => key !== anchor.entityKey)
        .map((key) => this.service.nodesByKey.get(key))
        .filter((node): node is GraphNode => node !== undefined)
    );
    const anchorPackage = this.packageName(anchor);
    const ranked = rankCandidates(
      candidateNodes.map((node) => {
        const nodeDistance = distance.get(node.entityKey)!;
        const connectingEdges = traversedEdges.filter((edge) => {
          const incident =
            edge.srcEntityKey === node.entityKey || edge.dstEntityKey === node.entityKey;
          if (!incident) {
            return false;
          }
          const otherKey =
            edge.srcEntityKey === node.entityKey
              ? edge.dstEntityKey
              : edge.srcEntityKey;
          return distance.get(otherKey) === nodeDistance - 1;
        });
        const candidatePackage = this.packageName(node);
        const hard = hardByKey.get(node.entityKey);
        return {
          node,
          distance: nodeDistance,
          connectingEdges,
          fanIn: this.service.fanIn(node.entityKey),
          samePackage:
            anchorPackage === null || candidatePackage === null
              ? null
              : candidatePackage === anchorPackage,
          linkedTestToAnchor: anchorAdjacentEdges.some(
            (edge) =>
              edge.relation === "tests" &&
              (edge.srcEntityKey === node.entityKey || edge.dstEntityKey === node.entityKey)
          ),
          hardRequirements:
            hard === undefined ? [] : [...hard.requirements].sort(),
          hardPriority: hard?.priority ?? 0
        };
      })
    );
    const pageOffset = parseOffset(input.cursor);
    if (pageOffset > ranked.length) {
      throw new RangeError("cursor is beyond the ranked context candidate set");
    }
    const pageEnd = Math.min(ranked.length, pageOffset + CONTEXT_PAGE_SIZE);
    const pageCandidates = ranked.slice(pageOffset, pageEnd);
    const selected = [...pageCandidates];
    let anchorView = anchorBody;
    let suppressionReason = initialBodySuppressedReason;
    let omittedExplanationLimit = 10;
    let omissionDetailLimit = 10;
    let candidateRepresentation: "signature" | "name" = pageCandidates.some(
      (entry) => entry.node.signature !== null
    )
      ? "signature"
      : "name";
    const buildOutput = (estimatedResponseTokens: number): SymbolContextOutput => {
      const selectedNodes = selected.map((entry) => entry.node);
      const selectedKeys = new Set(selectedNodes.map((node) => node.entityKey));
      const connectorNodes = new Map<string, GraphNode>();
      const requiredPathEdges = new Map<string, GraphEdge>();
      for (const node of selectedNodes) {
        let current = node.entityKey;
        while (current !== anchor.entityKey) {
          const parent = parentByKey.get(current);
          if (parent === undefined) {
            if (detachedHardKeys.has(current)) {
              break;
            }
            throw new Error(`missing traversal parent for ${current}`);
          }
          requiredPathEdges.set(parent.edge.entityKey, parent.edge);
          if (parent.parentKey !== anchor.entityKey && !selectedKeys.has(parent.parentKey)) {
            const connector = this.service.nodesByKey.get(parent.parentKey);
            if (connector === undefined) {
              throw new Error(`missing connector node ${parent.parentKey}`);
            }
            connectorNodes.set(connector.entityKey, connector);
          }
          current = parent.parentKey;
        }
      }
      const connectors = [...connectorNodes.values()].sort((left, right) =>
        left.entityKey.localeCompare(right.entityKey)
      );
      const visibleKeys = new Set([
        anchor.entityKey,
        ...selectedKeys,
        ...connectors.map((node) => node.entityKey)
      ]);
      const optionalVisibleEdges = traversedEdges.filter(
        (edge) =>
          visibleKeys.has(edge.srcEntityKey) &&
          visibleKeys.has(edge.dstEntityKey) &&
          !requiredPathEdges.has(edge.entityKey)
      );
      const eligibleEdges = [
        ...[...requiredPathEdges.values()].sort((left, right) =>
          left.entityKey.localeCompare(right.entityKey)
        ),
        ...optionalVisibleEdges
      ];
      const selectedEdges = eligibleEdges.slice(0, EDGE_RESULT_LIMIT);
      const selectedEdgeKeys = new Set(selectedEdges.map((edge) => edge.entityKey));
      const remainingRanked = ranked.slice(pageOffset + selected.length);
      const unreturnedRemaining = remainingRanked.filter(
        (entry) => !connectorNodes.has(entry.node.entityKey)
      );
      const nextCursor =
        unreturnedRemaining.length > 0 ? String(pageOffset + selected.length) : null;
      const nodeOmissions = unreturnedRemaining
        .map((entry) => {
          const globalIndex = ranked.indexOf(entry);
          return {
            omission: {
              targetKind: "node" as const,
              entityKey: entry.node.entityKey,
              rank: globalIndex + 1,
              score: entry.score,
              reason:
                globalIndex < pageEnd ? "token_budget" : "context_page_limit"
            },
            critical: entry.hardRequirements.length > 0
          };
        });
      const edgeOmissions = traversedEdges
        .filter((edge) => !selectedEdgeKeys.has(edge.entityKey))
        .map((edge, index) => ({
          omission: {
            targetKind: "edge" as const,
            entityKey: edge.entityKey,
            rank: index + 1,
            score: null,
            reason:
              visibleKeys.has(edge.srcEntityKey) && visibleKeys.has(edge.dstEntityKey)
                ? "context_edge_limit"
                : "endpoint_not_on_page"
          },
          critical: false
        }));
      const allOmissions = [...nodeOmissions, ...edgeOmissions];
      const omissions = allOmissions
        .slice(0, omissionDetailLimit)
        .map((item) => item.omission);
      const aggregateGroups = new Map<
        string,
        { targetKind: "node" | "edge"; reason: string; count: number; critical: boolean }
      >();
      for (const item of allOmissions.slice(omissions.length)) {
        const key = `${item.omission.targetKind}\0${item.omission.reason}`;
        const existing = aggregateGroups.get(key);
        aggregateGroups.set(key, {
          targetKind: item.omission.targetKind,
          reason: item.omission.reason,
          count: (existing?.count ?? 0) + 1,
          critical: (existing?.critical ?? false) || item.critical
        });
      }
      const aggregateOmissions = coalesceAggregateOmissions(
        [...aggregateGroups.values()].map((group) => ({
          category: group.targetKind === "node" ? "context_nodes" : "context_edges",
          count: group.count,
          reason: group.reason,
          continuation: group.targetKind === "node" ? nextCursor : null,
          criticalContextPreserved: !group.critical
        }))
      );
      const nodeViews = selectedNodes.map((node) =>
        this.node(node, candidateRepresentation)
      );
      const connectorViews = connectors.map((node) =>
        this.node(node, candidateRepresentation)
      );
      const edgeViews = selectedEdges.map((edge) => this.edge(edge));
      const allNodeViews = [...nodeViews, ...connectorViews];
      const linkedTests = allNodeViews
        .filter((node) => node.kind === "test")
        .map((node) => node.entityKey);
      const linkedDocuments = allNodeViews
        .filter((node) => node.kind === "adr" || node.kind === "doc_section")
        .map((node) => node.entityKey);
      const relationGroups = [
        ...input.relations,
        ...[...new Set(edgeViews.map((edge) => edge.relation))]
          .filter((relation) => !allowed.has(relation))
          .sort()
      ].flatMap((relation) => {
        const groupEdges = edgeViews.filter((edge) => edge.relation === relation);
        if (groupEdges.length === 0) {
          return [];
        }
        const keys = new Set(
          groupEdges.flatMap((edge) => [edge.srcEntityKey, edge.dstEntityKey])
        );
        keys.delete(resolved.node!.entityKey);
        return [{
          relation,
          nodeEntityKeys: allNodeViews
            .filter((node) => keys.has(node.entityKey))
            .map((node) => node.entityKey),
          edgeEntityKeys: groupEdges.map((edge) => edge.entityKey)
        }];
      });
      return symbolContextOutputSchema.parse({
        context: this.context(),
        truncated: allOmissions.length > 0,
        nextCursor,
        omissions,
        aggregateOmissions,
        status: "ok",
        anchor: anchorView,
        candidates: [],
        nodes: nodeViews,
        connectors: connectorViews,
        edges: edgeViews,
        relationGroups,
        linkedTests,
        linkedDocuments,
        decisionsAvailable: false,
        bodySuppressedReason: suppressionReason,
        selection: this.selectionExplanation(
          ranked,
          pageOffset,
          selected.length,
          estimatedResponseTokens,
          omittedExplanationLimit,
          candidateRepresentation,
          new Set(connectors.map((node) => node.entityKey))
        )
      });
    };
    let output = this.stableSymbolContextEstimate(buildOutput);
    if (
      estimateTokens(JSON.stringify(output)) > input.tokenBudget &&
      omittedExplanationLimit > 0
    ) {
      omittedExplanationLimit = 0;
      output = this.stableSymbolContextEstimate(buildOutput);
    }
    if (estimateTokens(JSON.stringify(output)) > input.tokenBudget && anchorView.body !== null) {
      anchorView = this.node(anchor, "signature");
      suppressionReason = "body removed to satisfy the response token budget";
      output = this.stableSymbolContextEstimate(buildOutput);
    }
    if (
      estimateTokens(JSON.stringify(output)) > input.tokenBudget &&
      candidateRepresentation === "signature"
    ) {
      candidateRepresentation = "name";
      anchorView = this.node(anchor, "name");
      suppressionReason = "bodies and signatures reduced to names to satisfy the response token budget";
      output = this.stableSymbolContextEstimate(buildOutput);
    }
    if (
      estimateTokens(JSON.stringify(output)) > input.tokenBudget &&
      omissionDetailLimit > 0
    ) {
      omissionDetailLimit = 0;
      output = this.stableSymbolContextEstimate(buildOutput);
    }
    if (estimateTokens(JSON.stringify(output)) > input.tokenBudget) {
      let lowest = 0;
      let highest = selected.length - 1;
      let bestCount = -1;
      let bestOutput: SymbolContextOutput | null = null;
      while (lowest <= highest) {
        const candidateCount = Math.floor((lowest + highest) / 2);
        selected.splice(0, selected.length, ...pageCandidates.slice(0, candidateCount));
        const candidateOutput = this.stableSymbolContextEstimate(buildOutput);
        if (estimateTokens(JSON.stringify(candidateOutput)) <= input.tokenBudget) {
          bestCount = candidateCount;
          bestOutput = candidateOutput;
          lowest = candidateCount + 1;
        } else {
          highest = candidateCount - 1;
        }
      }
      if (bestOutput !== null) {
        selected.splice(0, selected.length, ...pageCandidates.slice(0, bestCount));
        output = bestOutput;
      }
    }
    if (ranked.length > pageOffset && selected.length === 0) {
      throw new RangeError(
        `tokenBudget ${input.tokenBudget} cannot fit one ranked context candidate; increase the budget`
      );
    }
    if (
      estimateTokens(JSON.stringify(output)) <= input.tokenBudget &&
      omissionDetailLimit === 0
    ) {
      let lowest = 1;
      let highest = 10;
      let bestLimit = 0;
      let bestOutput = output;
      while (lowest <= highest) {
        const detailLimit = Math.floor((lowest + highest) / 2);
        omissionDetailLimit = detailLimit;
        const candidateOutput = this.stableSymbolContextEstimate(buildOutput);
        if (estimateTokens(JSON.stringify(candidateOutput)) <= input.tokenBudget) {
          bestLimit = detailLimit;
          bestOutput = candidateOutput;
          lowest = detailLimit + 1;
        } else {
          highest = detailLimit - 1;
        }
      }
      omissionDetailLimit = bestLimit;
      output = bestOutput;
    }
    if (
      estimateTokens(JSON.stringify(output)) <= input.tokenBudget &&
      omittedExplanationLimit === 0
    ) {
      let lowest = 1;
      let highest = 10;
      let bestLimit = 0;
      let bestOutput = output;
      while (lowest <= highest) {
        const explanationLimit = Math.floor((lowest + highest) / 2);
        omittedExplanationLimit = explanationLimit;
        const candidateOutput = this.stableSymbolContextEstimate(buildOutput);
        if (estimateTokens(JSON.stringify(candidateOutput)) <= input.tokenBudget) {
          bestLimit = explanationLimit;
          bestOutput = candidateOutput;
          lowest = explanationLimit + 1;
        } else {
          highest = explanationLimit - 1;
        }
      }
      omittedExplanationLimit = bestLimit;
      output = bestOutput;
    }
    if (estimateTokens(JSON.stringify(output)) > input.tokenBudget) {
      throw new RangeError(
        `tokenBudget ${input.tokenBudget} cannot fit the required response envelope`
      );
    }
    this.log("symbol_context", input, output, input.tokenBudget);
    return output;
  }

  findTests(raw: unknown): FindTestsOutput {
    const input: FindTestsInput = findTestsInputSchema.parse(raw);
    const resolved = this.resolve(input.target);
    if (resolved.node === null) {
      const bounded = this.boundedCandidates(resolved);
      const output = findTestsOutputSchema.parse({
        context: this.context(),
        truncated: bounded.omissions.length > 0 || bounded.aggregateOmissions.length > 0,
        nextCursor: null,
        omissions: bounded.omissions,
        aggregateOmissions: bounded.aggregateOmissions,
        status: bounded.candidates.length > 0 ? "ambiguous" : "not_found",
        heading: "Likely relevant tests",
        message: bounded.candidates.length > 0 ? "target is ambiguous" : "target not found",
        target: null,
        candidates: bounded.candidates,
        tests: []
      });
      this.log("find_tests", input, output);
      return output;
    }
    const edges = uniqueEdges([
      ...(this.service.inEdges.get(resolved.node.entityKey) ?? []),
      ...(this.service.outEdges.get(resolved.node.entityKey) ?? [])
    ].filter((edge) => edge.relation === "tests"));
    const allLinks = edges
      .map((edge) => {
        const otherKey = edge.srcEntityKey === resolved.node!.entityKey
          ? edge.dstEntityKey
          : edge.srcEntityKey;
        const test = this.service.nodesByKey.get(otherKey);
        return test?.kind === "test" ? { edge, test } : null;
      })
      .filter((link): link is { edge: GraphEdge; test: GraphNode } => link !== null)
      .map(({ edge, test }) => {
        const linkage =
          edge.origin === "compiler"
            ? "statically_linked" as const
            : edge.origin === "heuristic"
              ? "naming_associated" as const
              : edge.origin === "git"
                ? "historically_associated" as const
                : "evidence_associated" as const;
        return {
          test: this.node(test),
          edge: this.edge(edge),
          linkage,
          runHint: null,
          runHintStatus: "unavailable_in_snapshot" as const
        };
      });
    const links = allLinks.slice(0, FIND_TESTS_LIMIT);
    const visibleKeys = new Set(links.flatMap((link) => [link.test.entityKey, link.edge.entityKey]));
    const omittedEntities = allLinks
      .slice(FIND_TESTS_LIMIT)
      .flatMap((link) => [
        { targetKind: "node" as const, entityKey: link.test.entityKey },
        { targetKind: "edge" as const, entityKey: link.edge.entityKey }
      ])
      .filter((item) => !visibleKeys.has(item.entityKey));
    const omissions = omittedEntities.slice(0, 100).map((item, index) => ({
      ...item,
      rank: index + 1,
      score: null,
      reason: "find_tests_result_limit"
    }));
    const aggregateOmissions: AggregateOmission[] =
      omittedEntities.length > omissions.length
        ? [{
            category: "linked_tests",
            count: omittedEntities.length - omissions.length,
            reason: "find_tests_result_limit",
            continuation: "refine the test target",
            criticalContextPreserved: false
          }]
        : [];
    const output = findTestsOutputSchema.parse({
      context: this.context(),
      truncated: omissions.length > 0 || aggregateOmissions.length > 0,
      nextCursor: null,
      omissions,
      aggregateOmissions,
      status: "ok",
      heading: "Likely relevant tests",
      message: links.length === 0 ? "no linked tests found" : `${allLinks.length} likely relevant test(s)`,
      target: this.node(resolved.node),
      candidates: [],
      tests: links
    });
    this.log("find_tests", input, output);
    return output;
  }

  impact(raw: unknown): ImpactOutput {
    const input: ImpactInput = impactInputSchema.parse(raw);
    if ((input.targets === undefined) === (input.diff === undefined)) {
      throw new Error("provide exactly one of targets or diff");
    }
    const roots: GraphNode[] = [];
    const ambiguousTargets: ImpactOutput["ambiguousTargets"] = [];
    const unresolvedTargets: string[] = [];
    const allOmissions: Omission[] = [];
    const aggregateOmissions: AggregateOmission[] = [];
    if (input.targets !== undefined) {
      for (const target of input.targets) {
        const resolved = this.resolve(target);
        if (resolved.node !== null) {
          roots.push(resolved.node);
        } else if (resolved.candidates.length > 0) {
          const bounded = this.boundedCandidates(resolved);
          ambiguousTargets.push({
            input: target,
            candidates: bounded.candidates
          });
          allOmissions.push(...bounded.omissions);
          aggregateOmissions.push(...bounded.aggregateOmissions);
        } else {
          unresolvedTargets.push(target);
        }
      }
    } else if (input.diff !== undefined) {
      const targets = extractDiffTargets(input.diff);
      for (const target of targets) {
        roots.push(
          ...this.service.graph.nodes.filter((node) => {
            if (node.file !== target.file) {
              return false;
            }
            if (node.kind === "file") {
              return true;
            }
            if (target.ranges.length === 0 || node.lineStart === null || node.lineEnd === null) {
              return false;
            }
            return target.ranges.some(
              (range) => node.lineStart! <= range.end && node.lineEnd! >= range.start
            );
          })
        );
      }
    }
    const allRoots = uniqueNodes(roots);
    const stableRoots = allRoots.slice(0, 100);
    for (const [index, node] of allRoots.slice(100, 200).entries()) {
      allOmissions.push({
        targetKind: "node",
        entityKey: node.entityKey,
        rank: index + 1,
        score: null,
        reason: "impact_root_limit"
      });
    }
    if (allRoots.length > 200) {
      aggregateOmissions.push({
        category: "impact_roots",
        count: allRoots.length - 200,
        reason: "impact_root_limit",
        continuation: "narrow the target list or diff",
        criticalContextPreserved: false
      });
    }
    const distance = new Map(stableRoots.map((node) => [node.entityKey, 0]));
    const queue = stableRoots.map((node) => node.entityKey);
    const traversed: GraphEdge[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const depth = distance.get(current)!;
      if (depth >= input.depth) {
        continue;
      }
      const incoming = (this.service.inEdges.get(current) ?? [])
        .filter((edge) => IMPACT_RELATIONS.has(edge.relation))
        .sort((a, b) => a.entityKey.localeCompare(b.entityKey));
      for (const edge of incoming) {
        traversed.push(edge);
        if (!distance.has(edge.srcEntityKey)) {
          distance.set(edge.srcEntityKey, depth + 1);
          queue.push(edge.srcEntityKey);
        }
      }
    }
    const allDependents = [...distance]
      .filter(([, hop]) => hop > 0)
      .map(([key, hop]) => ({ node: this.service.nodesByKey.get(key), hop }))
      .filter((item): item is { node: GraphNode; hop: number } => item.node !== undefined)
      .sort((a, b) => a.hop - b.hop || a.node.entityKey.localeCompare(b.node.entityKey));
    const offset = parseOffset(input.cursor);
    const page = allDependents.slice(offset, offset + IMPACT_PAGE_SIZE);
    const pageKeys = new Set(page.map((item) => item.node.entityKey));
    const connectors = uniqueNodes(
      traversed
        .filter((edge) => pageKeys.has(edge.srcEntityKey) && !pageKeys.has(edge.dstEntityKey))
        .map((edge) => this.service.nodesByKey.get(edge.dstEntityKey))
        .filter((node): node is GraphNode => node !== undefined)
    );
    const visibleImpactKeys = new Set([
      ...stableRoots.map((node) => node.entityKey),
      ...pageKeys,
      ...connectors.map((node) => node.entityKey)
    ]);
    const structuralEdges = uniqueEdges(traversed).filter(
      (edge) => visibleImpactKeys.has(edge.srcEntityKey) && visibleImpactKeys.has(edge.dstEntityKey)
    );
    const linkedTests = new Map<string, GraphNode>();
    const testEdges: GraphEdge[] = [];
    for (const key of visibleImpactKeys) {
      for (const edge of [
        ...(this.service.inEdges.get(key) ?? []),
        ...(this.service.outEdges.get(key) ?? [])
      ]) {
        if (edge.relation !== "tests") {
          continue;
        }
        const otherKey = edge.srcEntityKey === key ? edge.dstEntityKey : edge.srcEntityKey;
        const test = this.service.nodesByKey.get(otherKey);
        if (test?.kind === "test") {
          linkedTests.set(test.entityKey, test);
          testEdges.push(edge);
        }
      }
    }
    const allAffectedTests = [...linkedTests.values()].sort((a, b) =>
      a.entityKey.localeCompare(b.entityKey)
    );
    const affectedTests = allAffectedTests.slice(0, 100);
    const returnedEdges = uniqueEdges([...structuralEdges, ...testEdges]).slice(
      0,
      EDGE_RESULT_LIMIT
    );
    const returnedKeys = new Set([
      ...visibleImpactKeys,
      ...affectedTests.map((node) => node.entityKey),
      ...returnedEdges.map((edge) => edge.entityKey)
    ]);
    const omittedDependents = allDependents.slice(offset + IMPACT_PAGE_SIZE);
    for (const [index, item] of omittedDependents.slice(0, 100).entries()) {
      allOmissions.push({
        targetKind: "node",
        entityKey: item.node.entityKey,
        rank: index + 1,
        score: null,
        reason: "page_limit"
      });
    }
    for (const [index, edge] of uniqueEdges([...structuralEdges, ...testEdges])
      .slice(EDGE_RESULT_LIMIT, EDGE_RESULT_LIMIT + 100)
      .entries()) {
      allOmissions.push({
        targetKind: "edge",
        entityKey: edge.entityKey,
        rank: index + 1,
        score: null,
        reason: "impact_edge_limit"
      });
    }
    for (const [index, node] of allAffectedTests.slice(100, 200).entries()) {
      allOmissions.push({
        targetKind: "node",
        entityKey: node.entityKey,
        rank: index + 1,
        score: null,
        reason: "affected_test_limit"
      });
    }
    const uniqueOmissions = [...new Map(
      allOmissions
        .filter((item) => !returnedKeys.has(item.entityKey))
        .map((item) => [`${item.targetKind}:${item.entityKey}`, item])
    ).values()];
    const rankByKind = { node: 0, edge: 0 };
    const omissions = uniqueOmissions.slice(0, 100).map((item) => ({
      ...item,
      rank: (rankByKind[item.targetKind] += 1)
    }));
    if (uniqueOmissions.length > omissions.length) {
      aggregateOmissions.push({
        category: "impact_entities",
        count: uniqueOmissions.length - omissions.length,
        reason: "impact_result_limit",
        continuation: input.cursor === undefined ? "continue with nextCursor" : null,
        criticalContextPreserved: false
      });
    }
    if (allAffectedTests.length > 200) {
      aggregateOmissions.push({
        category: "affected_tests",
        count: allAffectedTests.length - 200,
        reason: "affected_test_limit",
        continuation: "use find_tests on an impacted node",
        criticalContextPreserved: false
      });
    }
    const beyondDepth = new Map<string, Set<string>>();
    for (const [key, hop] of distance) {
      if (hop !== input.depth) {
        continue;
      }
      for (const edge of this.service.inEdges.get(key) ?? []) {
        if (!IMPACT_RELATIONS.has(edge.relation) || distance.has(edge.srcEntityKey)) {
          continue;
        }
        const source = this.service.nodesByKey.get(edge.srcEntityKey);
        const graphFile = source?.file
          ? this.service.graph.files.find((file) => file.normalizedPath === source.file)
          : undefined;
        const packageName = graphFile?.packageName ?? "(unassigned)";
        const keys = beyondDepth.get(packageName) ?? new Set<string>();
        keys.add(edge.srcEntityKey);
        beyondDepth.set(packageName, keys);
      }
    }
    const allBeyondDepthByPackage = [...beyondDepth]
      .map(([packageName, keys]) => ({ packageName, count: keys.size }))
      .sort((a, b) => a.packageName.localeCompare(b.packageName));
    if (allBeyondDepthByPackage.length > 100) {
      aggregateOmissions.push({
        category: "beyond_depth_packages",
        count: allBeyondDepthByPackage.length - 100,
        reason: "impact_package_summary_limit",
        continuation: null,
        criticalContextPreserved: false
      });
    }
    const responseAggregateOmissions = coalesceAggregateOmissions(aggregateOmissions);
    const hasMore = offset + page.length < allDependents.length;
    const status: ImpactOutput["status"] =
      stableRoots.length === 0
        ? ambiguousTargets.length > 0
          ? "ambiguous"
          : input.diff !== undefined
            ? "no_diff_targets"
            : "not_found"
        : ambiguousTargets.length > 0
          ? "ambiguous"
          : "ok";
    const output = impactOutputSchema.parse({
      context: this.context(),
      truncated: hasMore || omissions.length > 0 || responseAggregateOmissions.length > 0,
      nextCursor: hasMore ? String(offset + page.length) : null,
      omissions,
      aggregateOmissions: responseAggregateOmissions,
      status,
      roots: stableRoots.map((node) => this.node(node)),
      ambiguousTargets,
      unresolvedTargets,
      dependents: page.map((item) => ({ node: this.node(item.node), hop: item.hop })),
      connectors: connectors.map((node) => this.node(node)),
      edges: returnedEdges.map((edge) => this.edge(edge)),
      affectedTests: affectedTests.map((node) => this.node(node)),
      beyondDepthByPackage: allBeyondDepthByPackage.slice(0, 100),
      boundaryCrossings: {
        available: false,
        count: 0,
        reason: "boundary-rule evaluations are not stored in the frozen snapshot schema"
      },
      message:
        stableRoots.length === 0
          ? input.diff !== undefined
            ? "diff did not map to snapshot nodes"
            : ambiguousTargets.length > 0
              ? "one or more targets are ambiguous"
              : "no targets found"
          : `${allDependents.length} reverse dependent(s) found`
    });
    this.log("impact", input, output);
    return output;
  }

  path(raw: unknown): PathOutput {
    const input: PathInput = pathInputSchema.parse(raw);
    const fromResolution = this.resolve(input.from);
    const toResolution = this.resolve(input.to);
    const fromBounded = this.boundedCandidates(fromResolution);
    const toBounded = this.boundedCandidates(toResolution);
    const fromCandidates = fromResolution.node === null ? fromBounded.candidates : [];
    const toCandidates = toResolution.node === null ? toBounded.candidates : [];
    if (fromResolution.node === null || toResolution.node === null) {
      const ambiguous =
        (fromResolution.node === null && fromCandidates.length > 0) ||
        (toResolution.node === null && toCandidates.length > 0);
      const returnedKeys = new Set(
        [...fromCandidates, ...toCandidates].map((node) => node.entityKey)
      );
      const combinedOmissions = [...fromBounded.omissions, ...toBounded.omissions]
        .filter((item) => !returnedKeys.has(item.entityKey));
      const rankByKind = { node: 0, edge: 0 };
      const omissions = [...new Map(
        combinedOmissions.map((item) => [`${item.targetKind}:${item.entityKey}`, item])
      ).values()]
        .slice(0, 100)
        .map((item) => ({ ...item, rank: (rankByKind[item.targetKind] += 1) }));
      const aggregateOmissions = [
        ...fromBounded.aggregateOmissions,
        ...toBounded.aggregateOmissions
      ];
      const output = pathOutputSchema.parse({
        context: this.context(),
        truncated: omissions.length > 0 || aggregateOmissions.length > 0,
        nextCursor: null,
        omissions,
        aggregateOmissions,
        status: ambiguous ? "ambiguous" : "not_found",
        from: fromResolution.node === null ? null : this.node(fromResolution.node),
        to: toResolution.node === null ? null : this.node(toResolution.node),
        fromCandidates,
        toCandidates,
        paths: [],
        nearestApproach: [],
        message: ambiguous ? "path endpoint is ambiguous" : "path endpoint not found"
      });
      this.log("path", input, output);
      return output;
    }
    const allowed = new Set(input.relations);
    type SearchPath = { nodeKeys: string[]; edges: GraphEdge[] };
    const queue: SearchPath[] = [{ nodeKeys: [fromResolution.node.entityKey], edges: [] }];
    const found: SearchPath[] = [];
    const reached = new Map<string, number>([[fromResolution.node.entityKey, 0]]);
    let expansions = 0;
    let depthLimited = false;
    let queueLimited = false;
    while (queue.length > 0 && found.length < input.k && expansions < 50_000) {
      const current = queue.shift()!;
      const key = current.nodeKeys.at(-1)!;
      if (key === toResolution.node.entityKey) {
        found.push(current);
        continue;
      }
      if (current.edges.length >= 64) {
        if ((this.service.outEdges.get(key) ?? []).some((edge) => allowed.has(edge.relation))) {
          depthLimited = true;
        }
        continue;
      }
      const outgoing = (this.service.outEdges.get(key) ?? [])
        .filter((edge) => allowed.has(edge.relation))
        .sort((a, b) => a.entityKey.localeCompare(b.entityKey));
      for (const edge of outgoing) {
        if (current.nodeKeys.includes(edge.dstEntityKey)) {
          continue;
        }
        const next = {
          nodeKeys: [...current.nodeKeys, edge.dstEntityKey],
          edges: [...current.edges, edge]
        };
        reached.set(edge.dstEntityKey, Math.max(reached.get(edge.dstEntityKey) ?? 0, next.edges.length));
        if (queue.length < 50_000) {
          queue.push(next);
        } else {
          queueLimited = true;
        }
      }
      expansions += 1;
    }
    const searchIncomplete = expansions >= 50_000 || depthLimited || queueLimited;
    const reverseDistance = new Map<string, number>([[toResolution.node.entityKey, 0]]);
    const reverseQueue = [toResolution.node.entityKey];
    while (reverseQueue.length > 0 && reverseDistance.size <= 50_000) {
      const current = reverseQueue.shift()!;
      const depth = reverseDistance.get(current)!;
      for (const edge of this.service.inEdges.get(current) ?? []) {
        if (allowed.has(edge.relation) && !reverseDistance.has(edge.srcEntityKey)) {
          reverseDistance.set(edge.srcEntityKey, depth + 1);
          reverseQueue.push(edge.srcEntityKey);
        }
      }
    }
    const nearestKeys = found.length > 0
      ? []
      : [...reached]
          .map(([key, sourceDepth]) => ({
            key,
            sourceDepth,
            targetDistance: reverseDistance.get(key) ?? Number.POSITIVE_INFINITY
          }))
          .sort(
            (a, b) =>
              a.targetDistance - b.targetDistance ||
              b.sourceDepth - a.sourceDepth ||
              a.key.localeCompare(b.key)
          )
          .slice(0, 5)
          .map((item) => item.key);
    const aggregateOmissions: AggregateOmission[] = searchIncomplete
      ? [{
          category: "path_search_frontier",
          count: Math.max(1, queue.length),
          reason: depthLimited ? "path_depth_safety_limit" : "path_search_safety_limit",
          continuation: "narrow the relation set or endpoints",
          criticalContextPreserved: false
        }]
      : [];
    const output = pathOutputSchema.parse({
      context: this.context(),
      truncated: searchIncomplete,
      nextCursor: null,
      omissions: [],
      aggregateOmissions,
      status: found.length > 0 ? "ok" : searchIncomplete ? "search_limit" : "no_path",
      from: this.node(fromResolution.node),
      to: this.node(toResolution.node),
      fromCandidates: [],
      toCandidates: [],
      paths: found.map((item) => ({
        nodes: item.nodeKeys.map((key) => this.node(this.service.nodesByKey.get(key)!)),
        edges: item.edges.map((edge) => this.edge(edge))
      })),
      nearestApproach: nearestKeys
        .map((key) => this.service.nodesByKey.get(key))
        .filter((node): node is GraphNode => node !== undefined)
        .map((node) => this.node(node)),
      message:
        found.length > 0
          ? `${found.length} directed path(s) found`
          : searchIncomplete
            ? "path search stopped at a declared safety limit"
            : "no directed path found"
    });
    this.log("path", input, output);
    return output;
  }
}
