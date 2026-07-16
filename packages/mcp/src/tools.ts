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
import { estimateTokens, type EntityResolution, type GraphService } from "./service.js";

const IMPACT_RELATIONS: ReadonlySet<Relation> = new Set(["calls", "imports"]);
const OVERVIEW_RESULT_LIMIT = 100;
const IMPACT_PAGE_SIZE = 100;
const AMBIGUITY_LIMIT = 50;
const FIND_TESTS_LIMIT = 50;
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
    return {
      entityKey: node.entityKey,
      kind: node.kind,
      qualifiedName: node.qualifiedName,
      displayName: node.displayName,
      file: node.file,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      signature: node.signature,
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
      const bounded = this.boundedCandidates(resolved);
      const wasAmbiguous = resolved.candidates.length > 0;
      const candidates = [...bounded.candidates];
      const allOmissions = [...bounded.omissions];
      const buildAmbiguousOutput = (): SymbolContextOutput => {
        const returnedKeys = new Set(candidates.map((candidate) => candidate.entityKey));
        const rankByKind = { node: 0, edge: 0 };
        const uniqueOmissions = [...new Map(
          allOmissions
            .filter((item) => !returnedKeys.has(item.entityKey))
            .map((item) => [`${item.targetKind}:${item.entityKey}`, item])
        ).values()].map((item) => ({
          ...item,
          rank: (rankByKind[item.targetKind] += 1)
        }));
        const omissions = uniqueOmissions.slice(0, 10);
        const aggregateOmissions = [...bounded.aggregateOmissions];
        if (uniqueOmissions.length > omissions.length) {
          aggregateOmissions.push({
            category: "ambiguous_candidates",
            count: uniqueOmissions.length - omissions.length,
            reason: "token_budget",
            continuation: "refine the entity reference with find_symbol",
            criticalContextPreserved: false
          });
        }
        return symbolContextOutputSchema.parse({
          context: this.context(),
          truncated: omissions.length > 0 || aggregateOmissions.length > 0,
          nextCursor: null,
          omissions,
          aggregateOmissions,
          status: wasAmbiguous ? "ambiguous" : "not_found",
          anchor: null,
          candidates,
          nodes: [],
          edges: [],
          relationGroups: [],
          linkedTests: [],
          linkedDocuments: [],
          decisionsAvailable: false,
          bodySuppressedReason: null
        });
      };
      let output = buildAmbiguousOutput();
      while (estimateTokens(JSON.stringify(output)) > input.tokenBudget && candidates.length > 0) {
        const omitted = candidates.pop()!;
        allOmissions.push({
          targetKind: "node",
          entityKey: omitted.entityKey,
          rank: 1,
          score: null,
          reason: "token_budget"
        });
        output = buildAmbiguousOutput();
      }
      if (estimateTokens(JSON.stringify(output)) > input.tokenBudget) {
        throw new RangeError(
          `tokenBudget ${input.tokenBudget} cannot fit the required response envelope`
        );
      }
      this.log("symbol_context", input, output, input.tokenBudget);
      return output;
    }

    const anchorBody = this.node(resolved.node, "body", Math.floor(input.tokenBudget / 2));
    const bodySuppressedReason =
      anchorBody.representation === "body"
        ? null
        : anchorBody.stale
          ? "source is stale or unavailable"
          : "body exceeds the response budget or has no source span";
    const allowed = new Set(input.relations);
    const distance = new Map<string, number>([[resolved.node.entityKey, 0]]);
    const queue = [resolved.node.entityKey];
    const traversed: GraphEdge[] = [];
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
          queue.push(other);
        }
      }
    }
    const candidateNodes = uniqueNodes(
      [...distance.keys()]
        .filter((key) => key !== resolved.node!.entityKey)
        .map((key) => this.service.nodesByKey.get(key))
        .filter((node): node is GraphNode => node !== undefined)
    );
    const selected: GraphNode[] = [];
    const allOmissions: Omission[] = [];
    let usedTokens = estimateTokens(JSON.stringify(anchorBody)) + 700;
    for (const [index, node] of candidateNodes.entries()) {
      const view = this.node(node);
      const cost = estimateTokens(JSON.stringify(view));
      if (usedTokens + cost <= input.tokenBudget) {
        selected.push(node);
        usedTokens += cost;
      } else {
        allOmissions.push({
          targetKind: "node",
          entityKey: node.entityKey,
          rank: index + 1,
          score: null,
          reason: "token_budget"
        });
      }
    }
    const visibleKeys = new Set([resolved.node.entityKey, ...selected.map((node) => node.entityKey)]);
    const selectedEdges: GraphEdge[] = [];
    for (const [index, edge] of uniqueEdges(traversed).entries()) {
      if (!visibleKeys.has(edge.srcEntityKey) || !visibleKeys.has(edge.dstEntityKey)) {
        allOmissions.push({
          targetKind: "edge",
          entityKey: edge.entityKey,
          rank: index + 1,
          score: null,
          reason: "endpoint_omitted"
        });
        continue;
      }
      const view = this.edge(edge);
      const cost = estimateTokens(JSON.stringify(view));
      if (usedTokens + cost <= input.tokenBudget) {
        selectedEdges.push(edge);
        usedTokens += cost;
      } else {
        allOmissions.push({
          targetKind: "edge",
          entityKey: edge.entityKey,
          rank: index + 1,
          score: null,
          reason: "token_budget"
        });
      }
    }
    let anchorView = anchorBody;
    let suppressionReason = bodySuppressedReason;
    const buildOutput = (): SymbolContextOutput => {
      const rankByKind = { node: 0, edge: 0 };
      const rankedOmissions = allOmissions.map((omission) => ({
        ...omission,
        rank: (rankByKind[omission.targetKind] += 1)
      }));
      const omissions = rankedOmissions.slice(0, 10);
      const aggregateOmissions: AggregateOmission[] =
        rankedOmissions.length > omissions.length
          ? [{
              category: "context_entities",
              count: rankedOmissions.length - omissions.length,
              reason: "token_budget",
              continuation: null,
              criticalContextPreserved: true
            }]
          : [];
      const nodeViews = selected.map((node) => this.node(node));
      const edgeViews = selectedEdges.map((edge) => this.edge(edge));
      const linkedTests = nodeViews.filter((node) => node.kind === "test");
      const linkedDocuments = nodeViews.filter(
        (node) => node.kind === "adr" || node.kind === "doc_section"
      );
      const relationGroups = input.relations.map((relation) => {
        const groupEdges = edgeViews.filter((edge) => edge.relation === relation);
        const keys = new Set(
          groupEdges.flatMap((edge) => [edge.srcEntityKey, edge.dstEntityKey])
        );
        keys.delete(resolved.node!.entityKey);
        return {
          relation,
          nodes: nodeViews.filter((node) => keys.has(node.entityKey)),
          edges: groupEdges
        };
      });
      return symbolContextOutputSchema.parse({
        context: this.context(),
        truncated: allOmissions.length > 0,
        nextCursor: null,
        omissions,
        aggregateOmissions,
        status: "ok",
        anchor: anchorView,
        candidates: [],
        nodes: nodeViews,
        edges: edgeViews,
        relationGroups,
        linkedTests,
        linkedDocuments,
        decisionsAvailable: false,
        bodySuppressedReason: suppressionReason
      });
    };
    let output = buildOutput();
    if (estimateTokens(JSON.stringify(output)) > input.tokenBudget && anchorView.body !== null) {
      anchorView = this.node(resolved.node, "signature");
      suppressionReason = "body removed to satisfy the response token budget";
      output = buildOutput();
    }
    while (
      estimateTokens(JSON.stringify(output)) > input.tokenBudget &&
      (selectedEdges.length > 0 || selected.length > 0)
    ) {
      const edge = selectedEdges.pop();
      if (edge) {
        allOmissions.push({
          targetKind: "edge",
          entityKey: edge.entityKey,
          rank: allOmissions.filter((item) => item.targetKind === "edge").length + 1,
          score: null,
          reason: "token_budget"
        });
      } else {
        const node = selected.pop()!;
        allOmissions.push({
          targetKind: "node",
          entityKey: node.entityKey,
          rank: allOmissions.filter((item) => item.targetKind === "node").length + 1,
          score: null,
          reason: "token_budget"
        });
      }
      output = buildOutput();
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
