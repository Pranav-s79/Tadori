import { useEffect, useState, type ReactElement } from "react";
import { EvidenceList } from "../inspect/EvidenceList.tsx";
import {
  fetchRouteStory,
  type BehaviorStory,
  type StoryError,
  type StoryStep,
  type StoryStepLabel
} from "./storyApi.ts";

interface StoryViewProps {
  /** The route entity to tell the story of; null hides the view. */
  entityKey: string | null;
  onInspect?: (entityKey: string) => void;
  onClose?: () => void;
}

/** Human text for each honesty label — exhaustive, never an execution claim. */
export function storyStepLabelText(label: StoryStepLabel): string {
  switch (label) {
    case "statically-resolved":
      return "Statically resolved (compiler-verified reference)";
    case "test-backed":
      return "Test-backed (a test statically links here — not observed running)";
    case "documented":
      return "Documented (a doc/ADR references here)";
    case "inferred":
      return "Inferred (weak/heuristic link)";
    case "ambiguous":
      return "Ambiguous (heuristic, partially resolved)";
    case "unresolved":
      return "Unresolved (dynamic dispatch — destination unknown)";
  }
}

/** Human text for the server's honest refusals. */
function storyErrorText(error: StoryError): string {
  switch (error) {
    case "not_a_route":
      return "A behavior story starts from a route (HTTP trigger). This entity is not a route.";
    case "ambiguous":
      return "That reference matched more than one entity — pick a specific one.";
    case "unknown_entity":
      return "No entity matched that reference in this snapshot.";
    case "failed":
      return "The behavior story could not be loaded.";
  }
}

type StoryState =
  | { status: "loading" }
  | { status: "ready"; story: BehaviorStory }
  | { status: "refused"; error: StoryError };

function StepRow({
  step,
  index,
  onInspect
}: {
  step: StoryStep;
  index: number;
  onInspect?: (entityKey: string) => void;
}): ReactElement {
  const name = step.entityKey ?? "(unresolved)";
  return (
    <li className={`story-step story-step-${step.label}`}>
      <div className="story-step-head">
        <span className="story-step-index" aria-hidden="true">{`${index + 1}.`}</span>
        {step.entityKey !== null ? (
          <button type="button" onClick={() => onInspect?.(step.entityKey as string)}>
            {`${step.kind}: ${name}`}
          </button>
        ) : (
          <span className="story-step-wall">Unresolved wall (dynamic dispatch)</span>
        )}
        <span className="story-step-label">{storyStepLabelText(step.label)}</span>
      </div>
      <div className="story-step-provenance">
        {`${step.origin} · ${step.confidence} · ${step.resolution}`}
      </div>
      <EvidenceList evidence={step.evidence} omittedCount={0} repoRoot={null} />
    </li>
  );
}

/**
 * BehaviorStory view (08-07A frontend). Renders the STATIC behavior story for a
 * route: an ordered list of reached steps with their honesty labels and
 * evidence, the explicit unresolved walls (dynamic dispatch that dead-ends —
 * never an invented destination), and the linked tests. It states up front that
 * this is static analysis only (`runtimeObserved:false`) and never claims a step
 * was executed or observed. Each resolved step links into the existing
 * inspection panel. Reads the DTO only — no graph mutation.
 */
export function StoryView({ entityKey, onInspect, onClose }: StoryViewProps): ReactElement | null {
  const [state, setState] = useState<StoryState>({ status: "loading" });

  useEffect(() => {
    if (entityKey === null) {
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchRouteStory(entityKey)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (typeof result === "string") {
          setState({ status: "refused", error: result });
        } else {
          setState({ status: "ready", story: result });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "refused", error: "failed" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entityKey]);

  if (entityKey === null) {
    return null;
  }

  return (
    <aside className="story-view" aria-label="Behavior story">
      <header className="story-view-head">
        <h2>Behavior story</h2>
        {onClose !== undefined && (
          <button type="button" onClick={onClose} aria-label="Close behavior story">
            ×
          </button>
        )}
      </header>

      {/* Non-negotiable honesty banner: static analysis, never runtime coverage. */}
      <p className="story-static-note" role="note">
        Static analysis only — this is not a record of executed behavior. No step here was
        observed running.
      </p>

      {state.status === "loading" && <p role="status">Deriving story…</p>}

      {state.status === "refused" && (
        <p role="alert" className="story-refused">{storyErrorText(state.error)}</p>
      )}

      {state.status === "ready" && (
        <div className="story-body">
          <h3 className="story-title">{state.story.title}</h3>
          <p className="story-trigger">{`Trigger: ${state.story.trigger}`}</p>
          <p className="story-confidence">{`Overall confidence: ${state.story.confidence}`}</p>

          {state.story.steps.length === 0 ? (
            <p role="status">No reachable steps from this route in the snapshot.</p>
          ) : (
            <ol className="story-steps" aria-label="Story steps">
              {state.story.steps.map((step, index) => (
                <StepRow key={step.id} step={step} index={index} onInspect={onInspect} />
              ))}
            </ol>
          )}

          {state.story.unresolvedTransitions.length > 0 && (
            <section className="story-walls" aria-label="Unresolved transitions">
              <h4>{`Unresolved walls (${state.story.unresolvedTransitions.length})`}</h4>
              <p className="story-walls-note">
                Dynamic dispatch that could not be resolved statically — the destination is
                genuinely unknown, not omitted.
              </p>
            </section>
          )}

          {state.story.tests.length > 0 && (
            <section className="story-tests" aria-label="Linked tests">
              <h4>{`Statically linked tests (${state.story.tests.length})`}</h4>
              <p className="story-tests-note">Static linkage only, never runtime coverage.</p>
              <ul>
                {state.story.tests.map((testKey) => (
                  <li key={testKey}>
                    <button type="button" onClick={() => onInspect?.(testKey)}>
                      {testKey}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
