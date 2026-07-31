import { describe, expect, it } from "vitest";
import { inferredRisks, responsibilityOf, structuralInterpretation } from "./interpretation.ts";
import type { NodeDetail, ToolEdge } from "./inspectApi.ts";

function edge(resolution: string): ToolEdge {
  return {
    entityKey: "e", srcEntityKey: "a", srcQualifiedName: "q.a", relation: "calls",
    dstEntityKey: "b", dstQualifiedName: "q.b",
    origin: "compiler", confidence: "certain", resolution
  } as unknown as ToolEdge;
}

function node(overrides: Partial<NodeDetail> = {}): NodeDetail {
  return {
    entityKey: "n", kind: "function", qualifiedName: "q.n", displayName: "n",
    file: "src/n.ts", lineStart: 1, lineEnd: 2, signature: null, exported: true,
    fanIn: 0, representation: "name", body: null, evidence: [], evidenceOmittedCount: 0,
    freshness: "fresh", stale: false, staleReason: null,
    inEdges: [], outEdges: [], ...overrides
  } as unknown as NodeDetail;
}

describe("structuralInterpretation", () => {
  it("never claims fan-in zero means nothing calls it at runtime", () => {
    const [reading] = structuralInterpretation(node({ fanIn: 0 }));
    expect(reading?.sentence).toMatch(/not\s+evidence nothing calls it at runtime/u);
    expect(reading?.sentence).toMatch(/extracted in this snapshot/u);
  });

  it("reads fan-in zero on a route as an entry point, hedged", () => {
    const [reading] = structuralInterpretation(node({ kind: "route", fanIn: 0 }));
    expect(reading?.sentence).toMatch(/appears to be an entry point/u);
    expect(reading?.sentence).toMatch(/rather than a shared dependency/u);
  });

  it("hedges a wide-impact reading rather than asserting it", () => {
    const [reading] = structuralInterpretation(node({ fanIn: 7 }));
    expect(reading?.sentence).toMatch(/may have a wider impact/u);
  });

  it("says the picture is incomplete when relations are unresolved", () => {
    const readings = structuralInterpretation(node({ fanIn: 1, outEdges: [edge("unresolved")] }));
    expect(readings.some((r) => /could not be statically resolved/u.test(r.sentence))).toBe(true);
  });

  it("stays silent when the numbers need no reading", () => {
    // fan-in 2 is legible on its own; restating it would be noise, not insight.
    expect(structuralInterpretation(node({ fanIn: 2, inEdges: [edge("resolved")], outEdges: [edge("resolved")] })))
      .toEqual([]);
  });
});

describe("responsibilityOf", () => {
  it("states a route's responsibility as observed, from its registered path", () => {
    const result = responsibilityOf(node({ kind: "route", displayName: "GET /users/:id" }));
    expect(result.observed).toBe(true);
    expect(result.text).toMatch(/GET \/users\/:id/u);
  });

  it("refuses to read responsibility from a name", () => {
    const result = responsibilityOf(node({ kind: "class", displayName: "UserService" }));
    expect(result.observed).toBe(false);
    expect(result.text).toMatch(/Unknown from the available repository evidence/u);
    expect(result.text).not.toMatch(/UserService/u);
  });
});

describe("inferredRisks", () => {
  it("names the signal rather than delivering a verdict", () => {
    const risks = inferredRisks(node({ fanIn: 5 }));
    expect(risks[0]).toMatch(/increase the potential change surface/u);
    expect(risks.join(" ")).not.toMatch(/fragile|unsafe|poorly|slow/u);
  });

  it("reports nothing when no concrete signal is present", () => {
    expect(inferredRisks(node({ fanIn: 1 }))).toEqual([]);
  });
});
