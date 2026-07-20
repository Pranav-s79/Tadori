import { describe, expect, it } from "vitest";
import type { Confidence, Origin, Resolution } from "../src/api/types.ts";
import { edgeVisualStyle } from "../src/legend.ts";

const ORIGINS: Origin[] = ["compiler", "heuristic", "git", "doc", "human", "llm"];
const CONFIDENCES: Confidence[] = ["certain", "likely", "inferred"];
const RESOLUTIONS: Resolution[] = ["resolved", "partial", "unresolved"];

/**
 * Reference implementation, independently re-derived from the spec's
 * literal English rule (not copy-pasted from src/legend.ts), so this test
 * can't pass merely by re-stating the implementation's own logic.
 *
 * Spec: dash starts null (solid). If confidence==="likely" -> dashed.
 * If confidence==="inferred" OR resolution!=="resolved" -> dotted, and
 * dotted takes precedence over dashed. muted iff origin is doc or git,
 * independent of dash.
 */
function expected(origin: Origin, confidence: Confidence, resolution: Resolution) {
  let dash: number[] | null = null;
  if (confidence === "likely") {
    dash = [4, 2];
  }
  if (confidence === "inferred" || resolution !== "resolved") {
    dash = [1, 2];
  }
  const muted = origin === "doc" || origin === "git";
  return { dash, muted };
}

describe("edgeVisualStyle", () => {
  for (const origin of ORIGINS) {
    for (const confidence of CONFIDENCES) {
      for (const resolution of RESOLUTIONS) {
        it(`(${origin}, ${confidence}, ${resolution})`, () => {
          const result = edgeVisualStyle(origin, confidence, resolution);
          expect(result).toEqual(expected(origin, confidence, resolution));
        });
      }
    }
  }

  it("doc origin is always muted regardless of dash", () => {
    for (const confidence of CONFIDENCES) {
      for (const resolution of RESOLUTIONS) {
        expect(edgeVisualStyle("doc", confidence, resolution).muted).toBe(true);
      }
    }
  });

  it("git origin is always muted regardless of dash", () => {
    for (const confidence of CONFIDENCES) {
      for (const resolution of RESOLUTIONS) {
        expect(edgeVisualStyle("git", confidence, resolution).muted).toBe(true);
      }
    }
  });

  it("non-doc/git origins are never muted", () => {
    for (const origin of ORIGINS.filter((o) => o !== "doc" && o !== "git")) {
      for (const confidence of CONFIDENCES) {
        for (const resolution of RESOLUTIONS) {
          expect(edgeVisualStyle(origin, confidence, resolution).muted).toBe(false);
        }
      }
    }
  });

  it("certain + resolved is solid for every origin", () => {
    for (const origin of ORIGINS) {
      expect(edgeVisualStyle(origin, "certain", "resolved").dash).toBeNull();
    }
  });

  it("likely + resolved is dashed, not dotted", () => {
    expect(edgeVisualStyle("compiler", "likely", "resolved")).toEqual({
      dash: [4, 2],
      muted: false
    });
  });

  it("likely + partial is dotted (resolution overrides dashed)", () => {
    expect(edgeVisualStyle("compiler", "likely", "partial")).toEqual({
      dash: [1, 2],
      muted: false
    });
  });

  it("inferred + resolved is dotted", () => {
    expect(edgeVisualStyle("compiler", "inferred", "resolved")).toEqual({
      dash: [1, 2],
      muted: false
    });
  });

  it("certain + unresolved is dotted (resolution alone triggers dotted)", () => {
    expect(edgeVisualStyle("compiler", "certain", "unresolved")).toEqual({
      dash: [1, 2],
      muted: false
    });
  });
});
