import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

    atlas.focus();
    fireEvent.keyDown(atlas, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("story");
    expect(screen.getByRole("tab", { name: "Story" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Story" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("table");
    expect(screen.getByRole("tab", { name: "Table" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Table" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("atlas");
    expect(atlas).toHaveFocus();
  });
});
