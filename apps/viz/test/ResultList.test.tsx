import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultList } from "../src/features/search/ResultList.tsx";
import type { SearchResultRow } from "../src/features/search/searchApi.ts";

afterEach(cleanup);

const rows: SearchResultRow[] = [
  { entityKey: "fn:a", kind: "function", displayName: "a", qualifiedName: "mod.a", file: "src/a.ts", lineStart: 3, lineEnd: 5, exported: true, exactMatch: true, representativePackageKey: "pkg:mod" },
  { entityKey: "cls:b", kind: "class", displayName: "B", qualifiedName: "mod.B", file: "src/b.ts", lineStart: 10, lineEnd: 40, exported: true, exactMatch: false, representativePackageKey: "pkg:mod" },
  { entityKey: "route:c", kind: "route", displayName: "GET /c", qualifiedName: "GET /c", file: null, lineStart: null, lineEnd: null, exported: false, exactMatch: false, representativePackageKey: null }
];

describe("ResultList keyboard navigation", () => {
  it("renders a listbox with one option per row in server order", () => {
    render(<ResultList rows={rows} onSelect={vi.fn()} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    // order preserved verbatim
    expect(options[0]).toHaveAttribute("aria-label", expect.stringContaining("mod.a"));
    expect(options[2]).toHaveAttribute("aria-label", expect.stringContaining("GET /c"));
  });

  it("each option's accessible name includes kind + qualified name", () => {
    render(<ResultList rows={rows} onSelect={vi.fn()} />);
    expect(screen.getByRole("option", { name: /function mod\.a/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /class mod\.B/ })).toBeInTheDocument();
  });

  /**
   * WCAG 2.5.3 Label in Name: the visible label must be contained in the
   * accessible name, because speech input activates a control by what it says.
   * Lighthouse failed the previous punctuated name ("function: mod.a, …")
   * against unpunctuated visible text.
   */
  it("keeps every visible word inside the accessible name", () => {
    render(<ResultList rows={rows} onSelect={vi.fn()} />);
    for (const option of screen.getAllByRole("option")) {
      const accessibleName = option.getAttribute("aria-label") ?? "";
      for (const word of (option.textContent ?? "").split(/\s+/).filter((w) => w.length > 0)) {
        expect(accessibleName).toContain(word);
      }
    }
  });

  /**
   * The six result spans carried no CSS rule anywhere, so the fields rendered
   * as one unbroken token — "functionmod.asrc/a.ts:3exact". The separation has
   * to survive in `textContent`, not only in the grid, or copy-paste and every
   * text-reading consumer still sees the concatenation.
   */
  it("separates the fields so they cannot run together as one string", () => {
    render(<ResultList rows={rows} onSelect={vi.fn()} />);
    const [first] = screen.getAllByRole("option");

    expect(first?.textContent).not.toContain("functionmod.a");
    expect(first?.querySelector(".search-result-kind")?.textContent).toBe("function");
    expect(first?.querySelector(".search-result-name")?.textContent).toBe("mod.a");
    expect(first?.querySelector(".search-result-loc")?.textContent).toBe("src/a.ts:3");
  });

  it("ArrowDown moves the active option (aria-selected + roving tabindex)", () => {
    render(<ResultList rows={rows} onSelect={vi.fn()} />);
    const list = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("tabindex", "0");
    expect(options[0]).toHaveAttribute("tabindex", "-1");
  });

  it("Home/End jump to first/last", () => {
    render(<ResultList rows={rows} onSelect={vi.fn()} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "End" });
    expect(screen.getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("Enter selects the active row's entityKey", () => {
    const onSelect = vi.fn();
    render(<ResultList rows={rows} onSelect={onSelect} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("cls:b");
  });

  it("Space selects the active row", () => {
    const onSelect = vi.fn();
    render(<ResultList rows={rows} onSelect={onSelect} />);
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: " " });
    expect(onSelect).toHaveBeenCalledWith("fn:a");
  });
});
