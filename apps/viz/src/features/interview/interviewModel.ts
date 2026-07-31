import type { ClaimBasis } from "../../design/ClaimBadge.tsx";
import type { ApiEdge, ApiNode, SnapshotAnalysisDto } from "../../api/types.ts";

export type QuestionGroup =
  | "Basic comprehension"
  | "Architecture"
  | "Data flow"
  | "APIs and boundaries"
  | "Performance"
  | "Reliability"
  | "Testing"
  | "Maintainability"
  | "Design tradeoffs";

export type Difficulty = "warm-up" | "core" | "probing";

export interface InterviewQuestion {
  group: QuestionGroup;
  question: string;
  /** What a strong answer should cover. */
  strongAnswer: string[];
  /** Repository evidence to inspect before answering. */
  evidence: string[];
  difficulty: Difficulty;
  /**
   * Whether the question is fully supported by extracted facts or leans on
   * interpretation. An `inferred` question is still grounded in real entities,
   * but its framing goes beyond what the repository states.
   */
  basis: ClaimBasis;
}

export interface InterviewInput {
  /** The selected subject, or null for a whole-repository interview. */
  subject: ApiNode | null;
  nodes: readonly ApiNode[];
  edges: readonly ApiEdge[];
  analysis: SnapshotAnalysisDto | null;
}

function inbound(edges: readonly ApiEdge[], entityKey: string): ApiEdge[] {
  return edges.filter((edge) => edge.dstEntityKey === entityKey);
}

function outbound(edges: readonly ApiEdge[], entityKey: string): ApiEdge[] {
  return edges.filter((edge) => edge.srcEntityKey === entityKey);
}

/**
 * Build interview questions from what this snapshot actually contains.
 *
 * This is deliberately NOT a generic question bank. Every question names a real
 * entity, count, language or diagnostic drawn from the served graph, so a
 * question only appears when the repository supports asking it. Where a
 * question invites interpretation — a tradeoff, a rationale — it is marked
 * `inferred`, because the repository evidences the structure, not the reasoning
 * behind it.
 */
