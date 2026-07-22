import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareFixtureDiff } from "../src/compareDiff.js";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

describe("compareFixtureDiff (fixture-04 coalescing oracle)", () => {
  // The two Stage-A moves coalesce. The Stage-B method rename honestly stays raw
  // under the frozen indexer's declaration-text bodyHash (which changes with the
  // name) — see compareDiff.ts for the full documented divergence from the
  // fixture's authored body-only-hash oracle. The fixture files are untouched.
  it("coalesces the real pipeline: 2 Stage-A pairs, 5 edge pairs; the method rename honestly falls to raw (0 Stage-B), 0 ambiguous", () => {
    const result = compareFixtureDiff(repoRoot);
    // Surface the observed structure on failure for fast diagnosis.
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.observed).toEqual({
      stageAPairs: 2,
      stageBPairs: 0,
      edgePairs: 5,
      ambiguousGroups: 0
    });
  });
});
