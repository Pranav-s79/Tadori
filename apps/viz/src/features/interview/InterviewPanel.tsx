import type { ReactElement } from "react";
import { ClaimBadge } from "../../design/ClaimBadge.tsx";
import { buildInterviewQuestions, groupQuestions, type InterviewInput } from "./interviewModel.ts";

export interface InterviewPanelProps extends InterviewInput {
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
export function InterviewPanel({ onSelectEntity, ...input }: InterviewPanelProps): ReactElement {
  const grouped = groupQuestions(buildInterviewQuestions(input));
  const subjectName = input.subject?.displayName ?? "this repository";
  // Evidence mixes entity keys with file paths and language ids. Only a key the
  // served graph actually carries can be inspected; a button for the rest would
  // promise a selection that silently resolves to nothing.
  const inspectable = new Set(input.nodes.map((node) => node.entityKey));

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
                    {item.evidence.map((key) => inspectable.has(key) ? (
                      <button
                        key={key}
                        type="button"
                        className="interview-evidence-link"
                        onClick={() => { onSelectEntity(key); }}
                      >
                        <code>{key}</code>
                      </button>
                    ) : (
                      <code key={key}>{key}</code>
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
