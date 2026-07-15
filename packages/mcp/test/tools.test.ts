import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertSnapshotGraph, openDatabase, runMigrations, type Database } from "@tadori/store";
import { EventLog } from "../src/events.js";
import { GraphService } from "../src/service.js";
import { TadoriTools } from "../src/tools.js";
import { makeEdge, makeGraph, makeNode } from "./helpers.js";
import { createMcpFixture, type McpFixture } from "./setup.js";

let db: Database;
let tempRoot: string;
let fixture: McpFixture;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
  tempRoot = mkdtempSync(path.join(tmpdir(), "tadori-mcp-tools-"));
  fixture = createMcpFixture(db, tempRoot);
});

afterEach(() => {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("TadoriTools", () => {
  it("returns snapshot-backed repository structure and relation counts", () => {
    const output = fixture.tools.repoOverview({});
    expect(output.counts).toMatchObject({ files: 3, nodes: 8, edges: 8 });
    expect(output.counts.relations.calls).toBe(1);
    expect(output.packages[0]).toMatchObject({ fileCount: 3, symbolCount: 5 });
    expect(output.routes).toHaveLength(1);
    expect(output.entryPoints.available).toBe(false);
    expect(output.boundaryRules.available).toBe(false);
  });

  it("searches with exact boost and paginates without losing total counts", () => {
    const exact = fixture.tools.findSymbol({ query: "  target  ", limit: 10 });
    expect(exact.matches[0]?.entityKey).toBe(fixture.nodes.target.entityKey);

    const first = fixture.tools.findSymbol({ query: "app", limit: 1 });
    expect(first.matches).toHaveLength(1);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBe("1");
    expect(first.omissions).toHaveLength(1);
    const second = fixture.tools.findSymbol({ query: "app", limit: 1, cursor: "1" });
    expect(second.matches[0]?.entityKey).not.toBe(first.matches[0]?.entityKey);
    expect(second.totalMatches).toBe(first.totalMatches);
  });

  it("returns bounded structural context with linked tests, documents, and provenance", () => {
    const output = fixture.tools.symbolContext({
      anchor: fixture.nodes.target.entityKey,
      relations: ["calls", "tests", "documents"],
      depth: 1,
      tokenBudget: 50_000
    });
    expect(output.status).toBe("ok");
    expect(output.anchor?.body).toContain("function target");
    expect(output.nodes.map((node) => node.entityKey)).toEqual(
      expect.arrayContaining([
        fixture.nodes.caller.entityKey,
        fixture.nodes.test.entityKey,
        fixture.nodes.doc.entityKey
      ])
    );
    expect(output.linkedTests).toHaveLength(1);
    expect(output.linkedDocuments).toHaveLength(1);
    expect(output.decisionsAvailable).toBe(false);
    expect(output.edges.every((edge) => edge.origin === "compiler")).toBe(true);
    expect(
      output.relationGroups.every(
        (group) =>
          group.nodeEntityKeys.every((key) =>
            [...output.nodes, ...output.connectors].some((node) => node.entityKey === key)
          ) &&
          group.edgeEntityKeys.every((key) =>
            output.edges.some((edge) => edge.entityKey === key)
          )
      )
    ).toBe(true);
    expect(output.selection).toMatchObject({
      policyVersion: "tadori-v2.1-week5-linear-v1",
      taskTextStatus: "unavailable",
      pageOffset: 0,
      returnedCandidateCount: 3,
      totalCandidateCount: 3,
      criticalRequiredOmittedCount: 0
    });
    expect(output.selection.ranking[0]?.hardRequirements.length).toBeGreaterThan(0);
    expect(output.selection.estimatedResponseTokens).toBe(
      Math.ceil(JSON.stringify(output).length / 4)
    );

    const callsOnly = fixture.tools.symbolContext({
      anchor: fixture.nodes.target.entityKey,
      relations: ["calls"],
      depth: 1,
      tokenBudget: 50_000
    });
    expect(callsOnly.nodes.map((node) => node.entityKey)).toEqual(
      expect.arrayContaining([
        fixture.nodes.caller.entityKey,
        fixture.nodes.test.entityKey
      ])
    );
    expect(callsOnly.nodes.map((node) => node.entityKey)).not.toContain(
      fixture.nodes.doc.entityKey
    );
    expect(callsOnly.linkedTests).toContain(fixture.nodes.test.entityKey);
    expect(
      callsOnly.selection.ranking.find(
        (entry) => entry.entityKey === fixture.nodes.test.entityKey
      )?.hardRequirements
    ).toContain("certain_linked_test");

    const tiny = fixture.tools.symbolContext({
      anchor: fixture.nodes.target.entityKey,
      relations: ["calls", "tests", "documents"],
      depth: 1,
      tokenBudget: 1_024
    });
    expect(tiny.truncated).toBe(true);
    expect(tiny.nodes.length).toBeGreaterThan(0);
    expect(tiny.nextCursor).not.toBe("0");
    expect(tiny.omissions.length + tiny.aggregateOmissions.length).toBeGreaterThan(0);
    expect(tiny.selection.hardRequiredContextRemaining).toBe(true);
    expect(
      tiny.omissions.some((omission) => omission.targetKind === "node")
    ).toBe(true);
    expect(Math.ceil(JSON.stringify(tiny).length / 4)).toBeLessThanOrEqual(1_024);
    expect(tiny.selection.estimatedResponseTokens).toBe(
      Math.ceil(JSON.stringify(tiny).length / 4)
    );
  });

  it("labels test linkage honestly and never fabricates runtime coverage", () => {
    const linked = fixture.tools.findTests({ target: fixture.nodes.target.entityKey });
    expect(linked.heading).toBe("Likely relevant tests");
    expect(linked.tests[0]).toMatchObject({
      linkage: "statically_linked",
      runHint: null,
      runHintStatus: "unavailable_in_snapshot"
    });
    const empty = fixture.tools.findTests({ target: fixture.nodes.caller.entityKey });
    expect(empty.message).toBe("no linked tests found");
  });

  it("computes reverse impact and directed paths with evidence-bearing edges", () => {
    const impact = fixture.tools.impact({
      targets: [fixture.nodes.target.entityKey],
      depth: 2
    });
    expect(impact.dependents.map((item) => item.node.entityKey)).toContain(
      fixture.nodes.caller.entityKey
    );
    expect(impact.affectedTests.map((node) => node.entityKey)).toContain(
      fixture.nodes.test.entityKey
    );
    expect(impact.boundaryCrossings.available).toBe(false);

    const graphPath = fixture.tools.path({
      from: fixture.nodes.caller.entityKey,
      to: fixture.nodes.target.entityKey,
      relations: ["calls"],
      k: 3
    });
    expect(graphPath.status).toBe("ok");
    expect(graphPath.paths[0]?.edges[0]).toMatchObject({
      relation: "calls",
      origin: "compiler",
      confidence: "certain",
      resolution: "resolved"
    });
  });

  it("maps unified diff hunks to overlapping node spans only", () => {
    const output = fixture.tools.impact({
      diff: [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,1 +1,1 @@",
        "-export function target() { return 1; }",
        "+export function target() { return 2; }"
      ].join("\n"),
      depth: 1
    });
    const rootKeys = output.roots.map((node) => node.entityKey);
    expect(rootKeys).toContain(fixture.nodes.target.entityKey);
    expect(rootKeys).not.toContain(fixture.nodes.caller.entityKey);
  });

  it("classifies heuristic test linkage and bounds high-degree test results", () => {
    const tests = Array.from({ length: 55 }, (_, index) =>
      makeNode("test", `test/app.test.ts.case ${index}`, "test/app.test.ts", {
        displayName: `case ${index}`
      })
    );
    const nodes = [
      ...fixture.service.graph.nodes.filter((node) => node.kind !== "test"),
      ...tests
    ];
    const edges = [
      ...fixture.service.graph.edges.filter((edge) => edge.relation !== "tests"),
      ...tests.map((test) => ({
        ...makeEdge(test, "tests", fixture.nodes.target),
        origin: "heuristic" as const,
        confidence: "likely" as const,
        resolution: "partial" as const
      }))
    ];
    insertSnapshotGraph(
      db,
      makeGraph(tempRoot, fixture.service.graph.files, nodes, edges, "commit")
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(service, new EventLog(db, service, "vitest", "bounded tests"));
    const output = tools.findTests({ target: fixture.nodes.target.entityKey });
    expect(output.tests).toHaveLength(50);
    expect(output.tests.every((link) => link.linkage === "naming_associated")).toBe(true);
    expect(output.truncated).toBe(true);
    expect(output.omissions.length + output.aggregateOmissions.length).toBeGreaterThan(0);
  });

  it("enforces the whole-response budget for ambiguous symbol candidates", () => {
    const ambiguousNodes = Array.from({ length: 50 }, (_, index) =>
      makeNode("function", `src/app.ts.ambiguous${index}`, "src/app.ts", {
        displayName: "ambiguous"
      })
    );
    insertSnapshotGraph(
      db,
      makeGraph(tempRoot, fixture.service.graph.files, ambiguousNodes, [], "commit")
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "ambiguous budget")
    );
    const output = tools.symbolContext({
      anchor: "ambiguous",
      relations: ["calls"],
      depth: 1,
      tokenBudget: 1_024
    });
    expect(output.status).toBe("ambiguous");
    expect(output.candidates.length).toBeLessThan(50);
    expect(output.truncated).toBe(true);
    expect(Math.ceil(JSON.stringify(output).length / 4)).toBeLessThanOrEqual(1_024);
    expect(output.selection.estimatedResponseTokens).toBe(
      Math.ceil(JSON.stringify(output).length / 4)
    );
    const repeated = tools.symbolContext({
      anchor: "ambiguous",
      relations: ["calls"],
      depth: 1,
      tokenBudget: 1_024
    });
    expect(repeated).toEqual(output);
    const second = tools.symbolContext({
      anchor: "ambiguous",
      relations: ["calls"],
      depth: 1,
      tokenBudget: 1_024,
      cursor: output.nextCursor!
    });
    expect(second.selection.pageOffset).toBe(output.candidates.length);
    expect(second.candidates.map((node) => node.entityKey)).not.toEqual(
      expect.arrayContaining(output.candidates.map((node) => node.entityKey))
    );
    expect(
      output.candidates.length + output.omissions.length +
        output.aggregateOmissions.reduce((total, item) => total + item.count, 0)
    ).toBe(50);
  });

  it("degrades long ambiguous signatures to names before dropping every candidate", () => {
    const ambiguousNodes = Array.from({ length: 20 }, (_, index) =>
      makeNode("function", `src/app.ts.longAmbiguous${index}`, "src/app.ts", {
        displayName: "long ambiguous",
        signature: `function longAmbiguous${index}(${"parameter: string, ".repeat(80)}): void`
      })
    );
    insertSnapshotGraph(
      db,
      makeGraph(tempRoot, fixture.service.graph.files, ambiguousNodes, [], "commit")
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "long ambiguous budget")
    );
    const output = tools.symbolContext({
      anchor: "long ambiguous",
      relations: ["calls"],
      depth: 1,
      tokenBudget: 1_024
    });
    expect(output.status).toBe("ambiguous");
    expect(output.candidates.length).toBeGreaterThan(0);
    expect(output.candidates.every((node) => node.representation === "name")).toBe(true);
    expect(output.candidates.every((node) => node.signature === null)).toBe(true);
    expect(output.selection.candidateRepresentation).toBe("name");
    expect(Number(output.nextCursor)).toBeGreaterThan(0);
    expect(output.selection.estimatedResponseTokens).toBeLessThanOrEqual(1_024);
  });

  it("ranks and paginates high-degree hard context without silent omissions", () => {
    const callers = Array.from({ length: 115 }, (_, index) =>
      makeNode("function", `src/app.ts.rankedCaller${index}`, "src/app.ts")
    );
    const edges = callers.map((caller) =>
      makeEdge(caller, "calls", fixture.nodes.target)
    );
    insertSnapshotGraph(
      db,
      makeGraph(
        tempRoot,
        fixture.service.graph.files,
        [fixture.nodes.target, ...callers],
        edges,
        "commit"
      )
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "ranked context page")
    );
    const args = {
      anchor: fixture.nodes.target.entityKey,
      relations: ["calls"] as const,
      depth: 1 as const,
      tokenBudget: 50_000
    };
    const first = tools.symbolContext(args);
    const repeated = tools.symbolContext(args);
    expect(repeated).toEqual(first);
    expect(first.nextCursor).not.toBeNull();
    expect(first.selection.returnedCandidateCount).toBe(first.nodes.length);
    expect(first.selection.criticalRequiredOmittedCount).toBe(
      callers.length - first.nodes.length
    );
    expect(
      first.selection.ranking
        .slice(0, first.nodes.length)
        .every((entry) => entry.hardRequirements.includes("direct_caller_or_callee"))
    ).toBe(true);
    expect(first.selection.estimatedResponseTokens).toBe(
      Math.ceil(JSON.stringify(first).length / 4)
    );
    expect(first.selection.estimatedResponseTokens).toBeLessThanOrEqual(args.tokenBudget);

    const omittedEntityCount =
      first.omissions.length +
      first.aggregateOmissions.reduce((total, omission) => total + omission.count, 0);
    expect(omittedEntityCount).toBe(
      callers.length - first.nodes.length + (edges.length - first.edges.length)
    );

    const second = tools.symbolContext({ ...args, cursor: first.nextCursor! });
    const firstKeys = new Set(first.nodes.map((node) => node.entityKey));
    expect(second.nodes.every((node) => !firstKeys.has(node.entityKey))).toBe(true);
    expect(second.selection.pageOffset).toBe(first.selection.returnedCandidateCount);
    const expectedOrder = callers
      .map((node) => node.entityKey)
      .sort((left, right) => left.localeCompare(right));
    expect([...first.nodes, ...second.nodes].map((node) => node.entityKey)).toEqual(
      expectedOrder
    );

    const exactBoundary = tools.symbolContext({
      ...args,
      tokenBudget: first.selection.estimatedResponseTokens
    });
    expect(exactBoundary).toEqual(first);
    expect(exactBoundary.selection.estimatedResponseTokens).toBe(
      first.selection.estimatedResponseTokens
    );
  });

  it("orders confidence explicitly while preserving unresolved edge evidence", () => {
    const certain = makeNode("function", "src/app.ts.certainCaller", "src/app.ts");
    const inferred = makeNode("function", "src/app.ts.inferredCaller", "src/app.ts");
    const certainEdge = makeEdge(certain, "calls", fixture.nodes.target);
    const inferredEdge = {
      ...makeEdge(inferred, "calls", fixture.nodes.target),
      origin: "heuristic" as const,
      confidence: "inferred" as const,
      resolution: "unresolved" as const
    };
    insertSnapshotGraph(
      db,
      makeGraph(
        tempRoot,
        fixture.service.graph.files,
        [fixture.nodes.target, inferred, certain],
        [inferredEdge, certainEdge],
        "commit"
      )
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "confidence context")
    );
    const output = tools.symbolContext({
      anchor: fixture.nodes.target.entityKey,
      relations: ["calls"],
      depth: 1,
      tokenBudget: 50_000
    });
    expect(output.nodes.map((node) => node.entityKey)).toEqual([
      certain.entityKey,
      inferred.entityKey
    ]);
    expect(output.selection.ranking.map((entry) => entry.confidence)).toEqual([
      "certain",
      "inferred"
    ]);
    expect(output.selection.ranking.map((entry) => entry.hardPriority)).toEqual([2, 1]);
    expect(output.edges).toContainEqual(
      expect.objectContaining({
        entityKey: inferredEdge.entityKey,
        origin: "heuristic",
        confidence: "inferred",
        resolution: "unresolved"
      })
    );
  });

  it("hard-includes signature types without fabricating an edge", () => {
    const typedTarget = makeNode("function", "src/app.ts.typedTarget", "src/app.ts", {
      displayName: "typedTarget",
      signature: "function typedTarget(input: RequestShape): void"
    });
    const caller = makeNode("function", "src/app.ts.typedCaller", "src/app.ts");
    const requestShape = makeNode(
      "interface",
      "src/app.ts.RequestShape",
      "src/app.ts",
      { displayName: "RequestShape", signature: "interface RequestShape" }
    );
    const call = makeEdge(caller, "calls", typedTarget);
    insertSnapshotGraph(
      db,
      makeGraph(
        tempRoot,
        fixture.service.graph.files,
        [typedTarget, caller, requestShape],
        [call],
        "commit"
      )
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "signature hard include")
    );
    const output = tools.symbolContext({
      anchor: typedTarget.entityKey,
      relations: ["calls"],
      depth: 1,
      tokenBudget: 50_000
    });
    expect(output.nodes.map((node) => node.entityKey)).toEqual(
      expect.arrayContaining([caller.entityKey, requestShape.entityKey])
    );
    const typeRanking = output.selection.ranking.find(
      (entry) => entry.entityKey === requestShape.entityKey
    );
    expect(typeRanking?.hardRequirements).toContain("signature_type_definition");
    expect(typeRanking?.confidence).toBeNull();
    expect(output.edges.map((edge) => edge.entityKey)).toEqual([call.entityKey]);
  });

  it("does not infer anchor-hard requirements from unrelated incident edges", () => {
    const neighbor = makeNode("function", "src/app.ts.importNeighbor", "src/app.ts");
    const child = makeNode("function", "src/app.ts.importChild", "src/app.ts");
    const edges = [
      makeEdge(neighbor, "imports", fixture.nodes.target),
      makeEdge(neighbor, "calls", child)
    ];
    insertSnapshotGraph(
      db,
      makeGraph(
        tempRoot,
        fixture.service.graph.files,
        [fixture.nodes.target, neighbor, child],
        edges,
        "commit"
      )
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "anchor-specific hard facts")
    );
    const output = tools.symbolContext({
      anchor: fixture.nodes.target.entityKey,
      relations: ["imports", "calls"],
      depth: 2,
      tokenBudget: 50_000
    });
    expect(
      output.selection.ranking.every((entry) => entry.hardRequirements.length === 0)
    ).toBe(true);
    expect(
      output.selection.ranking.find((entry) => entry.entityKey === neighbor.entityKey)
        ?.confidence
    ).toBe("certain");
  });

  it("returns future-ranked connector nodes without also reporting them as omitted", () => {
    const parent = makeNode("function", "src/app.ts.connector", "src/app.ts");
    const children = Array.from({ length: 10 }, (_, index) =>
      makeNode("function", `src/app.ts.connectorChild${index}`, "src/app.ts")
    );
    const edges = [
      makeEdge(parent, "imports", fixture.nodes.target),
      ...children.map((child) => makeEdge(parent, "imports", child))
    ];
    insertSnapshotGraph(
      db,
      makeGraph(
        tempRoot,
        fixture.service.graph.files,
        [fixture.nodes.target, parent, ...children],
        edges,
        "commit"
      )
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "context connector")
    );
    const output = tools.symbolContext({
      anchor: fixture.nodes.target.entityKey,
      relations: ["imports"],
      depth: 2,
      tokenBudget: 2_500
    });
    expect(output.connectors.map((node) => node.entityKey)).toContain(parent.entityKey);
    expect(output.selection.returnedConnectorCount).toBe(1);
    const omittedNodeKeys = new Set(
      output.omissions
        .filter((omission) => omission.targetKind === "node")
        .map((omission) => omission.entityKey)
    );
    expect(omittedNodeKeys.has(parent.entityKey)).toBe(false);
    expect(
      [...output.nodes, ...output.connectors].every(
        (node) => !omittedNodeKeys.has(node.entityKey)
      )
    ).toBe(true);
    const detailedNodeOmissions = output.omissions.filter(
      (omission) => omission.targetKind === "node"
    ).length;
    const aggregateNodeOmissions = output.aggregateOmissions
      .filter((omission) => omission.category === "context_nodes")
      .reduce((total, omission) => total + omission.count, 0);
    expect(
      output.nodes.length + output.connectors.length + detailedNodeOmissions +
        aggregateNodeOmissions
    ).toBe(1 + children.length);
    expect(output.selection.estimatedResponseTokens).toBeLessThanOrEqual(2_500);
  });

  it("finishes a full context page when its only remainder was returned as a connector", () => {
    const anchor = makeNode("function", "anchor", null);
    const parent = makeNode("function", "connector", null);
    const children = Array.from({ length: 100 }, (_, index) =>
      makeNode("function", `connectorChild${index}`, null)
    );
    const edges = [
      makeEdge(parent, "imports", anchor),
      ...children.map((child) => makeEdge(parent, "imports", child))
    ];
    insertSnapshotGraph(
      db,
      makeGraph(
        tempRoot,
        fixture.service.graph.files,
        [anchor, parent, ...children],
        edges,
        "commit"
      )
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(
      service,
      new EventLog(db, service, "vitest", "terminal connector page")
    );
    const output = tools.symbolContext({
      anchor: anchor.entityKey,
      relations: ["imports"],
      depth: 2,
      tokenBudget: 50_000
    });
    expect(output.nodes).toHaveLength(100);
    expect(output.connectors.map((node) => node.entityKey)).toEqual([parent.entityKey]);
    expect(output.selection.returnedConnectorCount).toBe(1);
    expect(output.selection.unavailableSignals).toContain("same_package");
    expect(output.edges).toHaveLength(101);
    expect(output).toMatchObject({ truncated: false, nextCursor: null });
    expect(output.omissions).toEqual([]);
    expect(output.aggregateOmissions).toEqual([]);
  });

  it("rejects duplicate relation filters before they can multiply response groups", () => {
    expect(() =>
      fixture.tools.symbolContext({
        anchor: fixture.nodes.target.entityKey,
        relations: ["calls", "calls"],
        depth: 1,
        tokenBudget: 50_000
      })
    ).toThrow(/relations must be unique/);
  });

  it("labels an incomplete long-path search instead of claiming no path", () => {
    const chain = Array.from({ length: 66 }, (_, index) =>
      makeNode("function", `src/app.ts.chain${index}`, "src/app.ts")
    );
    const edges = chain.slice(0, -1).map((node, index) =>
      makeEdge(node, "calls", chain[index + 1]!)
    );
    insertSnapshotGraph(
      db,
      makeGraph(tempRoot, fixture.service.graph.files, chain, edges, "commit")
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(service, new EventLog(db, service, "vitest", "long path"));
    const output = tools.path({
      from: chain[0]!.entityKey,
      to: chain.at(-1)!.entityKey,
      relations: ["calls"],
      k: 1
    });
    expect(output).toMatchObject({ status: "search_limit", truncated: true });
    expect(output.aggregateOmissions[0]?.category).toBe("path_search_frontier");
  });

  it("keeps connector nodes and edges on later impact pages", () => {
    const callers = Array.from({ length: 101 }, (_, index) =>
      makeNode("function", `src/app.ts.caller${index}`, "src/app.ts")
    );
    const secondHop = makeNode("function", "src/app.ts.secondHop", "src/app.ts");
    const nodes = [fixture.nodes.target, ...callers, secondHop];
    const edges = [
      ...callers.map((caller) => makeEdge(caller, "calls", fixture.nodes.target)),
      makeEdge(secondHop, "calls", callers[0]!)
    ];
    insertSnapshotGraph(
      db,
      makeGraph(tempRoot, fixture.service.graph.files, nodes, edges, "commit")
    );
    const service = GraphService.open(db, tempRoot);
    const tools = new TadoriTools(service, new EventLog(db, service, "vitest", "impact page"));
    const first = tools.impact({ targets: [fixture.nodes.target.entityKey], depth: 2 });
    const second = tools.impact({
      targets: [fixture.nodes.target.entityKey],
      depth: 2,
      cursor: first.nextCursor!
    });
    expect(second.dependents.map((item) => item.node.entityKey)).toContain(secondHop.entityKey);
    expect(second.connectors.map((node) => node.entityKey)).toContain(callers[0]!.entityKey);
    expect(second.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          srcEntityKey: secondHop.entityKey,
          dstEntityKey: callers[0]!.entityKey
        })
      ])
    );
  });

  it("propagates stale state and logs every valid call", () => {
    fixture.tools.repoOverview({});
    appendFileSync(path.join(tempRoot, "src", "app.ts"), "// changed\n", "utf8");
    const output = fixture.tools.findSymbol({ query: "target", limit: 10 });
    expect(output.context).toMatchObject({ freshness: "stale", stale: true });
    expect(output.matches[0]).toMatchObject({ freshness: "stale", stale: true });

    const count = db.prepare("SELECT COUNT(*) AS count FROM retrieval_events").get() as {
      count: number;
    };
    expect(count.count).toBe(2);
  });
});
