import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { EvidenceList } from "../inspect/EvidenceList.tsx";
import {
  fetchRouteStory,
  type BehaviorStory,
  type StoryError,
  type StoryStep,
  type StoryStepLabel,
  type StoryTransition
} from "./storyApi.ts";
import { resolveStepNames, type StepName } from "./stepNames.ts";
import "./story.css";

/** Stable identity so the resolve effect cannot re-fire on a fresh empty map. */
const EMPTY_STEP_NAMES: ReadonlyMap<string, StepName> = new Map();

export interface StoryPlaybackState {
  story: BehaviorStory;
  activeStepIndex: number;
  activeStep: StoryStep | null;
  activeTransition: StoryTransition | null;
}

interface StoryViewProps {
  /** The route entity to tell the story of; null hides the view. */
  entityKey: string | null;
  /** Absolute repository root for confined evidence deep links. */
  repoRoot?: string | null;
  onInspect?: (entityKey: string) => void;
  onClose?: () => void;
  onPlaybackChange?: (playback: StoryPlaybackState | null) => void;
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

/**
 * The step heading. `/story/route/:key` carries no display name, so this used
 * to print the raw 64-character entity digest and the trace could not be read,
 * let alone recalled. `name` is resolved separately through the entity endpoint;
 * until it arrives, or when the snapshot genuinely cannot name the entity, the
 * row says so instead of showing the digest as if it were a name.
 *
 * Each step is a stepping-stone plate. `hop` sets how far down the descent it
 * sits and is always stated in words; a step whose chain back to the route the
 * DTO does not prove has no hop and sits flat rather than at a guessed depth.
 */
function StepRow({
  step,
  index,
  hop,
  onPath,
  repoRoot,
  name,
  onInspect,
  active
}: {
  step: StoryStep;
  index: number;
  hop: number | null;
  onPath: boolean;
  repoRoot: string | null;
  name: StepName | undefined;
  onInspect?: (entityKey: string) => void;
  active: boolean;
}): ReactElement {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Optional call: jsdom has no scrollIntoView. Instant, so nothing animates.
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const heading = name === undefined
    ? "Resolving name…"
    : name.displayName ?? "Name unavailable in this snapshot";
  const reach = hop === null ? "" : `${hop} hop${hop === 1 ? "" : "s"} from the route · `;
  return (
    <li
      ref={ref}
      className={`story-step story-step-${step.label}${active ? " story-step-active" : ""}`}
      aria-current={active ? "step" : undefined}
      data-on-path={onPath ? "true" : undefined}
      style={{ "--story-descent": hop === null ? 0 : Math.min(hop - 1, 4) } as CSSProperties}
    >
      <span className="story-step-stone" aria-hidden="true">{index + 1}</span>
      <div className="story-step-head">
        <span className="story-step-kind">{step.kind}</span>
        {step.entityKey !== null ? (
          <button type="button" onClick={() => onInspect?.(step.entityKey as string)}>
            {heading}
          </button>
        ) : (
          <span className="story-step-wall">Unresolved wall (dynamic dispatch)</span>
        )}
        <span className="story-step-label">{storyStepLabelText(step.label)}</span>
      </div>
      {name?.qualifiedName !== null && name?.qualifiedName !== undefined && (
        <p className="story-step-qualified">{name.qualifiedName}</p>
      )}
      <div className="story-step-provenance">
        {`${reach}${step.origin} · ${step.confidence} · ${step.resolution}`}
      </div>
      <EvidenceList evidence={step.evidence} omittedCount={0} repoRoot={repoRoot} />
    </li>
  );
}

export function transitionForStoryStep(story: BehaviorStory, stepIndex: number): StoryTransition | null {
  const step = story.steps[stepIndex];
  if (step === undefined) return null;
  if (step.entityKey !== null) {
    return story.transitions.find((transition) => transition.to === step.entityKey) ?? null;
  }
  const unresolvedIndex = story.steps.slice(0, stepIndex + 1)
    .filter((candidate) => candidate.entityKey === null).length - 1;
  const transition = story.unresolvedTransitions[unresolvedIndex] ?? null;
  return transition === null ? null : { ...transition, to: null, resolved: false, resolution: "unresolved" };
}

/**
 * Indices of the steps on the evidenced path from the route to `stepIndex`,
 * inclusive and in descent order, or null when the DTO does not prove a chain
 * back to the route. Steps arrive in BFS order, so consecutive steps are NOT a
 * call chain; this walks the same predecessor rule the map uses to draw the
 * active path (the first resolved transition into a key). An unresolved wall
 * has no destination, so its path runs back from the source it hangs off.
 */
export function evidencedPath(story: BehaviorStory, stepIndex: number): number[] | null {
  const step = story.steps[stepIndex];
  if (step === undefined) return null;
  const indexByKey = new Map<string, number>();
  story.steps.forEach((candidate, index) => {
    if (candidate.entityKey !== null && !indexByKey.has(candidate.entityKey)) indexByKey.set(candidate.entityKey, index);
  });
  const path = [stepIndex];
  let cursor = step.entityKey ?? transitionForStoryStep(story, stepIndex)?.from ?? null;
  if (cursor === null) return null;
  if (step.entityKey === null && cursor !== story.entryPoint) {
    const source = indexByKey.get(cursor);
    if (source === undefined) return null;
    path.push(source);
  }
  const seen = new Set<string>();
  while (cursor !== story.entryPoint) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const key: string = cursor;
    const predecessor = story.transitions.find((transition) =>
      transition.resolved && transition.resolution !== "unresolved" && transition.to === key);
    if (predecessor === undefined) return null;
    cursor = predecessor.from;
    if (cursor !== story.entryPoint) {
      const parent = indexByKey.get(cursor);
      if (parent === undefined) return null;
      path.push(parent);
    }
  }
  return path.reverse();
}

