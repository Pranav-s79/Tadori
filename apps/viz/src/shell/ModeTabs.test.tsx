import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LensButton } from "./LensButton.tsx";
import { ModeTabs } from "./ModeTabs.tsx";

describe("ModeTabs", () => {
  it("exposes one controlled tab panel with a roving tab stop", () => {
    render(<ModeTabs active="atlas" onChange={vi.fn()} />);

    expect(screen.getByRole("tablist", { name: "Repository views" })).toBeInTheDocument();
    const atlas = screen.getByRole("tab", { name: "Atlas" });
    const table = screen.getByRole("tab", { name: "Table" });
    expect(atlas).toHaveAttribute("aria-selected", "true");
    expect(atlas).toHaveAttribute("aria-controls", "workspace-mode-panel");
    expect(atlas).toHaveAttribute("tabindex", "0");
    expect(table).toHaveAttribute("aria-selected", "false");
    expect(table).toHaveAttribute("tabindex", "-1");
  });

  it("supports the ARIA tabs arrow, Home, and End keyboard pattern", () => {
    const onChange = vi.fn();
    render(<ModeTabs active="atlas" onChange={onChange} />);
    const atlas = screen.getByRole("tab", { name: "Atlas" });

    // Order is Overview, Atlas, Interview, Story, Changes, Table: the reader
    // gets oriented before being handed a graph.
    atlas.focus();
    fireEvent.keyDown(atlas, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("interview");
    expect(screen.getByRole("tab", { name: "Interview" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Interview" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("table");
    expect(screen.getByRole("tab", { name: "Table" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Table" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("overview");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
  });

  /** On a narrow screen the same list opens as a vertical menu. */
  it("also moves with the up and down arrows", () => {
    const onChange = vi.fn();
    render(<ModeTabs active="atlas" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Atlas" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("interview");
    expect(screen.getByRole("tab", { name: "Interview" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Interview" }), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("atlas");
  });
});

describe("LensButton", () => {
  /**
   * The rail showed four bare letters — B, delta, A, P — and no legend
   * anywhere explained them. The accessible name was already correct, so the
   * defect was that sighted readers had strictly less information than
   * screen-reader users.
   */
  it("names the lens in visible text, not only in its accessible name", () => {
    render(<LensButton active={false} label="Boundaries" onClick={() => undefined} />);

    expect(screen.getByText("Boundaries")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Boundaries lens" })).toBeInTheDocument();
  });

  /**
   * The narrow rail swapped the word for that letter again. The word is now
   * the only visible text at every width, so it is always contained in the
   * accessible name (WCAG 2.5.3), and the pressed state is a real attribute
   * rather than only a raised or sunken look.
   */
  it("shows only the word, and exposes the pressed state", () => {
    render(<LensButton active label="Provenance" onClick={() => undefined} />);

    const button = screen.getByRole("button", { name: "Provenance lens" });
    expect(button).toHaveTextContent(/^Provenance$/);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });
});
