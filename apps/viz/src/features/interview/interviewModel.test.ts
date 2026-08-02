import { describe, expect, it } from "vitest";
import { buildInterviewQuestions, groupQuestions, type InterviewInput } from "./interviewModel.ts";
import type { NodeDetail, ToolEdge } from "../inspect/inspectApi.ts";

function edge(src: string, dst: string): ToolEdge {
  return {
    entityKey: `${src}->${dst}`,
    srcEntityKey: src, srcQualifiedName: `q.${src}`,
    relation: "calls",
    dstEntityKey: dst, dstQualifiedName: `q.${dst}`,
    origin: "compiler", confidence: "certain", resolution: "resolved"
  } as unknown as ToolEdge;
}

function subjectNode(inEdges: ToolEdge[] = [], outEdges: ToolEdge[] = []): NodeDetail {
  return {
    entityKey: "fn:handle", kind: "function", qualifiedName: "api.handle",
    displayName: "handle", file: "src/api.ts", lineStart: 1, lineEnd: 4,
    signature: null, exported: true, fanIn: inEdges.length,
    representation: "name", body: null, evidence: [], evidenceOmittedCount: 0,
    freshness: "fresh", stale: false, staleReason: null,
    inEdges, outEdges
  } as unknown as NodeDetail;
}

const empty: InterviewInput = {
  subject: null,
  routes: { status: "ready", routes: [] },
  tests: { status: "ready", tests: [] },
  analysis: null
};

describe("buildInterviewQuestions", () => {
  it("asks nothing generic: an empty graph supports only what it can evidence", () => {
    const questions = buildInterviewQuestions(empty);
    // The only question an empty repository supports is the testing one, and it
    // must be marked unknown rather than asserting the project is untested.
    expect(questions).toHaveLength(1);
    expect(questions[0]?.group).toBe("Testing");
    expect(questions[0]?.basis).toBe("unknown");
    expect(questions[0]?.strongAnswer.join(" ")).toMatch(/Do not claim the project is untested/u);
  });

  it("grounds subject questions in the real entity and its real dependents", () => {
    const questions = buildInterviewQuestions({
      ...empty,
      subject: subjectNode([edge("caller:a", "fn:handle"), edge("caller:b", "fn:handle")])
    });
    const architecture = questions.find((item) => item.group === "Architecture");
    // "N thing(s)" was placeholder-grade copy in the surface a candidate reads
    // aloud. The count still leads, because the number is the memorable fact.
    expect(architecture?.question).toMatch(/2 entities depend on `handle`/u);
    expect(architecture?.evidence.map((item) => item.label)).toEqual(["q.caller:a", "q.caller:b"]);
    expect(architecture?.basis).toBe("observed");
  });

  it("takes the subject's relations from the subject, not from a rendered graph", () => {
    // Regression: dependents/dependencies were filtered from the level-of-detail
    // graph, which holds one repository node at the landing view. A subject with
    // real edges must produce real questions regardless of what is rendered.
    const questions = buildInterviewQuestions({
      ...empty,
      subject: subjectNode([edge("caller:a", "fn:handle")], [edge("fn:handle", "dep:db")])
    });
    expect(questions.find((item) => item.group === "Architecture")).toBeDefined();
    const dataFlow = questions.find((item) => item.group === "Data flow");
    expect(dataFlow?.evidence).toEqual([{ label: "q.dep:db", entityKey: "dep:db" }]);
  });

  it("links evidence only when it resolves to a served entity", () => {
    const questions = buildInterviewQuestions({
      ...empty,
      subject: subjectNode([edge("caller:a", "fn:handle")])
    });
    // A dependent is a real entity, so it carries a key to open.
    const architecture = questions.find((item) => item.group === "Architecture");
    expect(architecture?.evidence[0]?.entityKey).toBe("caller:a");
    // The subject's file is readable evidence but not an entity: never a link.
    const warmUp = questions.find((item) => item.group === "Basic comprehension");
    expect(warmUp?.evidence).toEqual([{ label: "src/api.ts", entityKey: null }]);
  });

  it("marks a rationale question inferred, because the graph shows structure not reasoning", () => {
    const questions = buildInterviewQuestions({ ...empty, subject: subjectNode() });
    const tradeoff = questions.find((item) => item.group === "Design tradeoffs");
    expect(tradeoff?.basis).toBe("inferred");
    expect(tradeoff?.strongAnswer.join(" ")).toMatch(/not documented in the repository/u);
  });

  it("only asks the mixed-language question when more than one language was observed", () => {
    const single = buildInterviewQuestions({
      ...empty,
      analysis: {
        snapshotId: 1, analyzerVersion: "v",
        languages: [{ id: "python", fileCount: 1, generatedFileCount: 0, capabilities: [], extractors: [] }],
        extractors: [],
        diagnostics: {
          items: [], total: 0, omittedCount: 0, nextCursor: null,
          bySeverity: { info: 0, warning: 0, error: 0 }
        }
      }
    });
    expect(single.some((item) => item.question.includes("mixed-language"))).toBe(false);
  });

  it("asks about extraction errors only when errors were actually recorded", () => {
    const questions = buildInterviewQuestions({
      ...empty,
      analysis: {
        snapshotId: 1, analyzerVersion: "v", languages: [], extractors: [],
        diagnostics: {
          items: [], total: 3, omittedCount: 0, nextCursor: null,
          bySeverity: { info: 0, warning: 0, error: 3 }
        }
      }
    });
    const reliability = questions.find((item) => item.group === "Reliability");
    expect(reliability?.question).toMatch(/3 extraction error/u);
    expect(reliability?.strongAnswer.join(" ")).toMatch(/extraction failed, not the code/u);
  });

  it("never asks a pending or failed test read as 'no tests exist'", () => {
    for (const tests of [{ status: "loading" as const }, { status: "error" as const }]) {
      const testing = buildInterviewQuestions({ ...empty, tests })
        .find((item) => item.group === "Testing");
      expect(testing?.basis).toBe("unknown");
      expect(testing?.question).not.toMatch(/No test entities were extracted/u);
    }
  });
});

describe("groupQuestions", () => {
  it("omits groups with no grounded question rather than showing empty headings", () => {
    const grouped = groupQuestions(buildInterviewQuestions(empty));
    expect(grouped.map((entry) => entry.group)).toEqual(["Testing"]);
  });
});
