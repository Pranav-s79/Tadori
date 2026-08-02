import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ClaimBadge } from "../../design/ClaimBadge.tsx";
import { fetchNodeDetail, type NodeDetail } from "../inspect/inspectApi.ts";
import { fetchLikelyTests } from "../explore/exploreApi.ts";
import {
  buildInterviewQuestions, groupQuestions,
  type InterviewInput, type TestsState
} from "./interviewModel.ts";

export interface InterviewPanelProps extends Omit<InterviewInput, "subject" | "tests"> {
  /** Entity to interview about; null runs a whole-repository interview. */
  subjectEntityKey: string | null;
  onSelectEntity(entityKey: string): void;
}

/**
 * The generated questions mark identifiers with backticks, which rendered as
 * literal backtick characters in the prose. An identifier a candidate has to
 * say out loud should be visually distinct from the sentence around it, and
 * the same shape in every question, so it is recalled as a token rather than
 * as words. Splitting on the pairs keeps the model's strings portable to any
 * other surface that wants them plain.
 */
function withCodeSpans(text: string): ReactNode[] {
  return text.split("`").map((segment, index) => index % 2 === 0
    ? segment
    : <code key={`${String(index)}:${segment}`}>{segment}</code>);
}

/**
 * "Nothing was selected" and "the selected entity could not be found" must
 * never render identically. Collapsing them is what makes a stale shared link
 * look like a working whole-repository interview.
 */
type SubjectState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ok"; node: NodeDetail }
  | { status: "unavailable"; reason: "not_found" | "ambiguous" | "error" };

/**
 * Interview preparation for the selected subject, or the whole repository when
 * nothing is selected.
 *
 * Questions are generated from the served graph, so one only appears when this
 * repository supports asking it. Questions that invite interpretation are
 * marked inferred: the graph evidences structure, never the reasoning behind
 * it, and a candidate should know which is which before repeating it aloud.
 */
export function InterviewPanel({
  subjectEntityKey,
  onSelectEntity,
  ...input
}: InterviewPanelProps): ReactElement {
  // The subject and its edges come from the snapshot, not the rendered graph:
  // the landing view is bounded to one repository node, so resolving the
  // subject there produced a "this repository" interview with an entity picked.
  const [subjectState, setSubjectState] = useState<SubjectState>({ status: "none" });
  const [tests, setTests] = useState<TestsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (subjectEntityKey === null) {
      setSubjectState({ status: "none" });
      return;
    }
    setSubjectState({ status: "loading" });
    fetchNodeDetail(subjectEntityKey)
      .then((result) => {
        if (cancelled) return;
        setSubjectState(result.status === "ok"
          ? { status: "ok", node: result.node }
          : { status: "unavailable", reason: result.status });
      })
      .catch(() => {
        if (!cancelled) setSubjectState({ status: "unavailable", reason: "error" });
      });
    return () => { cancelled = true; };
  }, [subjectEntityKey]);

  const subject = subjectState.status === "ok" ? subjectState.node : null;

  useEffect(() => {
    let cancelled = false;
    fetchLikelyTests()
      .then((body) => { if (!cancelled) setTests({ status: "ready", tests: body.tests }); })
      .catch(() => { if (!cancelled) setTests({ status: "error" }); });
    return () => { cancelled = true; };
  }, []);

  if (subjectState.status === "loading") {
    return (
      <div className="mode-empty-state" role="status">
        <h2>Resolving the selected entity…</h2>
        <p>Reading it from the served snapshot.</p>
      </div>
    );
  }

  if (subjectState.status === "unavailable") {
    return (
      <div className="mode-empty-state" role="alert">
        <h2>That entity could not be found in this snapshot</h2>
        <p>
          {subjectState.reason === "ambiguous"
            ? "The link matches more than one entity, so Tadori will not guess which was meant."
            : "The link names an entity this snapshot does not carry — it may have been renamed, removed, or indexed from a different repository."}
          {" "}
          Nothing below would be about it, so no questions are shown. Clear the
          selection to interview the repository instead.
        </p>
      </div>
    );
  }

  const grouped = groupQuestions(buildInterviewQuestions({ ...input, subject, tests }));
  const subjectName = subject?.displayName ?? "this repository";

  if (grouped.length === 0) {
    return (
      <div className="mode-empty-state" role="status">
        <h2>No grounded questions yet</h2>
        <p>
          The served snapshot carries too little to ask anything specific.
          Tadori will not invent generic questions that are not about this code.
        </p>
      </div>
    );
  }

  return (
    <div className="interview-panel">
      <header className="interview-intro">
        <h2>Interview preparation — {subjectName}</h2>
        <p>
          Every question below names something this snapshot actually contains.
          Nothing here is a generic question bank; if the repository cannot
          support a question, it is not asked.
        </p>
      </header>
      {grouped.map(({ group, questions }) => (
        <section key={group} className="interview-group" aria-labelledby={`interview-${group}`}>
          <h3 id={`interview-${group}`}>{group}</h3>
          <ol className="interview-questions">
            {questions.map((item, index) => (
              <li key={`${group}:${String(index)}`} data-difficulty={item.difficulty}>
                <div className="interview-question-head">
                  <p className="interview-question-text">{withCodeSpans(item.question)}</p>
                  <span className="interview-difficulty">{item.difficulty}</span>
                  <ClaimBadge basis={item.basis} />
                </div>
                <details>
                  <summary>What a strong answer covers</summary>
                  <ul className="interview-answer">
                    {item.strongAnswer.map((point) => <li key={point}>{point}</li>)}
                  </ul>
                </details>
                {item.evidence.length > 0 && (
                  <p className="interview-evidence">
                    Inspect first:{" "}
                    {item.evidence.map(({ label, entityKey }) => entityKey === null ? (
                      <code key={label}>{label}</code>
                    ) : (
                      <button
                        key={label}
                        type="button"
                        className="interview-evidence-link"
                        onClick={() => { onSelectEntity(entityKey); }}
                      >
                        <code>{label}</code>
                      </button>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
