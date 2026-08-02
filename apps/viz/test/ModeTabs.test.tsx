import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModeTabs } from "../src/shell/ModeTabs.tsx";

afterEach(cleanup);

describe("ModeTabs", () => {
  it("exposes one selected workspace mode", () => {
    render(<ModeTabs active="atlas" onChange={() => undefined} />);
    expect(screen.getByRole("tab", { name: "Atlas" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("changes mode when a tab is activated", () => {
    const onChange = vi.fn();
    render(<ModeTabs active="atlas" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(onChange).toHaveBeenCalledWith("changes");
  });

  it("supports arrow, Home, and End navigation", () => {
    const onChange = vi.fn();
    render(<ModeTabs active="atlas" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Atlas" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("interview");
    expect(screen.getByRole("tab", { name: "Interview" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Interview" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("table");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Table" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("overview");
  });
});
