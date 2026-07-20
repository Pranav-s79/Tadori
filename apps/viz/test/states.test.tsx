import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingState, RefreshingBanner, StaleState } from "../src/states/EmptyLoadingStale.tsx";

afterEach(cleanup);

describe("LoadingState", () => {
  it("shows a loading message", () => {
    render(<LoadingState />);
    expect(screen.getByText("Loading package map…")).toBeInTheDocument();
  });
});

describe("StaleState", () => {
  it("includes the staleReason value in its message", () => {
    render(<StaleState staleReason="watched file changed 4 minutes ago" />);
    expect(screen.getByText(/Data may be out of date/)).toBeInTheDocument();
    expect(screen.getByText(/watched file changed 4 minutes ago/)).toBeInTheDocument();
  });

  it("falls back to a readable message when staleReason is null", () => {
    render(<StaleState staleReason={null} />);
    expect(screen.getByText(/unknown reason/)).toBeInTheDocument();
  });
});

describe("RefreshingBanner", () => {
  it("shows a refreshing banner", () => {
    render(<RefreshingBanner>{null}</RefreshingBanner>);
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
  });

  it("keeps the last-known-good content rendered alongside the banner", () => {
    render(
      <RefreshingBanner>
        <div data-testid="last-known-good">3 packages, 5 edges</div>
      </RefreshingBanner>
    );
    expect(screen.getByText("Refreshing…")).toBeInTheDocument();
    expect(screen.getByTestId("last-known-good")).toBeInTheDocument();
    expect(screen.getByText("3 packages, 5 edges")).toBeInTheDocument();
  });
});

describe("state messages are mutually distinct", () => {
  it("loading, stale, and refreshing text never collide", () => {
    const loadingText = "Loading package map…";
    const staleFragment = "Data may be out of date";
    const refreshingText = "Refreshing…";
    const texts = [loadingText, staleFragment, refreshingText];
    expect(new Set(texts).size).toBe(texts.length);
  });
});
