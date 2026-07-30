import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ObservationOverlayBadges } from "./ObservationOverlayBadges.tsx";
import type { FileObservationOverlay } from "./observationOverlayApi.ts";

function file(over: Partial<FileObservationOverlay> & { file: string }): FileObservationOverlay {
  return {
    planned: false,
    retrieved: false,
    modifiedObserved: false,
    modifiedActual: false,
    modifiedButNotRetrieved: false,
    plannedNotModified: false,
    modifiedNotPlanned: false,
    ...over
  };
}

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

describe("ObservationOverlayBadges", () => {
  it("renders nothing when the session has no observations", () => {
    stubFetch({ taskPresent: false, files: [] });
    const { container } = render(<ObservationOverlayBadges />);
    // taskPresent:false → component returns null after load.
    return waitFor(() => expect(container.querySelector(".observation-overlay")).toBeNull());
  });

  it("flags a file changed without being read (blind edit) with honest wording", async () => {
    stubFetch({
      taskPresent: true,
      files: [
        file({
          file: "src/secret.ts",
          modifiedActual: true,
          modifiedButNotRetrieved: true,
          modifiedNotPlanned: true
        })
      ]
    });
    render(<ObservationOverlayBadges />);
    await waitFor(() => expect(screen.getByText("src/secret.ts")).toBeTruthy());
    expect(screen.getByText("changed without being read")).toBeTruthy();
    expect(screen.getByText("changed outside the plan")).toBeTruthy();
  });

  it("opens a flagged file through the supplied inspection resolver", async () => {
    const onInspectFile = vi.fn().mockResolvedValue(true);
    stubFetch({
      taskPresent: true,
      files: [file({ file: "src/secret.ts", modifiedActual: true, modifiedButNotRetrieved: true })]
    });
    render(<ObservationOverlayBadges onInspectFile={onInspectFile} />);
    const fileButton = await screen.findByRole("button", { name: "src/secret.ts" });
    fireEvent.click(fileButton);
    await waitFor(() => expect(onInspectFile).toHaveBeenCalledWith("src/secret.ts"));
  });

  it("does not list a clean file (planned + read + modified, no risk)", async () => {
    stubFetch({
      taskPresent: true,
      files: [
        file({
          file: "src/clean.ts",
          planned: true,
          retrieved: true,
          modifiedObserved: true,
          modifiedActual: true
        })
      ]
    });
    render(<ObservationOverlayBadges />);
    await waitFor(() =>
      expect(
        screen.getByText("Every changed file was planned and read before the change.")
      ).toBeTruthy()
    );
    expect(screen.queryByText("src/clean.ts")).toBeNull();
  });

  it("surfaces a fetch failure as an alert, not a silent blank", async () => {
    stubFetch({}, 500);
    render(<ObservationOverlayBadges />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
