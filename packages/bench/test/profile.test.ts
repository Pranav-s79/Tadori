import { describe, expect, it } from "vitest";
import { availableProfiles, parseProfile, type BenchProfile } from "../src/index.js";

function profile(over: Partial<BenchProfile> & { id: string }): BenchProfile {
  return {
    kind: "plain_claude_code",
    installSteps: ["npm i -g @anthropic/claude-code"],
    invocation: "claude -p {prompt}",
    isolation: "fresh container per run",
    status: "available",
    ...over
  } as BenchProfile;
}

describe("parseProfile", () => {
  it("parses a well-formed available profile", () => {
    const p = parseProfile(profile({ id: "p1" }));
    expect(p.kind).toBe("plain_claude_code");
    expect(p.status).toBe("available");
  });

  it("requires a documented statusReason when a profile is not available", () => {
    // install_failed with no reason → rejected ("failures documented not guessed").
    expect(() => parseProfile(profile({ id: "p1", status: "install_failed" }))).toThrow();
    // install_failed WITH a documented reason → accepted.
    const p = parseProfile(
      profile({ id: "p1", status: "install_failed", statusReason: "npm registry 403 on codegraph" })
    );
    expect(p.statusReason).toMatch(/403/);
  });

  it("rejects an unknown profile kind", () => {
    expect(() =>
      // @ts-expect-error deliberately invalid kind
      parseProfile(profile({ id: "p1", kind: "some_other_tool" }))
    ).toThrow();
  });

  it("rejects an empty invocation or isolation", () => {
    expect(() => parseProfile(profile({ id: "p1", invocation: "" }))).toThrow();
    expect(() => parseProfile(profile({ id: "p1", isolation: "" }))).toThrow();
  });

  it("rejects unknown extra fields (strict)", () => {
    expect(() => parseProfile({ ...profile({ id: "p1" }), sneaky: 1 })).toThrow();
  });
});

describe("availableProfiles", () => {
  it("returns only the runnable (available) profiles", () => {
    const ps = [
      profile({ id: "a", status: "available" }),
      profile({ id: "b", status: "install_failed", statusReason: "missing binary" }),
      profile({ id: "c", kind: "codegraph", status: "unavailable", statusReason: "unmaintained" })
    ];
    expect(availableProfiles(ps).map((p) => p.id)).toEqual(["a"]);
  });
});
