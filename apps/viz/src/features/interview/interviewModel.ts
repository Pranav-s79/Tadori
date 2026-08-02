import type { ClaimBasis } from "../../design/ClaimBadge.tsx";
import type { SnapshotAnalysisDto } from "../../api/types.ts";
import type { NodeDetail, ToolEdge } from "../inspect/inspectApi.ts";
import type { TestLink } from "../explore/exploreApi.ts";
import type { RoutesState } from "../overview/overviewModel.ts";

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

/**
 * One piece of evidence behind a question. `entityKey` is non-null only when
 * the label resolves to a served entity, so the view can offer inspection
 * exactly where it will work and render everything else as plain text.
 */
export interface QuestionEvidence {
  label: string;
  entityKey: string | null;
}

export interface InterviewQuestion {
  group: QuestionGroup;
  question: string;
  /** What a strong answer should cover. */
  strongAnswer: string[];
  /** Repository evidence to inspect before answering. */
  evidence: QuestionEvidence[];
  difficulty: Difficulty;
  /**
   * Whether the question is fully supported by extracted facts or leans on
   * interpretation. An `inferred` question is still grounded in real entities,
   * but its framing goes beyond what the repository states.
   */
  basis: ClaimBasis;
}

/**
 * Statically linked tests for the snapshot. `observed: false` is the server's
 * own word: a test linking here is not evidence it was ever run.
 */
export type TestsState =
  | { status: "loading" }
  | { status: "ready"; tests: readonly TestLink[] }
  | { status: "error" };

export interface InterviewInput {
  /**
   * The selected subject with its own edges, or null for a whole-repository
   * interview. Resolved from `/api/v1/nodes/:key` rather than the rendered
   * graph: the landing view is level-of-detail bounded to a single repository
   * node, so looking the subject up there silently produced a
   * "this repository" interview even with an entity selected.
   */
  subject: NodeDetail | null;
  routes: RoutesState;
  tests: TestsState;
  analysis: SnapshotAnalysisDto | null;
}

/** A file path is readable evidence but not a served entity, so it never links. */
function fileEvidence(file: string | null): QuestionEvidence[] {
  return file === null ? [] : [{ label: file, entityKey: null }];
}

function edgeEvidence(edge: ToolEdge, end: "src" | "dst"): QuestionEvidence {
  return end === "src"
    ? { label: edge.srcQualifiedName, entityKey: edge.srcEntityKey }
    : { label: edge.dstQualifiedName, entityKey: edge.dstEntityKey };
}

/**
 * Four states, four questions. A pending or failed test read must not be asked
 * as "no tests exist here" — that is the one framing a candidate could repeat
 * aloud and be wrong about.
 */
function testingQuestion(tests: TestsState): InterviewQuestion {
  if (tests.status !== "ready") {
    return {
      group: "Testing",
      question: tests.status === "loading"
        ? "Reading the repository's statically linked tests…"
        : "The test projection could not be read. How would you check what is covered before relying on it?",
      strongAnswer: ["Treat unavailable analysis as unknown, not as an absence of tests"],
      evidence: [],
      difficulty: "core",
      basis: "unknown"
    };
  }
  if (tests.tests.length === 0) {
    return {
      group: "Testing",
      question: "No test entities were extracted here. How would you establish confidence before changing this system?",
      strongAnswer: [
        "Do not claim the project is untested; extraction found none, which is different",
        "Propose characterisation tests around the highest fan-in entities first"
      ],
      evidence: [],
      difficulty: "core",
      basis: "unknown"
    };
  }
  return {
    group: "Testing",
    question: `${String(tests.tests.length)} test entities are statically linked. `
      + "What is covered, and what conspicuously is not?",
    strongAnswer: [
      "Distinguish static linkage from executed coverage — Tadori shows the former only",
      "Name an area with no associated test",
      "Say what you would add first and why"
    ],
    evidence: tests.tests.slice(0, 5).flatMap(({ node }) => fileEvidence(node.file)),
    difficulty: "core",
    basis: "observed"
  };
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
  const { subject, routes, tests, analysis } = input;
  const questions: InterviewQuestion[] = [];

  if (subject !== null) {
    const dependents = subject.inEdges;
    const dependencies = subject.outEdges;
    const evidence = fileEvidence(subject.file);

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
        question: `${String(dependents.length)} ${dependents.length === 1 ? "entity depends" : "entities depend"}`
          + ` on \`${subject.displayName}\`. What breaks if you change its contract?`,
        strongAnswer: [
          "Enumerate the dependents rather than guessing at blast radius",
          "Separate compile-time coupling from runtime coupling",
          "Say which changes are safe and which are breaking"
        ],
        evidence: dependents.slice(0, 6).map((edge) => edgeEvidence(edge, "src")),
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
        evidence: dependencies.slice(0, 6).map((edge) => edgeEvidence(edge, "dst")),
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

  if (routes.status === "ready" && routes.routes.length > 0) {
    const registered = routes.routes;
    questions.push({
      group: "APIs and boundaries",
      question: `This repository registers ${String(registered.length)} entry point(s), including `
        + `\`${registered[0]?.node.displayName ?? ""}\`. How would you validate and version them?`,
      strongAnswer: [
        "Name the actual routes rather than speaking generically",
        "Cover input validation at the boundary",
        "Address backward compatibility for existing callers"
      ],
      evidence: registered.slice(0, 5).flatMap(({ node }) => fileEvidence(node.file)),
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
      evidence: languages.map((language) => ({ label: language.id, entityKey: null })),
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
        .flatMap((item) => fileEvidence(item.file)),
      difficulty: "probing",
      basis: "observed"
    });
  }

  questions.push(testingQuestion(tests));
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
