import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryView, storyStepLabelText, transitionForStoryStep } from "./StoryView.tsx";
import type { BehaviorStory, StoryStepLabel } from "./storyApi.ts";

/**
 * The story endpoint carries no display name per step, so StoryView resolves
 * names through `/nodes/:key`. The stub routes those separately; a story-only
 * stub leaves every step name unresolved, which is itself a state under test.
 */
function stubFetch(body: unknown, status = 200, nodesByKey: Record<string, unknown> = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const nodeMatch = /\/nodes\/([^/?]+)/.exec(url);
      if (nodeMatch?.[1] !== undefined) {
        const node = nodesByKey[decodeURIComponent(nodeMatch[1])];
        return Promise.resolve({
          ok: node !== undefined,
          status: node === undefined ? 404 : 200,
          json: async () => Promise.resolve(node ?? {})
        } as Response);
      }
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => Promise.resolve(body)
      } as Response);
    })
  );
}

/** Minimal `/nodes/:key` body carrying the two fields StoryView reads. */
function nodeDetail(displayName: string, qualifiedName: string): unknown {
  return {
    entityKey: "k-handler",
    kind: "function",
    displayName,
    qualifiedName,
    file: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    exported: true,
    fanIn: 0,
    evidence: [],
    evidenceOmittedCount: 0,
    freshness: "fresh",
    stale: false,
    staleReason: null,
    outEdges: [],
    inEdges: []
  };
}

function story(overrides: Partial<BehaviorStory> = {}): BehaviorStory {
  return {
    id: "story:route:k-route:1",
    title: "GET /users/:id",
    trigger: "GET /users/:id",
    entryPoint: "k-route",
    steps: [],
    transitions: [],
    tests: [],
    unresolvedTransitions: [],
    branches: [],
    evidenceOmittedCount: 0,
    snapshotId: 1,
    confidence: "certain",
    runtimeObserved: false,
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storyStepLabelText", () => {
  const labels: StoryStepLabel[] = [
    "statically-resolved",
    "test-backed",
    "documented",
    "inferred",
    "ambiguous",
    "unresolved"
  ];
  it.each(labels)("returns non-empty honest text for %s", (label) => {
    expect(storyStepLabelText(label).length).toBeGreaterThan(0);
  });

  it("never phrases a label as observed runtime coverage", () => {
    const all = labels.map(storyStepLabelText).join(" ");
    // Positive coverage claims only — the honest negation "not observed
    // running" in the test-backed label is exactly what we WANT, so it must
    // not trip this check.
    expect(all).not.toMatch(/\bpassing\b|\bexecuted\b|\bcovers\b/i);
    expect(all).not.toMatch(/(?<!not )observed running/i);
  });
});

