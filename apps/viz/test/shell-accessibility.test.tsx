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
      <button ref={focus.toggleRef} type="button" onClick={() => setOpen((value) => !value)}>Search</button>
      <div ref={focus.drawerRef} tabIndex={-1} data-open={open} onKeyDown={focus.onDrawerKeyDown}>
        <button type="button" tabIndex={-1}>Overview</button>
        <input aria-label="Search graph" />
      </div>
      <button type="button" onClick={() => setOpen(false)}>Elsewhere</button>
    </>
  );
}

describe("shell accessibility", () => {
  it("moves focus into an opened navigation drawer and restores it on Escape", async () => {
    render(<DrawerHarness />);
    const toggle = screen.getByRole("button", { name: "Search" });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search graph" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search graph" }), { key: "Escape" });
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("lands on the first control a Tab would reach, skipping roving tab stops", async () => {
    render(<DrawerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search graph" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Overview" })).not.toHaveFocus();
  });

  it("leaves focus where the reader moved it when another control closes the drawer", async () => {
    render(<DrawerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search graph" })).toHaveFocus());
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    fireEvent.click(elsewhere);
    await waitFor(() => expect(document.querySelector("[data-open]")).toHaveAttribute("data-open", "false"));
    expect(elsewhere).toHaveFocus();
  });

  it("keeps persistent desktop navigation open when Escape is pressed", async () => {
    render(<DrawerHarness drawerMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const search = screen.getByRole("textbox", { name: "Search graph" });
    search.focus();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(document.querySelector("[data-open]")).toHaveAttribute("data-open", "true");
    expect(search).toHaveFocus();
  });

  it("toggles a lens from the keyboard and exposes its pressed state", () => {
    const action = vi.fn();
    render(<LensButton active={false} label="Agent review" onClick={action} />);
    const agent = screen.getByRole("button", { name: "Agent review lens" });
    expect(agent).toHaveAttribute("aria-pressed", "false");
    agent.focus();
    fireEvent.keyDown(agent, { key: "Enter" });
    fireEvent.click(agent);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