/** The active path in words: the text equivalent of the copper rail. */
function evidencedPathText(story: BehaviorStory, path: readonly number[]): string {
  const stops = path.map((index) =>
    story.steps[index]?.entityKey === null ? `step ${index + 1} (destination unknown)` : `step ${index + 1}`);
  return `Evidenced path: ${["route", ...stops].join(" → ")}`;
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
export function StoryView({ entityKey, repoRoot = null, onInspect, onClose, onPlaybackChange }: StoryViewProps): ReactElement | null {
  const [state, setState] = useState<StoryState>({ status: "loading" });
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [stepNames, setStepNames] = useState<ReadonlyMap<string, StepName>>(EMPTY_STEP_NAMES);
  // ponytail: O(steps²) walk; fine for route stories, index transitions by key if they reach thousands.
  const paths = useMemo(
    () => state.status === "ready" ? state.story.steps.map((_, index) => evidencedPath(state.story, index)) : [],
    [state]
  );
  const activePath = paths[activeStepIndex] ?? null;

  useEffect(() => {
    if (entityKey === null) {
      setState({ status: "loading" });
      setActiveStepIndex(-1);
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
          setActiveStepIndex(-1);
          setState({ status: "refused", error: result });
        } else {
          setActiveStepIndex(result.steps.length === 0 ? -1 : 0);
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

  // Resolved after the story arrives, not with it: the story endpoint carries
  // no display names, so the names come from the entity endpoint the inspector
  // already uses. The steps render immediately and the digests never appear.
  useEffect(() => {
    if (state.status !== "ready") {
      setStepNames(EMPTY_STEP_NAMES);
      return;
    }
    let cancelled = false;
    const keys = state.story.steps.flatMap((step) => step.entityKey === null ? [] : [step.entityKey]);
    void resolveStepNames(keys).then((names) => {
      if (!cancelled) setStepNames(names);
    });
    return () => { cancelled = true; };
  }, [state]);

  useEffect(() => {
    if (state.status !== "ready") {
      onPlaybackChange?.(null);
      return;
    }
    onPlaybackChange?.({
      story: state.story,
      activeStepIndex,
      activeStep: state.story.steps[activeStepIndex] ?? null,
      activeTransition: transitionForStoryStep(state.story, activeStepIndex)
    });
  }, [activeStepIndex, onPlaybackChange, state]);

  useEffect(() => () => onPlaybackChange?.(null), [onPlaybackChange]);

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
          {/* The landing plate: the route the descent starts from. */}
          <div className="story-landing">
            <h3 className="story-title">{state.story.title}</h3>
            <p className="story-trigger">{`Trigger: ${state.story.trigger}`}</p>
            <p className="story-confidence">{`Overall confidence: ${state.story.confidence}`}</p>
          </div>

          {state.story.steps.length > 0 && (
            <nav className="story-transport" aria-label="Story step transport">
              <button type="button" disabled={activeStepIndex <= 0} onClick={() => setActiveStepIndex((index) => Math.max(0, index - 1))}>
                Previous evidenced step
              </button>
              <span role="status">{`Step ${activeStepIndex + 1} of ${state.story.steps.length}`}</span>
              <button type="button" disabled={activeStepIndex >= state.story.steps.length - 1} onClick={() => setActiveStepIndex((index) => Math.min(state.story.steps.length - 1, index + 1))}>
                Next evidenced step
              </button>
            </nav>
          )}
          {activePath !== null && <p className="story-path">{evidencedPathText(state.story, activePath)}</p>}

          {state.story.steps.length === 0 ? (
            <p role="status">No reachable steps from this route in the snapshot.</p>
          ) : (
            <ol className="story-steps" aria-label="Story steps">
              {state.story.steps.map((step, index) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={index}
                  hop={paths[index]?.length ?? null}
                  onPath={activePath?.includes(index) ?? false}
                  repoRoot={repoRoot}
                  name={stepNames.get(step.entityKey ?? "")}
                  onInspect={onInspect}
                  active={index === activeStepIndex}
                />
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
