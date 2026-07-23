import { useEffect, useState, type ReactElement } from "react";
import { fetchLikelyTests, type TestsResult } from "./exploreApi.ts";

interface LikelyTestsProps {
  /** Optional entity to scope the query to (from a row pivot); all tests otherwise. */
  forEntity?: string;
  onInspect?: (entityKey: string) => void;
}

type TestsState =
  | { status: "loading" }
  | { status: "ready"; result: TestsResult }
  | { status: "error"; message: string };

/** Frozen honesty heading/caption — rendered verbatim, never paraphrased. */
const HEADING = "Likely relevant tests";
const NOT_OBSERVED = "not observed inspected";

/**
 * Likely-test display. Renders the frozen `"Likely relevant tests"` heading and
 * the frozen `"not observed inspected"` caption verbatim: a static/heuristic
 * link is never a claim the test was executed or observed passing. The live
 * /tests endpoint returns the honest node list (`observed:false`), not yet the
 * per-test linkage-kind engine — so no linkage badge is fabricated here.
 */
export function LikelyTests({ forEntity, onInspect }: LikelyTestsProps): ReactElement {
  const [state, setState] = useState<TestsState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchLikelyTests(forEntity)
      .then((result) => {
        if (!cancelled) {
          setState({ status: "ready", result });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [forEntity]);

  return (
    <section className="explore-tests" aria-label={HEADING}>
      <h3>{HEADING}</h3>
      <p className="explore-tests-caption">{NOT_OBSERVED}</p>

      {state.status === "loading" && <p role="status">Loading tests…</p>}
      {state.status === "error" && <p role="alert">{`Tests failed to load: ${state.message}`}</p>}
      {state.status === "ready" &&
        (state.result.tests.length === 0 ? (
          <p role="status">No likely-relevant tests found.</p>
        ) : (
          <ul role="list">
            {state.result.tests.map((test) => (
              <li key={test.entityKey}>
                <button type="button" onClick={() => onInspect?.(test.entityKey)}>
                  {test.displayName}
                </button>
                {test.file !== null && <span className="explore-tests-file"> {test.file}</span>}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
