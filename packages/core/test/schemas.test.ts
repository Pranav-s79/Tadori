import { describe, expect, it } from "vitest";
import {
  CONFIDENCES,
  CAPABILITY_FEATURES,
  CAPABILITY_STATES,
  EVIDENCE_KINDS,
  NODE_KINDS,
  ORIGINS,
  RELATIONS,
  REPO_STATE_KINDS,
  RESOLUTIONS,
  confidenceSchema,
  capabilityMatrixSchema,
  evidenceSchema,
  graphEdgeSchema,
  graphNodeSchema,
  graphProjectSchema,
  nodeKindSchema,
  originSchema,
  relationSchema,
  repoStateKindSchema,
  resolutionSchema,
  snapshotGraphSchema
} from "@tadori/core";

describe("frozen enums", () => {
  it("matches the migration 001 node-kind list exactly", () => {
    expect([...NODE_KINDS]).toEqual([
      "package",
      "file",
      "function",
      "method",
      "class",
      "interface",
      "type",
      "route",
      "test",
      "adr",
      "doc_section",
      "external_dep",
      "unresolved"
    ]);
  });

  it("matches the migration 001 relation list exactly", () => {
    expect([...RELATIONS]).toEqual([
      "contains",
      "imports",
      "exports",
      "references",
      "calls",
      "implements",
      "extends",
      "tests",
      "routes_to",
      "documents",
      "changed_with"
    ]);
  });

  it("matches origin, confidence, resolution, state, and evidence enums", () => {
    expect([...ORIGINS]).toEqual(["compiler", "heuristic", "git", "doc", "human", "llm"]);
    expect([...CONFIDENCES]).toEqual(["certain", "likely", "inferred"]);
    expect([...RESOLUTIONS]).toEqual(["resolved", "partial", "unresolved"]);
    expect([...REPO_STATE_KINDS]).toEqual(["commit", "working_tree", "staged", "patch"]);
    expect([...EVIDENCE_KINDS]).toEqual([
      "source",
      "documentation",
      "git",
      "human_annotation",
      "tool_event"
    ]);
  });

  it("rejects values outside each enum", () => {
    expect(nodeKindSchema.safeParse("component").success).toBe(false);
    expect(relationSchema.safeParse("depends_on").success).toBe(false);
    expect(originSchema.safeParse("guessed").success).toBe(false);
    expect(confidenceSchema.safeParse("maybe").success).toBe(false);
    expect(resolutionSchema.safeParse("pending").success).toBe(false);
    expect(repoStateKindSchema.safeParse("branch").success).toBe(false);
  });
});

describe("capability matrix schema", () => {
  it("requires every feature and the exact ordered support vocabulary", () => {
    const features = Object.fromEntries(
      CAPABILITY_FEATURES.map((feature) => [feature, "unsupported"])
    );
    const matrix = {
      version: 1,
      claim: "Explicit support",
      states: [...CAPABILITY_STATES],
      languages: [{
        id: "example",
        extractorId: "example-extractor",
        extractorVersion: "1",
        features
      }]
    };
    expect(capabilityMatrixSchema.safeParse(matrix).success).toBe(true);
    const { calls: omittedCalls, ...incompleteFeatures } = features;
    expect(omittedCalls).toBe("unsupported");
    expect(capabilityMatrixSchema.safeParse({
      ...matrix,
      languages: [{ ...matrix.languages[0], features: incompleteFeatures }]
    }).success).toBe(false);
    expect(capabilityMatrixSchema.safeParse({
      ...matrix,
      languages: [...matrix.languages, matrix.languages[0]]
    }).success).toBe(false);
  });
});

describe("graph zod schemas", () => {
  const hex = "ab".repeat(32);

  it("accepts a valid node and edge", () => {
    const node = graphNodeSchema.parse({
      kind: "function",
      qualifiedName: "src/math.ts.factorial",
      displayName: "factorial",
      canonicalIdentity: "node|function|src/math.ts.factorial",
      entityKey: hex,
      file: "src/math.ts",
      exported: true,
      spanStart: 0,
      spanEnd: 10,
      lineStart: 1,
      lineEnd: 4,
      signature: "factorial(n: number): number",
      bodyHash: hex,
      evidence: [{ file: "src/math.ts", kind: "source", lineStart: 1, lineEnd: 4 }]
    });
    expect(node.kind).toBe("function");

    const edge = graphEdgeSchema.parse({
      srcEntityKey: hex,
      relation: "imports",
      dstEntityKey: hex,
      canonicalIdentity: `edge|${hex}|imports|${hex}`,
      entityKey: hex,
      origin: "compiler",
      confidence: "certain",
      resolution: "resolved",
      evidence: []
    });
    expect(edge.relation).toBe("imports");
  });

  it("rejects zero or inverted evidence line ranges", () => {
    expect(
      evidenceSchema.safeParse({ file: "a.ts", kind: "source", lineStart: 0, lineEnd: 1 })
        .success
    ).toBe(false);
    expect(
      evidenceSchema.safeParse({ file: "a.ts", kind: "source", lineStart: 5, lineEnd: 4 })
        .success
    ).toBe(false);
  });

  it("rejects malformed entity keys", () => {
    const bad = graphEdgeSchema.safeParse({
      srcEntityKey: "not-hex",
      relation: "imports",
      dstEntityKey: hex,
      canonicalIdentity: "x",
      entityKey: hex,
      origin: "compiler",
      confidence: "certain",
      resolution: "resolved",
      evidence: []
    });
    expect(bad.success).toBe(false);
  });

  it("validates discovered projects and defaults legacy snapshots to none", () => {
    expect(graphProjectSchema.parse({
      projectId: hex,
      root: "services/api",
      manifest: "services/api/pyproject.toml",
      kind: "manifest",
      name: "api",
      languages: ["python"]
    })).toMatchObject({ root: "services/api", languages: ["python"] });
    expect(graphProjectSchema.safeParse({
      projectId: hex,
      root: "../outside",
      manifest: null,
      kind: "manifest",
      name: null,
      languages: ["python"]
    }).success).toBe(false);
    expect(graphProjectSchema.safeParse({
      projectId: hex,
      root: ".",
      manifest: "go.mod",
      kind: "manifest",
      name: null,
      languages: ["python", "go"]
    }).success).toBe(false);

    const legacy = snapshotGraphSchema.parse({
      repoRootPath: "C:/legacy",
      kind: "commit",
      label: null,
      baseCommitSha: null,
      workspaceHash: hex,
      analyzerVersion: "legacy/1",
      files: [],
      nodes: [],
      edges: []
    });
    expect(legacy.projects).toEqual([]);
    expect(legacy.diagnostics).toEqual([]);
  });
});
