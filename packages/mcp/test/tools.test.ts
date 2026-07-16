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

    const tiny = fixture.tools.symbolContext({
      anchor: fixture.nodes.target.entityKey,
      relations: ["calls", "tests", "documents"],
      depth: 1,
      tokenBudget: 1_024
    });
    expect(tiny.truncated).toBe(true);
    expect(tiny.omissions.length).toBeGreaterThan(0);
    expect(Math.ceil(JSON.stringify(tiny).length / 4)).toBeLessThanOrEqual(1_024);
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
