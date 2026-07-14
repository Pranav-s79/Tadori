import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexRepository } from "@tadori/indexer";
import { nextRouteRole } from "../src/semantics.js";

let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "tadori-week3-test-"));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

interface RepoSpec {
  [relPath: string]: string;
}

function makeRepo(name: string, files: RepoSpec): string {
  const repo = path.join(workdir, name);
  const base: RepoSpec = {
    "package.json": '{ "name": "@tadori-test/week3", "type": "module" }\n',
    "tsconfig.json":
      '{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true } }\n'
  };
  for (const [rel, contents] of Object.entries({ ...base, ...files })) {
    const absolute = path.join(repo, rel);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  return repo;
}

function edgesOf(repo: string) {
  const { graph } = indexRepository(repo, { kind: "commit" });
  const byKey = new Map(graph.nodes.map((n) => [n.entityKey, n]));
  return {
    graph,
    edges: graph.edges.map((e) => ({
      src: byKey.get(e.srcEntityKey)?.qualifiedName ?? "?",
      relation: e.relation,
      dst: byKey.get(e.dstEntityKey)?.qualifiedName ?? "?",
      origin: e.origin,
      confidence: e.confidence,
      resolution: e.resolution,
      evidence: e.evidence
    }))
  };
}

describe("inheritance extraction", () => {
  it("emits extends for class-to-class and interface-to-interface heritage", () => {
    const repo = makeRepo("extends-repo", {
      "src/base.ts": [
        "export class Base {",
        "  greet(): string {",
        '    return "base";',
        "  }",
        "}",
        "export interface Named {",
        "  name(): string;",
        "}",
        "export interface Aged {",
        "  age(): number;",
        "}",
        ""
      ].join("\n"),
      "src/sub.ts": [
        'import { Base, type Named, type Aged } from "./base.js";',
        "",
        "export class Sub extends Base {",
        "  greet(): string {",
        '    return "sub";',
        "  }",
        "}",
        "",
        "export interface Person extends Named, Aged {",
        "  id(): string;",
        "}",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    const heritage = edges.filter((e) => e.relation === "extends");
    expect(heritage).toContainEqual(
      expect.objectContaining({
        src: "src/sub.ts.Sub",
        dst: "src/base.ts.Base",
        origin: "compiler",
        confidence: "certain",
        resolution: "resolved"
      })
    );
    expect(heritage).toContainEqual(
      expect.objectContaining({ src: "src/sub.ts.Person", dst: "src/base.ts.Named" })
    );
    expect(heritage).toContainEqual(
      expect.objectContaining({ src: "src/sub.ts.Person", dst: "src/base.ts.Aged" })
    );
    expect(heritage).toHaveLength(3);
  });

  it("resolves aliased heritage clauses to the original declaration", () => {
    const repo = makeRepo("aliased-heritage-repo", {
      "src/base.ts": "export class Base {\n  run(): void {}\n}\n",
      "src/sub.ts": [
        'import { Base as Renamed } from "./base.js";',
        "",
        "export class Sub extends Renamed {",
        "  run(): void {}",
        "}",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    const heritage = edges.filter((e) => e.relation === "extends");
    expect(heritage).toEqual([
      expect.objectContaining({ src: "src/sub.ts.Sub", dst: "src/base.ts.Base" })
    ]);
  });
});

describe("heuristic call honesty", () => {
  it("does not emit a heuristic call when the method name is ambiguous", () => {
    const repo = makeRepo("ambiguous-heuristic-repo", {
      "src/a.ts": "export class A {\n  resolve(v: string): string {\n    return v;\n  }\n}\n",
      "src/b.ts": "export class B {\n  resolve(v: string): string {\n    return v;\n  }\n}\n",
      "src/use.ts": [
        "export function useAny(x: any): string {",
        "  return x.resolve('v');",
        "}",
        ""
      ].join("\n")
    });

    const result = indexRepository(repo, { kind: "commit" });
    const calls = result.graph.edges.filter((e) => e.relation === "calls");
    expect(calls).toEqual([]);
    expect(
      result.diagnostics.some((d) => d.message.includes("2 name candidates"))
    ).toBe(true);
  });

  it("labels the unique-name heuristic call as heuristic/likely/partial, never compiler", () => {
    const repo = makeRepo("unique-heuristic-repo", {
      "src/only.ts": "export class Only {\n  resolve(v: string): string {\n    return v;\n  }\n}\n",
      "src/use.ts": [
        "export function useAny(x: any): string {",
        "  return x.resolve('v');",
        "}",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    const calls = edges.filter((e) => e.relation === "calls");
    expect(calls).toEqual([
      expect.objectContaining({
        src: "src/use.ts.useAny",
        dst: "src/only.ts.Only.resolve",
        origin: "heuristic",
        confidence: "likely",
        resolution: "partial"
      })
    ]);
  });
});

describe("adversarial-review regressions", () => {
  it("does not attribute method decorators as calls by the decorated method", () => {
    const repo = makeRepo("decorator-repo", {
      "src/log.ts": [
        "export function Log(): (value: unknown, context: unknown) => void {",
        "  return () => {};",
        "}",
        ""
      ].join("\n"),
      "src/service.ts": [
        'import { Log } from "./log.js";',
        "",
        "export class Service {",
        "  @Log()",
        "  doWork(): string {",
        '    return "w";',
        "  }",
        "}",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    expect(edges.filter((e) => e.relation === "calls")).toEqual([]);
  });

  it("still attributes default-parameter calls to the enclosing function (semantically real)", () => {
    const repo = makeRepo("default-param-repo", {
      "src/factory.ts": "export function makeDefault(): number {\n  return 1;\n}\n",
      "src/run.ts": [
        'import { makeDefault } from "./factory.js";',
        "",
        "export function run(x: number = makeDefault()): number {",
        "  return x;",
        "}",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    expect(edges.filter((e) => e.relation === "calls")).toEqual([
      expect.objectContaining({ src: "src/run.ts.run", dst: "src/factory.ts.makeDefault" })
    ]);
  });

  it("does not link bare identifier mentions inside test bodies", () => {
    const repo = makeRepo("test-mention-repo", {
      "src/other.ts": "export function other(): number {\n  return 1;\n}\n",
      "tests/mention.test.ts": [
        'import { other } from "../src/other.js";',
        "",
        "declare function test(name: string, fn: () => void): void;",
        "",
        'test("mentions but never exercises", () => {',
        "  void other;",
        "});",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    expect(edges.filter((e) => e.relation === "tests")).toEqual([]);
  });

  it("suppresses the unique-name heuristic call when the arity cannot match", () => {
    const repo = makeRepo("arity-repo", {
      "src/only.ts": "export class Only {\n  resolve(v: string): string {\n    return v;\n  }\n}\n",
      "src/use.ts": [
        "export function useAny(x: any): string {",
        "  return x.resolve('a', 'b', 'c');",
        "}",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    expect(edges.filter((e) => e.relation === "calls")).toEqual([]);
  });
});

describe("references extraction", () => {
  it("merges the return-type and new-expression references into one edge with both evidence lines", () => {
    const repo = makeRepo("references-repo", {
      "src/widget.ts": "export class Widget {\n  render(): string {\n    return 'w';\n  }\n}\n",
      "src/factory.ts": [
        'import { Widget } from "./widget.js";',
        "",
        "export function makeWidget(): Widget {",
        "  return new Widget();",
        "}",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    const references = edges.filter((e) => e.relation === "references");
    expect(references).toHaveLength(1);
    const reference = references[0]!;
    expect(reference.src).toBe("src/factory.ts.makeWidget");
    expect(reference.dst).toBe("src/widget.ts.Widget");
    // One-based evidence: return type on line 3, new-expression on line 4.
    const lines = reference.evidence.map((e) => e.lineStart).sort((a, b) => a - b);
    expect(lines).toEqual([3, 4]);
  });

  it("does not emit references for import specifiers or top-level code", () => {
    const repo = makeRepo("no-toplevel-references-repo", {
      "src/widget.ts": "export class Widget {\n  render(): string {\n    return 'w';\n  }\n}\n",
      "src/top.ts": [
        'import { Widget } from "./widget.js";',
        "",
        "export const shared: Widget = new Widget();",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    expect(edges.filter((e) => e.relation === "references")).toEqual([]);
  });
});

describe("doc link rules", () => {
  it("links at most one symbol per markdown line, left to right", () => {
    const repo = makeRepo("doclink-repo", {
      "src/alpha.ts": "export function alpha(): number {\n  return 1;\n}\n",
      "src/beta.ts": "export function beta(): number {\n  return 2;\n}\n",
      "docs/ADR-009-line.md": [
        "# ADR-009: One link per line",
        "",
        "The `alpha` helper depends on the `beta` helper.",
        "The `beta` helper stands alone.",
        ""
      ].join("\n")
    });

    const { edges } = edgesOf(repo);
    const documents = edges.filter((e) => e.relation === "documents");
    expect(documents).toHaveLength(2);
    expect(documents.map((d) => d.dst).sort()).toEqual([
      "src/alpha.ts.alpha",
      "src/beta.ts.beta"
    ]);
    // The alpha link anchors line 3; beta only links from line 4.
    const betaEdge = documents.find((d) => d.dst === "src/beta.ts.beta");
    expect(betaEdge?.evidence.map((e) => e.lineStart)).toEqual([4]);
  });

  it("refuses generic HTTP verb names even when unique", () => {
    const repo = makeRepo("doclink-verb-repo", {
      "src/handler.ts": "export function GET(): number {\n  return 1;\n}\n",
      "docs/ADR-010-verb.md": [
        "# ADR-010: Verbs stay generic",
        "",
        "The `GET` handler is exported.",
        ""
      ].join("\n")
    });

    const result = indexRepository(repo, { kind: "commit" });
    expect(result.graph.edges.filter((e) => e.relation === "documents")).toEqual([]);
    expect(
      result.diagnostics.some((d) => d.message.includes("generic route-handler name"))
    ).toBe(true);
  });
});

describe("Next.js route path derivation", () => {
  it("derives URL paths from file conventions", () => {
    expect(nextRouteRole("app/api/session/route.ts")).toEqual({
      kind: "app-handler",
      urlPath: "/api/session"
    });
    expect(nextRouteRole("app/route.ts")).toEqual({ kind: "app-handler", urlPath: "/" });
    expect(nextRouteRole("app/dashboard/page.tsx")).toEqual({
      kind: "app-page",
      urlPath: "/dashboard"
    });
    expect(nextRouteRole("pages/api/legacy.ts")).toEqual({
      kind: "pages-api",
      urlPath: "/api/legacy"
    });
    expect(nextRouteRole("pages/api/index.ts")).toEqual({ kind: "pages-api", urlPath: "/api" });
    expect(nextRouteRole("pages/profile.tsx")).toEqual({
      kind: "pages-page",
      urlPath: "/profile"
    });
    expect(nextRouteRole("pages/index.tsx")).toEqual({ kind: "pages-page", urlPath: "/" });
    // Dynamic segments stay verbatim (documented interpretation).
    expect(nextRouteRole("app/items/[id]/page.tsx")).toEqual({
      kind: "app-page",
      urlPath: "/items/[id]"
    });
    // Non-route files never become routes.
    expect(nextRouteRole("pages/_app.tsx")).toBeNull();
    expect(nextRouteRole("components/user-card.tsx")).toBeNull();
    expect(nextRouteRole("lib/session-service.ts")).toBeNull();
    expect(nextRouteRole("src/app/page.tsx")).toBeNull();
  });
});

describe("deterministic week-3 output", () => {
  it("produces identical node and edge keys on repeated indexing", () => {
    const fixture = path.resolve(__dirname, "../../fixtures/01-core-symbols/repo");
    const first = indexRepository(fixture, { kind: "commit" });
    const second = indexRepository(fixture, { kind: "commit" });
    expect(second.graph.nodes.map((n) => n.entityKey)).toEqual(
      first.graph.nodes.map((n) => n.entityKey)
    );
    expect(
      second.graph.edges.map((e) => `${e.entityKey}|${e.origin}|${e.confidence}|${e.resolution}`)
    ).toEqual(
      first.graph.edges.map((e) => `${e.entityKey}|${e.origin}|${e.confidence}|${e.resolution}`)
    );
    expect(second.graph.workspaceHash).toBe(first.graph.workspaceHash);
  });
});
