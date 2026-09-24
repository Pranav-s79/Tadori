import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewPanel } from "./OverviewPanel.tsx";

describe("OverviewPanel", () => {
  it("draws one decorative plate per section and keeps every basis as text", () => {
    const { container } = render(
      <OverviewPanel
        context={null}
        analysis={null}
        regions={null}
        capabilities={null}
        routes={{ status: "ready", routes: [] }}
        coupling={{ status: "ready", nodes: [] }}
        loading={false}
        error={null}
        onSelectEntity={vi.fn()}
      />
    );

    // The model counts sections and nothing else, and never reaches the
    // accessibility tree: it is a picture of the page, not a second copy of it.
    const sections = screen.getAllByRole("region");
    const model = container.querySelector(".orientation-model");
    expect(model).toHaveAttribute("aria-hidden", "true");
    expect(model?.querySelectorAll("span")).toHaveLength(sections.length);

    // Each stratum is still a named region holding its claims on a plate, and
    // the unknown purpose still says so in words.
    const purpose = screen.getByRole("region", { name: "Repository purpose" });
    expect(purpose.querySelector(".orientation-plate")).not.toBeNull();
    expect(within(purpose).getByText("Unknown")).toHaveAttribute("data-basis", "unknown");
  });
});
