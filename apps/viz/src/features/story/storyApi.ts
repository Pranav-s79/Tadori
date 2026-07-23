import type { Confidence, NodeKind, Origin, Resolution } from "../../api/types.ts";
import type { Evidence } from "../inspect/inspectApi.ts";

const API_BASE = "/api/v1";

/**
 * The honesty bucket for a reached step, verbatim from the server (frozen
 * StoryStepLabel). Drives the label chip in the StoryView — never upgraded.
 */
export type StoryStepLabel =
  | "statically-resolved"
  | "test-backed"
  | "documented"
  | "inferred"
  | "ambiguous"
  | "unresolved";

/** One reached step (mirrors server StoryStep). `entityKey` is null at an unresolved wall. */
export interface StoryStep {
  id: string;
  entityKey: string | null;
  kind: NodeKind | "unresolved";
  resolved: boolean;
  label: StoryStepLabel;
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  evidence: Evidence[];
}

/** One traversed edge (mirrors server StoryTransition). `to` is null at a wall. */
export interface StoryTransition {
  from: string;
  to: string | null;
  relation: "routes_to" | "calls" | "references";
  origin: Origin;
  confidence: Confidence;
  resolution: Resolution;
  resolved: boolean;
  evidence: Evidence[];
}

/**
 * A static behavior story (mirrors server BehaviorStory, 08-07A). `runtimeObserved`
 * is ALWAYS false — this is never a runtime/coverage claim. The app cannot
 * import @tadori/* so the shape is re-declared here (same idiom as inspectApi).
 */
export interface BehaviorStory {
  id: string;
  title: string;
  trigger: string;
  entryPoint: string;
  steps: StoryStep[];
  transitions: StoryTransition[];
  tests: string[];
  unresolvedTransitions: StoryTransition[];
  branches: never[];
  evidenceOmittedCount: number;
  snapshotId: number;
  confidence: Confidence;
  runtimeObserved: false;
}

/** Why a story could not be produced, mapped from the server's error codes. */
export type StoryError = "not_a_route" | "ambiguous" | "unknown_entity" | "failed";

/**
 * Fetch the behavior story for a route entity. Distinguishes the server's honest
 * refusals — 400 not_a_route (the entity is not a route trigger), 409 ambiguous,
 * 404 unknown_entity — so the UI can explain WHY rather than showing a generic
 * error. Any other failure is `"failed"`.
 */
export async function fetchRouteStory(entityKey: string): Promise<BehaviorStory | StoryError> {
  const response = await fetch(`${API_BASE}/story/route/${encodeURIComponent(entityKey)}`);
  if (response.ok) {
    return (await response.json()) as BehaviorStory;
  }
  if (response.status === 400) {
    return "not_a_route";
  }
  if (response.status === 409) {
    return "ambiguous";
  }
  if (response.status === 404) {
    return "unknown_entity";
  }
  return "failed";
}