describe("StoryView", () => {
  it("renders nothing when no entity is selected", () => {
    const { container } = render(<StoryView entityKey={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("always shows the static-analysis-only banner", async () => {
    stubFetch(story());
    render(<StoryView entityKey="k-route" />);
    expect(screen.getByText(/Static analysis only/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("GET /users/:id")).toBeTruthy());
  });

  it("renders each step with its honest label and links resolved steps", async () => {
    stubFetch(
      story({
        steps: [
          {
            id: "step:0:k-handler",
            entityKey: "k-handler",
            kind: "function",
            resolved: true,
            label: "statically-resolved",
            origin: "compiler",
            confidence: "certain",
            resolution: "resolved",
            evidence: [{
              file: "src/handler.ts",
              kind: "source",
              lineStart: 12,
              lineEnd: 12,
              columnStart: null,
              columnEnd: null,
              commitSha: null,
              excerptHash: null
            }]
          }
        ]
      }),
      200,
      { "k-handler": nodeDetail("handleGetUser", "src/handler.ts.handleGetUser") }
    );
    render(<StoryView entityKey="k-route" repoRoot="/repo" />);
    await waitFor(() =>
      expect(screen.getByText("Statically resolved (compiler-verified reference)")).toBeTruthy()
    );
    // The step is named, not digested. This used to read "function: k-handler"
    // — in the live product a 64-character hex entity key, unreadable and
    // impossible to recall.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "handleGetUser" })).toBeTruthy()
    );
    expect(screen.getByText("src/handler.ts.handleGetUser")).toBeTruthy();
    expect(screen.getByRole("link", { name: /src\/handler\.ts/ })).toHaveAttribute(
      "href",
      "vscode://file//repo/src/handler.ts:12"
    );
  });

  /**
   * The story endpoint genuinely carries no name. When the entity endpoint
   * cannot supply one either, the row has to say so rather than fall back to
   * printing the digest as though it were a name.
   */
  it("says the name is unavailable rather than showing the entity digest", async () => {
    stubFetch(
      story({
        steps: [{
          id: "step:0:k-handler",
          entityKey: "k-handler",
          kind: "function",
          resolved: true,
          label: "statically-resolved",
          origin: "compiler",
          confidence: "certain",
          resolution: "resolved",
          evidence: []
        }]
      })
    );
    render(<StoryView entityKey="k-route" repoRoot="/repo" />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Name unavailable in this snapshot" })).toBeTruthy()
    );
    expect(screen.queryByText(/k-handler/)).toBeNull();
  });

  it("renders an unresolved wall explicitly, never a destination", async () => {
    stubFetch(
      story({
        steps: [
          {
            id: "step:0:unresolved",
            entityKey: null,
            kind: "unresolved",
            resolved: false,
            label: "unresolved",
            origin: "heuristic",
            confidence: "inferred",
            resolution: "unresolved",
            evidence: []
          }
        ],
        unresolvedTransitions: [
          {
            from: "k-route",
            to: null,
            relation: "calls",
            origin: "heuristic",
            confidence: "inferred",
            resolution: "unresolved",
            resolved: false,
            evidence: []
          }
        ]
      })
    );
    render(<StoryView entityKey="k-route" />);
    await waitFor(() => expect(screen.getByText("Unresolved wall (dynamic dispatch)")).toBeTruthy());
    expect(screen.getByText(/Unresolved walls \(1\)/)).toBeTruthy();
  });

  it("exposes accessible previous/next playback to the map owner", async () => {
    const loaded = story({
      steps: [
        { id: "step:0:a", entityKey: "a", kind: "function", resolved: true, label: "statically-resolved", origin: "compiler", confidence: "certain", resolution: "resolved", evidence: [] },
        { id: "step:1:b", entityKey: "b", kind: "function", resolved: true, label: "documented", origin: "doc", confidence: "likely", resolution: "resolved", evidence: [] }
      ],
      transitions: [
        { from: "k-route", to: "a", relation: "routes_to", origin: "compiler", confidence: "certain", resolution: "resolved", resolved: true, evidence: [] },
        { from: "a", to: "b", relation: "calls", origin: "doc", confidence: "likely", resolution: "resolved", resolved: true, evidence: [] }
      ]
    });
    stubFetch(loaded);
    const onPlaybackChange = vi.fn();
    render(<StoryView entityKey="k-route" onPlaybackChange={onPlaybackChange} />);
    await waitFor(() => expect(screen.getByText("Step 1 of 2")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Previous evidenced step" })).toBeDisabled();
    await waitFor(() => expect(onPlaybackChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeStepIndex: 0, activeTransition: loaded.transitions[0] })));

    fireEvent.click(screen.getByRole("button", { name: "Next evidenced step" }));
    expect(screen.getByText("Step 2 of 2")).toBeTruthy();
    await waitFor(() => expect(onPlaybackChange).toHaveBeenLastCalledWith(expect.objectContaining({ activeStepIndex: 1, activeTransition: loaded.transitions[1] })));
    expect(screen.getByRole("button", { name: "Next evidenced step" })).toBeDisabled();
  });

  it("normalizes an unresolved transition to an unknown destination", () => {
    const loaded = story({
      steps: [{ id: "step:0:unresolved", entityKey: null, kind: "unresolved", resolved: false, label: "unresolved", origin: "heuristic", confidence: "inferred", resolution: "unresolved", evidence: [] }],
      transitions: [{ from: "a", to: "unresolved:synthetic", relation: "calls", origin: "heuristic", confidence: "inferred", resolution: "unresolved", resolved: false, evidence: [] }],
      unresolvedTransitions: [{ from: "a", to: "unresolved:synthetic", relation: "calls", origin: "heuristic", confidence: "inferred", resolution: "unresolved", resolved: false, evidence: [] }]
    });
    expect(transitionForStoryStep(loaded, 0)).toEqual(expect.objectContaining({ from: "a", to: null, resolved: false }));
  });

  it("explains a not-a-route refusal instead of a generic error", async () => {
    stubFetch({ error: "not_a_route" }, 400);
    render(<StoryView entityKey="k-function" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/starts from a route/)).toBeTruthy();
  });
});
