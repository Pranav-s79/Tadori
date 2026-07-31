import { describe, expect, it } from "vitest";
import { buildInterviewQuestions, groupQuestions } from "./interviewModel.ts";
import type { ApiEdge, ApiNode } from "../../api/types.ts";

function node(overrides: Partial<ApiNode> = {}): ApiNode {
  return {
    entityKey: "fn:handle", kind: "function", qualifiedName: "api.handle",
    displayName: "handle", file: "src/api.ts", exported: true, fanIn: 0, ...overrides
  };
}

function edge(src: string, dst: string): ApiEdge {
  return { entityKey: `${src}->${dst}`, srcEntityKey: src, relation: "calls", dstEntityKey: dst };
}

describe("buildInterviewQuestions", () => {
  it("asks nothing generic: an empty graph supports only what it can evidence", () => {
    const questions = buildInterviewQuestions({
      subject: null, nodes: [], edges: [], analysis: null
    });
    // The only question an empty repository supports is the testing one, and it
    // must be marked unknown rather than asserting the project is untested.
    expect(questions).toHaveLength(1);
    expect(questions[0]?.group).toBe("Testing");
    expect(questions[0]?.basis).toBe("unknown");
    expect(questions[0]?.strongAnswer.join(" ")).toMatch(/Do not claim the project is untested/u);
  });

  it("grounds subject questions in the real entity and its real dependents", () => {
    const subject = node();
    const questions = buildInterviewQuestions({
      subject,
      nodes: [subject],
      edges: [edge("caller:a", "fn:handle"), edge("caller:b", "fn:handle")],
      analysis: null
    });
    const architecture = questions.find((item) => item.group === "Architecture");
    expect(architecture?.question).toMatch(/2 thing\(s\) depend on `handle`/u);
    expect(architecture?.evidence).toEqual(["caller:a", "caller:b"]);
    expect(architecture?.basis).toBe("observed");
  });

  it("marks a rationale question inferred, because the graph shows structure not reasoning", () => {
    const subject = node();
    const questions = buildInterviewQuestions({
      subject, nodes: [subject], edges: [], analysis: null
    });
    const tradeoff = questions.find((item) => item.group === "Design tradeoffs");
    expect(tradeoff?.basis).toBe("inferred");
    expect(tradeoff?.strongAnswer.join(" ")).toMatch(/not documented in the repository/u);
  });

  it("only asks the mixed-language question when more than one language was observed", () => {
    const single = buildInterviewQuestions({
      subject: null, nodes: [], edges: [],
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
      subject: null, nodes: [], edges: [],
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
});

describe("groupQuestions", () => {
  it("omits groups with no grounded question rather than showing empty headings", () => {
    const grouped = groupQuestions(buildInterviewQuestions({
      subject: null, nodes: [], edges: [], analysis: null
    }));
    expect(grouped.map((entry) => entry.group)).toEqual(["Testing"]);
  });
});
