import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { StoryView, storyStepLabelText } from "./StoryView.tsx";
import type { BehaviorStory, StoryStepLabel } from "./storyApi.ts";

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => Promise.resolve(body)
      } as Response)
    )
  );
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
            evidence: []
          }
        ]
      })
    );
    render(<StoryView entityKey="k-route" />);
    await waitFor(() =>
      expect(screen.getByText("Statically resolved (compiler-verified reference)")).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: "function: k-handler" })).toBeTruthy();
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

  it("explains a not-a-route refusal instead of a generic error", async () => {
    stubFetch({ error: "not_a_route" }, 400);
    render(<StoryView entityKey="k-function" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/starts from a route/)).toBeTruthy();
  });
});
