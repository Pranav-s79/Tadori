import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { entityKey, nodeCanonicalIdentity, type GraphEdge, type GraphNode } from "@tadori/core";
import { indexRepository, type IndexResult } from "@tadori/indexer";

const FIXTURE_ROOT = path.resolve(
  __dirname,
  "../../fixtures/01-core-symbols/repo"
);

let result: IndexResult;
let nodesByQualifiedName: Map<string, GraphNode>;
let edges: GraphEdge[];
let nodeByKey: Map<string, GraphNode>;

beforeAll(() => {
  result = indexRepository(FIXTURE_ROOT, { kind: "commit" });
  nodesByQualifiedName = new Map(result.graph.nodes.map((n) => [n.qualifiedName, n]));
  nodeByKey = new Map(result.graph.nodes.map((n) => [n.entityKey, n]));
  edges = result.graph.edges;
});

function edge(relation: string, srcQn: string, dstQn: string): GraphEdge | undefined {
  return edges.find(
    (e) =>
      e.relation === relation &&
      nodeByKey.get(e.srcEntityKey)?.qualifiedName === srcQn &&
      nodeByKey.get(e.dstEntityKey)?.qualifiedName === dstQn
  );
}

describe("fixture 01 core extraction", () => {
  it("normalizes repository-relative paths with forward slashes", () => {
    for (const file of result.graph.files) {
      expect(file.normalizedPath).not.toMatch(/\\/);
      expect(file.normalizedPath).not.toMatch(/^\.?\//);
    }
    expect(result.graph.files.map((f) => f.normalizedPath)).toContain("src/internal/secret.ts");
  });

  it("detects the package from package.json and emits one package node", () => {
    const pkg = result.graph.nodes.filter((n) => n.kind === "package");
    expect(pkg).toHaveLength(1);
    expect(pkg[0]?.qualifiedName).toBe("@tadori-fixtures/core-symbols");
    expect(pkg[0]?.entityKey).toBe(
      "64466d169092b1f47b92fdda7ec332c472677c66566d7f9590b25196967f6ecd"
    );
  });

  it("extracts functions with frozen entity keys", () => {
    const factorial = nodesByQualifiedName.get("src/math.ts.factorial");
    expect(factorial?.kind).toBe("function");
    expect(factorial?.exported).toBe(true);
    expect(factorial?.entityKey).toBe(
      "0bd3f4e85bab78e96fb891f977abd443d52a2423eb609557ff21e832a87d1992"
    );
  });

  it("extracts classes, interfaces, and methods with correct exported flags", () => {
    expect(nodesByQualifiedName.get("src/runner.ts.Runner")?.kind).toBe("class");
    expect(nodesByQualifiedName.get("src/runner.ts.Runner")?.exported).toBe(true);
    expect(nodesByQualifiedName.get("src/strategy.ts.Strategy")?.kind).toBe("interface");
    const method = nodesByQualifiedName.get("src/strategy.ts.DoubleStrategy.run");
    expect(method?.kind).toBe("method");
    expect(method?.exported).toBe(false);
    expect(method?.lineStart).toBe(6);
    expect(method?.lineEnd).toBe(8);
  });

  it("collapses the three format overloads into one logical node", () => {
    const formats = result.graph.nodes.filter((n) => n.displayName === "format");
    expect(formats).toHaveLength(1);
    const format = formats[0];
    expect(format?.lineStart).toBe(6);
    expect(format?.lineEnd).toBe(10);
  });

  it("does not create nodes for variables, ambient declarations, or built-ins", () => {
    expect(nodesByQualifiedName.has("src/handlers.ts.handlers")).toBe(false);
    expect(nodesByQualifiedName.has("tests/math.test.ts.test")).toBe(false);
    expect(nodesByQualifiedName.has("tests/mathy.test.ts.test")).toBe(false);
  });

  it("emits an imports edge for the aliased import with one-based evidence", () => {
    const aliased = edge("imports", "src/alias-consumer.ts", "src/math.ts");
    expect(aliased).toBeDefined();
    expect(aliased?.origin).toBe("compiler");
    expect(aliased?.confidence).toBe("certain");
    expect(aliased?.resolution).toBe("resolved");
    expect(aliased?.evidence[0]).toMatchObject({
      file: "src/alias-consumer.ts",
      lineStart: 1,
      lineEnd: 1
    });
  });

  it("emits imports edges for type-only imports", () => {
    expect(edge("imports", "src/runner.ts", "src/strategy.ts")).toBeDefined();
  });

  it("emits direct export edges", () => {
    expect(edge("exports", "src/math.ts", "src/math.ts.factorial")).toBeDefined();
    expect(edge("exports", "src/math.ts", "src/math.ts.format")).toBeDefined();
    expect(edge("exports", "src/internal/secret.ts", "src/internal/secret.ts.readSecret")).toBeDefined();
  });

  it("emits barrel re-export edges from the barrel file to the defining symbols", () => {
    for (const target of [
      "src/math.ts.factorial",
      "src/math.ts.format",
      "src/runner.ts.Runner",
      "src/strategy.ts.DoubleStrategy",
      "src/strategy.ts.TripleStrategy",
      "src/strategy.ts.Strategy"
    ]) {
      expect(edge("exports", "src/index.ts", target), `barrel export of ${target}`).toBeDefined();
    }
    // The barrel re-export statements also emit imports edges.
    expect(edge("imports", "src/index.ts", "src/math.ts")).toBeDefined();
    expect(edge("imports", "src/index.ts", "src/runner.ts")).toBeDefined();
    expect(edge("imports", "src/index.ts", "src/strategy.ts")).toBeDefined();
  });

  it("anchors the multi-line re-export's evidence across its statement range", () => {
    const strategyReexport = edge("exports", "src/index.ts", "src/strategy.ts.Strategy");
    expect(strategyReexport?.evidence[0]).toMatchObject({
      file: "src/index.ts",
      lineStart: 3,
      lineEnd: 7
    });
  });

  it("keeps the barrel file free of symbol nodes", () => {
    const barrelSymbols = result.graph.nodes.filter(
      (n) => n.file === "src/index.ts" && n.kind !== "file"
    );
    expect(barrelSymbols).toEqual([]);
  });

  it("produces every expected entity key deterministically on repeated runs", () => {
    const second = indexRepository(FIXTURE_ROOT, { kind: "commit" });
    expect(second.graph.workspaceHash).toBe(result.graph.workspaceHash);
    expect(second.graph.nodes.map((n) => n.entityKey)).toEqual(
      result.graph.nodes.map((n) => n.entityKey)
    );
    expect(second.graph.edges.map((e) => e.entityKey)).toEqual(
      result.graph.edges.map((e) => e.entityKey)
    );
    expect(second.graph.nodes.map((n) => n.bodyHash)).toEqual(
      result.graph.nodes.map((n) => n.bodyHash)
    );
  });

  it("keeps identity independent of extraction-time state", () => {
    const runner = nodesByQualifiedName.get("src/runner.ts.Runner");
    expect(runner?.canonicalIdentity).toBe(
      nodeCanonicalIdentity("class", "src/runner.ts.Runner")
    );
    expect(runner?.entityKey).toBe(entityKey(nodeCanonicalIdentity("class", "src/runner.ts.Runner")));
  });
});
