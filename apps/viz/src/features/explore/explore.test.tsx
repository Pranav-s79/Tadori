import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExploreTabs } from "./ExploreTabs.tsx";
import { LikelyTests } from "./LikelyTests.tsx";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LikelyTests honesty wording", () => {
  it("renders the frozen heading and 'not observed inspected' caption verbatim", async () => {
    stubFetch({ tests: [], observed: false, note: "not observed inspected" });
    render(<LikelyTests />);
    expect(screen.getByText("Likely relevant tests")).toBeTruthy();
    expect(screen.getByText("not observed inspected")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No likely-relevant tests found.")).toBeTruthy());
  });

  it("renders the linkage badge but never a runtime-coverage claim", async () => {
    stubFetch({
      target: { entityKey: "tgt", kind: "function", qualifiedName: "f", displayName: "f", file: "f.ts" },
      tests: [
        {
          node: { entityKey: "t1", kind: "test", qualifiedName: "a.test", displayName: "a.test", file: "a.test.ts" },
          linkage: "statically_linked",
          edge: null
        }
      ],
      observed: false,
      note: "not observed inspected"
    });
    const { container } = render(<LikelyTests forEntity="tgt" />);
    await waitFor(() => expect(screen.getByText("a.test")).toBeTruthy());
    expect(screen.getByText(/Statically linked/)).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/passing|covers|verified running/i);
  });
});

describe("ExploreTabs", () => {
  it("mounts only the active tab's view, never two at once", async () => {
    stubFetch({ nodes: [], edges: [], found: false });
    render(<ExploreTabs />);
    // Path tab is default: its from/to form is present, the routes table is not.
    expect(screen.getByLabelText("Path finder")).toBeTruthy();
    expect(screen.queryByLabelText("Routes")).toBeNull();

    stubFetch({ routes: [] });
    fireEvent.click(screen.getByRole("tab", { name: "Routes" }));
    await waitFor(() => expect(screen.queryByLabelText("Path finder")).toBeNull());
  });
});
