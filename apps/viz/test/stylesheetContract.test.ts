import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Assertions about the stylesheet as a file. They live under `apps/viz/test`
 * rather than beside the components because `apps/viz/src/**` is the browser
 * bundle and is forbidden by lint from importing Node builtins — correctly, and
 * these need `node:fs`.
 *
 * They exist because the defects they cover were invisible to a component test:
 * a missing rule renders as browser defaults, which is valid markup and passing
 * behaviour, and only looks broken to a person.
 */

// Resolved from the Vitest root (apps/viz) rather than import.meta.url: under
// the jsdom environment the SSR transform leaves import.meta.url unusable here,
// and the resulting path silently became "<test dir>/undefined".
function stylesheet(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "src", name), "utf8");
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 0xff)
    + 0.7152 * channel((n >> 8) & 0xff)
    + 0.0722 * channel(n & 0xff);
}

function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function token(name: string): string {
  const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i").exec(stylesheet("design/tokens.css"))?.[1];
  if (value === undefined) throw new Error(`token ${name} is not declared`);
  return value;
}

describe("reading surfaces", () => {
  /**
   * The Overview entity links reused --tadori-focus, which is an outline colour
   * held to the 3:1 non-text threshold, and measured 4.31:1 as text. Lighthouse
   * failed it on the landing surface's primary control.
   */
  it.each(["--tadori-ground", "--tadori-panel", "--tadori-panel-raised"])(
    "keeps link text at AA against %s",
    (surface) => {
      expect(contrastRatio(token("--tadori-link"), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
  );

  /**
   * The document modes size themselves to their content. While every mode panel
   * was `overflow: hidden` that left 1381px of the 2063px Overview unreachable
   * by wheel or scrollbar at 1440x900.
   */
  it("lets the document modes scroll instead of clipping them", () => {
    expect(stylesheet("index.css"))
      .toMatch(/\.mode-panel-overview,\s*\n\.mode-panel-interview\s*\{[^}]*overflow-y:\s*auto/);
  });
});

describe("component stylesheet coverage", () => {
  /**
   * Each of these rendered as unstyled browser defaults because no rule existed
   * anywhere: the search row as one concatenated string, the inspector metadata
   * as an indented definition list, the source slice as bare text.
   */
  it.each([
    ".search-result-row",
    ".search-result-kind",
    ".search-filters-disclosure",
    ".inspect-meta",
    ".inspect-connections button",
    ".inspect-source-body",
    ".story-step-kind",
    ".explore-routes",
    ".atlas-controls",
    ".lens-button-label"
  ])("styles %s rather than leaving it at browser defaults", (selector) => {
    const escaped = selector.replaceAll(".", "\\.").replaceAll(" ", "\\s+");
    expect(stylesheet("index.css")).toMatch(new RegExp(`${escaped}\\s*[,{:]`));
  });

  it("lays the inspector metadata out as a grid with flush values", () => {
    const css = stylesheet("index.css");
    expect(css).toMatch(/\.inspect-meta\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.inspect-meta\s+dd\s*\{[^}]*margin:\s*0/);
  });

  /**
   * Showing the lens symbol and its word together makes the visible text read
   * "BBoundaries", which is not contained in the accessible name "Boundaries
   * lens" — WCAG 2.5.3 Label in Name, and axe reports it.
   */
  it("never displays the lens symbol and its word at the same breakpoint", () => {
    expect(stylesheet("index.css")).toMatch(/\.lens-button-symbol\s*\{[^}]*display:\s*none/);
  });
});
