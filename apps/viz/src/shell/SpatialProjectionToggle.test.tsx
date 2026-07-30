import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpatialProjectionToggle } from "./SpatialProjectionToggle.tsx";

describe("SpatialProjectionToggle", () => {
  it("keeps Plan selected by controlled default and exposes Relief explicitly", () => {
    const onChange = vi.fn();
    render(<SpatialProjectionToggle active="plan" onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Atlas projection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Relief" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Relief" }));
    expect(onChange).toHaveBeenCalledWith("relief");
  });

  it("announces the controlled Relief selection and keeps both native buttons operable", () => {
    const onChange = vi.fn();
    render(<SpatialProjectionToggle active="relief" onChange={onChange} />);
    const plan = screen.getByRole("button", { name: "Plan" });
    const relief = screen.getByRole("button", { name: "Relief" });
    expect(plan).toHaveAttribute("type", "button");
    expect(relief).toHaveAttribute("type", "button");
    expect(plan).toHaveAttribute("aria-pressed", "false");
    expect(relief).toHaveAttribute("aria-pressed", "true");
    plan.focus();
    expect(plan).toHaveFocus();
    fireEvent.click(plan);
    expect(onChange).toHaveBeenCalledWith("plan");
  });
});
