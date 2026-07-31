import { useEffect, useState, type ReactElement } from "react";
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
  const [subject, setSubject] = useState<NodeDetail | null>(null);
  const [tests, setTests] = useState<TestsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (subjectEntityKey === null) {
      setSubject(null);
      return;
    }
    fetchNodeDetail(subjectEntityKey)
      .then((result) => {
        if (!cancelled) setSubject(result.status === "ok" ? result.node : null);
      })
      .catch(() => { if (!cancelled) setSubject(null); });
    return () => { cancelled = true; };
  }, [subjectEntityKey]);

  useEffect(() => {
    let cancelled = false;
    fetchLikelyTests()
      .then((body) => { if (!cancelled) setTests({ status: "ready", tests: body.tests }); })
      .catch(() => { if (!cancelled) setTests({ status: "error" }); });
    return () => { cancelled = true; };
  }, []);

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
                  <p className="interview-question-text">{item.question}</p>
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
