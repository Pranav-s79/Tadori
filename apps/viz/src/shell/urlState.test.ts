import { describe, expect, it } from "vitest";
import { readUrlState, writeUrlState, type UrlState } from "./urlState.ts";

const defaults: UrlState = {
  mode: "atlas",
  projection: "plan",
  lenses: { boundaries: true, changes: false, observations: false, provenance: true },
  storyEntityKey: null,
  selectedEntityKey: null
};

describe("readUrlState", () => {
  it("restores a shared reading of the repository", () => {
    const state = readUrlState("?mode=table&view=relief&lens=changes&select=pkg:store", defaults);
    expect(state.mode).toBe("table");
    expect(state.projection).toBe("relief");
    expect(state.lenses).toEqual({
      boundaries: false, changes: true, observations: false, provenance: false
    });
    expect(state.selectedEntityKey).toBe("pkg:store");
  });

  it("degrades unknown values to defaults instead of throwing", () => {
    // A shared link is untrusted input; it must never crash the app.
    const state = readUrlState("?mode=teleport&view=hologram&lens=wat,,%20", defaults);
    expect(state.mode).toBe("atlas");
    expect(state.projection).toBe("plan");
    expect(state.lenses).toEqual({
      boundaries: false, changes: false, observations: false, provenance: false
    });
  });

  it("keeps defaults when no parameters are present", () => {
    expect(readUrlState("", defaults)).toEqual(defaults);
  });

  it("distinguishes an absent lens list from an explicitly empty one", () => {
    // "not specified" keeps defaults; "all lenses off" is a real reachable state.
    expect(readUrlState("", defaults).lenses).toEqual(defaults.lenses);
    expect(readUrlState("?lens=", defaults).lenses).toEqual({
      boundaries: false, changes: false, observations: false, provenance: false
    });
  });
});

describe("writeUrlState", () => {
  it("keeps an untouched session's URL clean", () => {
    expect(writeUrlState(defaults, defaults)).toBe("");
  });

  it("round-trips every non-default field", () => {
    const state: UrlState = {
      mode: "story",
      projection: "relief",
      lenses: { boundaries: false, changes: true, observations: true, provenance: false },
      storyEntityKey: "route:GET /a",
      selectedEntityKey: "fn:handle"
    };
    expect(readUrlState(writeUrlState(state, defaults), defaults)).toEqual(state);
  });

  it("is stable: the same state always yields the same link", () => {
    const state: UrlState = { ...defaults, mode: "changes", selectedEntityKey: "pkg:store" };
    expect(writeUrlState(state, defaults)).toBe(writeUrlState(state, defaults));
  });
});
