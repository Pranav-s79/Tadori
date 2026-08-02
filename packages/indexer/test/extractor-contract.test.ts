import { describe, expect, it } from "vitest";
import {
  extractionProvenanceSchema,
  graphEdgeSchema,
  graphNodeSchema,
  type GraphEdge,
  type GraphNode
} from "@tadori/core";
import {
  assertExtractorResult,
  provenance,
  type AttributedGraphEdge,
  type AttributedGraphNode,
  type ExtractorResult
} from "@tadori/indexer";

const firstKey = "11".repeat(32);
const secondKey = "22".repeat(32);
const edgeKey = "33".repeat(32);

function node(overrides: Partial<AttributedGraphNode> = {}): AttributedGraphNode {
  return {
    kind: "function", qualifiedName: "python|src/main.py|run", displayName: "run",
    canonicalIdentity: "node|function|python|src/main.py|run", entityKey: firstKey,
    file: "src/main.py", exported: false, spanStart: 0, spanEnd: 10, lineStart: 1,
    lineEnd: 2, signature: "def run():", bodyHash: null,
    evidence: [{ file: "src/main.py", kind: "source", lineStart: 1, lineEnd: 2 }],
    language: "python",
    provenance: provenance("tree-sitter", "1", "structural", "parser-derived"),
    ...overrides
  };
}

function edge(overrides: Partial<AttributedGraphEdge> = {}): AttributedGraphEdge {
  return {
    srcEntityKey: firstKey, relation: "calls", dstEntityKey: secondKey,
    canonicalIdentity: `edge|${firstKey}|calls|${secondKey}`, entityKey: edgeKey,
    origin: "heuristic", confidence: "likely", resolution: "unresolved",
    evidence: [{ file: "src/main.py", kind: "source", lineStart: 2, lineEnd: 2 }],
    language: "python",
    provenance: provenance("tree-sitter", "1", "structural", "parser-derived", "dynamic call target"),
    ...overrides
  };
}

function result(overrides: Partial<ExtractorResult> = {}): ExtractorResult {
  return {
    extractorId: "tree-sitter", extractorVersion: "1", capability: "structural",
    languages: ["python"], nodes: [node()], edges: [edge()], projects: [], diagnostics: [],
    ...overrides
  };
}

describe("extraction provenance schemas", () => {
  it("accepts fully attributed items and keeps legacy graph items readable", () => {
    expect(extractionProvenanceSchema.parse(node().provenance)).toEqual(node().provenance);
    expect(graphNodeSchema.parse(node()).language).toBe("python");
    expect(graphEdgeSchema.parse(edge()).provenance?.unresolvedReason).toBe("dynamic call target");

    const legacyNode: GraphNode = { ...node() };
    delete legacyNode.language;
    delete legacyNode.provenance;
    const legacyEdge: GraphEdge = { ...edge() };
    delete legacyEdge.language;
    delete legacyEdge.provenance;
    expect(graphNodeSchema.safeParse(legacyNode).success).toBe(true);
    expect(graphEdgeSchema.safeParse(legacyEdge).success).toBe(true);
  });

  it("rejects empty identities and invalid capability or derivation labels", () => {
    expect(extractionProvenanceSchema.safeParse({
      extractorId: "", extractorVersion: "1", capability: "structural",
      derivation: "parser-derived", unresolvedReason: null
    }).success).toBe(false);
    expect(extractionProvenanceSchema.safeParse({
      extractorId: "tree-sitter", extractorVersion: "1", capability: "full",
      derivation: "guessed", unresolvedReason: null
    }).success).toBe(false);
  });
});

describe("extractor result assertions", () => {
  it("accepts a consistent attributed result", () => {
    expect(() => assertExtractorResult(result())).not.toThrow();
  });

  it("rejects duplicate node and edge identities", () => {
    expect(() => assertExtractorResult(result({ nodes: [node(), node()] }))).toThrow(/duplicate node/);
    expect(() => assertExtractorResult(result({ edges: [edge(), edge()] }))).toThrow(/duplicate edge/);
  });

  it("rejects item provenance that disagrees with the producing extractor", () => {
    expect(() => assertExtractorResult(result({
      nodes: [node({ provenance: provenance("other", "1", "structural", "parser-derived") })]
    }))).toThrow(/mismatched extractor provenance/);
    expect(() => assertExtractorResult(result({
      edges: [edge({ provenance: provenance("other", "1", "structural", "parser-derived") })]
    }))).toThrow(/mismatched extractor provenance/);
  });

  it("rejects item version, capability, or language outside the result inventory", () => {
    expect(() => assertExtractorResult(result({
      nodes: [node({ provenance: provenance("tree-sitter", "2", "structural", "parser-derived") })]
    }))).toThrow(/extractor version/);
    expect(() => assertExtractorResult(result({
      edges: [edge({ provenance: provenance(
        "tree-sitter", "1", "semantic", "parser-derived", "dynamic call target"
      ) })]
    }))).toThrow(/capability/);
    expect(() => assertExtractorResult(result({ nodes: [node({ language: "rust" })] })))
      .toThrow(/language/);
  });

  it("requires an unresolved reason for unresolved relations", () => {
    expect(() => assertExtractorResult(result({
      edges: [edge({
        provenance: provenance("tree-sitter", "1", "structural", "parser-derived"),
        resolution: "unresolved"
      })]
    }))).toThrow(/unresolved reason/);
  });

  it("validates diagnostic provenance, language, code, and line ranges", () => {
    const diagnostic = {
      code: "structural-parse-failed",
      severity: "error" as const,
      message: "Parser failed",
      file: "src/main.py",
      language: "python" as const,
      extractorId: "tree-sitter",
      lineStart: 1,
      lineEnd: 1
    };
    expect(() => assertExtractorResult(result({ diagnostics: [diagnostic] }))).not.toThrow();
    expect(() => assertExtractorResult(result({
      diagnostics: [{ ...diagnostic, extractorId: "other" }]
    }))).toThrow(/mismatched extractor provenance/);
    expect(() => assertExtractorResult(result({
      diagnostics: [{ ...diagnostic, code: "Bad code" }]
    }))).toThrow(/invalid diagnostic code/);
    expect(() => assertExtractorResult(result({
      diagnostics: [{ ...diagnostic, lineEnd: undefined }]
    }))).toThrow(/incomplete line range/);
  });
});
