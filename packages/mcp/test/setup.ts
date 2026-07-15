import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GraphNode } from "@tadori/core";
import { insertSnapshotGraph, type Database } from "@tadori/store";
import { EventLog } from "../src/events.js";
import { GraphService } from "../src/service.js";
import { TadoriTools } from "../src/tools.js";
import { makeEdge, makeFile, makeGraph, makeNode } from "./helpers.js";

export interface McpFixture {
  service: GraphService;
  eventLog: EventLog;
  tools: TadoriTools;
  nodes: Record<"package" | "sourceFile" | "target" | "caller" | "test" | "doc" | "route", GraphNode>;
}

export function createMcpFixture(db: Database, repoRoot: string): McpFixture {
  const sources = {
    "src/app.ts": "export function target() { return 1; }\nexport function caller() { return target(); }\n",
    "test/app.test.ts": "test('target', () => target());\n",
    "docs/adr.md": "# Keep target synchronous\n"
  };
  for (const [normalizedPath, source] of Object.entries(sources)) {
    const absolute = path.join(repoRoot, normalizedPath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, source, "utf8");
  }
  const files = Object.entries(sources).map(([normalizedPath, source]) =>
    makeFile(normalizedPath, source)
  );
  const packageNode = makeNode("package", "fixture", null, { displayName: "fixture" });
  const sourceFile = makeNode("file", "src/app.ts", "src/app.ts", { displayName: "app.ts" });
  const testFile = makeNode("file", "test/app.test.ts", "test/app.test.ts", {
    displayName: "app.test.ts"
  });
  const target = makeNode("function", "src/app.ts.target", "src/app.ts", {
    displayName: "target",
    signature: "function target(): number",
    lineStart: 1,
    lineEnd: 1
  });
  const caller = makeNode("function", "src/app.ts.caller", "src/app.ts", {
    displayName: "caller",
    signature: "function caller(): number",
    lineStart: 2,
    lineEnd: 2
  });
  const test = makeNode("test", "test/app.test.ts.target test", "test/app.test.ts", {
    displayName: "target test"
  });
  const doc = makeNode("doc_section", "docs/adr.md.Keep target synchronous", "docs/adr.md", {
    displayName: "Keep target synchronous"
  });
  const route = makeNode("route", "GET /target", "src/app.ts", {
    displayName: "GET /target",
    lineStart: 1,
    lineEnd: 1
  });
  const nodes = [packageNode, sourceFile, testFile, target, caller, test, doc, route];
  const edges = [
    makeEdge(packageNode, "contains", sourceFile),
    makeEdge(packageNode, "contains", testFile),
    makeEdge(sourceFile, "contains", target),
    makeEdge(sourceFile, "contains", caller),
    makeEdge(caller, "calls", target),
    makeEdge(test, "tests", target),
    makeEdge(doc, "documents", target),
    makeEdge(route, "routes_to", target)
  ];
  insertSnapshotGraph(db, makeGraph(repoRoot, files, nodes, edges));
  const service = GraphService.open(db, repoRoot);
  const eventLog = new EventLog(db, service, "vitest", "MCP contract test");
  return {
    service,
    eventLog,
    tools: new TadoriTools(service, eventLog),
    nodes: { package: packageNode, sourceFile, target, caller, test, doc, route }
  };
}
