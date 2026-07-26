import { useCallback, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LensButton } from "../src/shell/LensButton.tsx";
import { useNavigationFocus } from "../src/shell/useNavigationFocus.ts";

afterEach(cleanup);

function DrawerHarness({ drawerMode = true }: { drawerMode?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const focus = useNavigationFocus(open, close, drawerMode);
  return (
    <>
      <button ref={focus.toggleRef} type="button" onClick={() => setOpen((value) => !value)}>Explore</button>
      <aside ref={focus.drawerRef} tabIndex={-1} data-open={open} onKeyDown={focus.onDrawerKeyDown}>
        <input aria-label="Search repository" />
      </aside>
    </>
  );
}

describe("shell accessibility", () => {
  it("moves focus into an opened navigation drawer and restores it on Escape", async () => {
    render(<DrawerHarness />);
    const toggle = screen.getByRole("button", { name: "Explore" });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search repository" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search repository" }), { key: "Escape" });
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("keeps persistent desktop navigation open when Escape is pressed", async () => {
    render(<DrawerHarness drawerMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));
    const search = screen.getByRole("textbox", { name: "Search repository" });
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(document.querySelector("aside")).toHaveAttribute("data-open", "true");
    expect(search).toHaveFocus();
  });

  it("disables map-only lenses with an accessible reason while retaining actionable lenses", () => {
    const mapAction = vi.fn();
    const agentAction = vi.fn();
    render(
      <>
        <LensButton active label="Boundaries" symbol="B" onClick={mapAction} disabledReason="Available in map-based views, not Table mode." />
        <LensButton active={false} label="Agent review" symbol="A" onClick={agentAction} />
      </>
    );
    const boundaries = screen.getByRole("button", { name: /Boundaries lens unavailable/ });
    expect(boundaries).toBeDisabled();
    expect(boundaries).toHaveAttribute("aria-disabled", "true");
    expect(boundaries).toHaveAccessibleDescription("Available in map-based views, not Table mode.");
    fireEvent.click(boundaries);
    expect(mapAction).not.toHaveBeenCalled();
    const agent = screen.getByRole("button", { name: "Agent review lens" });
    expect(agent).toBeEnabled();
    agent.focus();
    fireEvent.keyDown(agent, { key: "Enter" });
    fireEvent.click(agent);
    expect(agentAction).toHaveBeenCalledTimes(1);
  });
});
