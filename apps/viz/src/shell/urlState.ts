import type { WorkspaceMode } from "./ModeTabs.tsx";
import type { SpatialProjection } from "./SpatialProjectionToggle.tsx";

/**
 * The part of the workspace worth putting in the address bar: enough to reopen
 * the same reading of the same repository, and nothing that would make a shared
 * link assert a fact the server did not serve.
 *
 * Entity keys are carried verbatim but are always re-resolved against the
 * served graph, so a stale or forged key resolves to nothing rather than
 * fabricating a selection.
 */
export interface UrlState {
  mode: WorkspaceMode;
  projection: SpatialProjection;
  lenses: {
    boundaries: boolean;
    changes: boolean;
    observations: boolean;
    provenance: boolean;
  };
  storyEntityKey: string | null;
  selectedEntityKey: string | null;
}

const MODES: readonly WorkspaceMode[] = ["atlas", "story", "changes", "table"];
const PROJECTIONS: readonly SpatialProjection[] = ["plan", "relief"];
const LENS_NAMES = ["boundaries", "changes", "observations", "provenance"] as const;

type LensName = (typeof LENS_NAMES)[number];

function isMode(value: string | null): value is WorkspaceMode {
  return value !== null && (MODES as readonly string[]).includes(value);
}

function isProjection(value: string | null): value is SpatialProjection {
  return value !== null && (PROJECTIONS as readonly string[]).includes(value);
}

/**
 * A shared link must never crash the app or invent state, so every unknown
 * value degrades to the supplied default instead of throwing. An absent `lens`
 * parameter means "not specified" and keeps the defaults; an empty one means
 * "all lenses off", which is a real and reachable state.
 */
export function readUrlState(search: string, defaults: UrlState): UrlState {
  const params = new URLSearchParams(search);
  const rawMode = params.get("mode");
  const rawProjection = params.get("view");
  const rawLens = params.get("lens");

  let lenses = defaults.lenses;
  if (rawLens !== null) {
    const requested = new Set(rawLens.split(",").map((name) => name.trim()).filter(Boolean));
    lenses = LENS_NAMES.reduce<UrlState["lenses"]>((accumulated, name: LensName) => ({
      ...accumulated,
      [name]: requested.has(name)
    }), { ...defaults.lenses });
  }

  return {
    mode: isMode(rawMode) ? rawMode : defaults.mode,
    projection: isProjection(rawProjection) ? rawProjection : defaults.projection,
    lenses,
    storyEntityKey: params.get("story"),
    selectedEntityKey: params.get("select")
  };
}

/**
 * The canonical query string for a state. Defaults are omitted so an untouched
 * session keeps a clean URL, and keys are written in a fixed order so the same
 * state always produces the same link.
 */
export function writeUrlState(state: UrlState, defaults: UrlState): string {
  const params = new URLSearchParams();
  if (state.mode !== defaults.mode) params.set("mode", state.mode);
  if (state.projection !== defaults.projection) params.set("view", state.projection);

  const active = LENS_NAMES.filter((name) => state.lenses[name]);
  const defaultActive = LENS_NAMES.filter((name) => defaults.lenses[name]);
  if (active.join(",") !== defaultActive.join(",")) params.set("lens", active.join(","));

  if (state.storyEntityKey !== null) params.set("story", state.storyEntityKey);
  if (state.selectedEntityKey !== null) params.set("select", state.selectedEntityKey);

  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}