export function buildInterviewQuestions(input: InterviewInput): InterviewQuestion[] {
  const { subject, nodes, edges, analysis } = input;
  const questions: InterviewQuestion[] = [];

  if (subject !== null) {
    const dependents = inbound(edges, subject.entityKey);
    const dependencies = outbound(edges, subject.entityKey);
    const evidence = subject.file === null ? [] : [subject.file];

    questions.push({
      group: "Basic comprehension",
      question: `Walk me through what \`${subject.displayName}\` is responsible for.`,
      strongAnswer: [
        `Identify it as a ${subject.kind}`,
        subject.file === null ? "Note that no file is recorded for it" : `Locate it in ${subject.file}`,
        "Describe its responsibility in one sentence before any detail"
      ],
      evidence,
      difficulty: "warm-up",
      basis: "observed"
    });

    if (dependents.length > 0) {
      questions.push({
        group: "Architecture",
        question: `${String(dependents.length)} thing(s) depend on \`${subject.displayName}\`. `
          + "What breaks if you change its contract?",
        strongAnswer: [
          "Enumerate the dependents rather than guessing at blast radius",
          "Separate compile-time coupling from runtime coupling",
          "Say which changes are safe and which are breaking"
        ],
        evidence: dependents.slice(0, 6).map((edge) => edge.srcEntityKey),
        difficulty: "core",
        basis: "observed"
      });
    }

    if (dependencies.length > 0) {
      questions.push({
        group: "Data flow",
        question: `Trace what \`${subject.displayName}\` calls or imports, and what data crosses each boundary.`,
        strongAnswer: [
          "Follow the outgoing relations in order",
          "Name what is passed and what is returned at each hop",
          "Flag any relation whose resolution is partial or unresolved"
        ],
        evidence: dependencies.slice(0, 6).map((edge) => edge.dstEntityKey),
        difficulty: "core",
        basis: "observed"
      });
    }

    questions.push({
      group: "Design tradeoffs",
      question: `Why might the authors have placed \`${subject.displayName}\` here rather than elsewhere?`,
      strongAnswer: [
        "Argue from the actual dependency shape, not from naming",
        "Offer at least one alternative placement and its cost",
        "State plainly that the rationale is not documented in the repository"
      ],
      evidence,
      difficulty: "probing",
      // The structure is observed; the reasoning behind it is not in the graph.
      basis: "inferred"
    });
  }

  const routes = nodes.filter((node) => node.kind === "route");
  if (routes.length > 0) {
    questions.push({
      group: "APIs and boundaries",
      question: `This repository registers ${String(routes.length)} entry point(s), including `
        + `\`${routes[0]?.displayName ?? ""}\`. How would you validate and version them?`,
      strongAnswer: [
        "Name the actual routes rather than speaking generically",
        "Cover input validation at the boundary",
        "Address backward compatibility for existing callers"
      ],
      evidence: routes.slice(0, 5).flatMap((route) => route.file === null ? [] : [route.file]),
      difficulty: "core",
      basis: "observed"
    });
  }

  const languages = analysis?.languages ?? [];
  if (languages.length > 1) {
    questions.push({
      group: "Architecture",
      question: `This is a mixed-language repository (${languages.map((item) => item.id).join(", ")}). `
        + "How do those parts communicate, and where would you look for the seams?",
      strongAnswer: [
        "Identify the concrete interop mechanism rather than assuming one",
        "Point at generated bindings, protocol definitions or config as the seam",
        "Acknowledge which cross-language edges the tooling could not resolve"
      ],
      evidence: languages.map((language) => language.id),
      difficulty: "probing",
      basis: "observed"
    });
  }

  const errorCount = analysis?.diagnostics.bySeverity.error ?? 0;
  if (errorCount > 0) {
    questions.push({
      group: "Reliability",
      question: `Static analysis recorded ${String(errorCount)} extraction error(s). `
        + "What does that imply about the parts of this codebase you have not seen?",
      strongAnswer: [
        "Recognise that affected files are under-represented in the graph",
        "Avoid concluding those files are broken — extraction failed, not the code",
        "Propose reading those files directly before relying on the map"
      ],
      evidence: (analysis?.diagnostics.items ?? [])
        .slice(0, 5)
        .flatMap((item) => item.file === null ? [] : [item.file]),
      difficulty: "probing",
      basis: "observed"
    });
  }

  const tests = nodes.filter((node) => node.kind === "test");
  questions.push({
    group: "Testing",
    question: tests.length > 0
      ? `${String(tests.length)} test entities are indexed. What is covered, and what conspicuously is not?`
      : "No test entities were extracted here. How would you establish confidence before changing this system?",
    strongAnswer: tests.length > 0
      ? [
        "Distinguish static linkage from executed coverage — Tadori shows the former only",
        "Name an area with no associated test",
        "Say what you would add first and why"
      ]
      : [
        "Do not claim the project is untested; extraction found none, which is different",
        "Propose characterisation tests around the highest fan-in entities first"
      ],
    evidence: tests.slice(0, 5).flatMap((test) => test.file === null ? [] : [test.file]),
    difficulty: "core",
    basis: tests.length > 0 ? "observed" : "unknown"
  });

  return questions;
}

/** Group questions in a stable order for rendering. */
export function groupQuestions(
  questions: readonly InterviewQuestion[]
): Array<{ group: QuestionGroup; questions: InterviewQuestion[] }> {
  const order: QuestionGroup[] = [
    "Basic comprehension", "Architecture", "Data flow", "APIs and boundaries",
    "Performance", "Reliability", "Testing", "Maintainability", "Design tradeoffs"
  ];
  return order.flatMap((group) => {
    const matching = questions.filter((question) => question.group === group);
    return matching.length === 0 ? [] : [{ group, questions: matching }];
  });
}
