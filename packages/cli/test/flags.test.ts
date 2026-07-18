import { describe, expect, it } from "vitest";
import { parseServeFlags } from "../src/flags.js";

describe("parseServeFlags", () => {
  it("defaults every flag when argv is empty", () => {
    const result = parseServeFlags([]);
    expect(result).toEqual({
      ok: true,
      flags: { port: null, open: true, reindex: false, mode: "2d", snapshotId: null }
    });
  });

  it("parses --port to a number", () => {
    const result = parseServeFlags(["--port", "4000"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flags.port).toBe(4000);
  });

  it("rejects a non-numeric --port value", () => {
    const result = parseServeFlags(["--port", "abc"]);
    expect(result).toEqual({ ok: false, error: "--port requires a number" });
  });

  it("parses --no-open to open:false", () => {
    const result = parseServeFlags(["--no-open"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flags.open).toBe(false);
  });

  it("parses --reindex to reindex:true", () => {
    const result = parseServeFlags(["--reindex"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flags.reindex).toBe(true);
  });

  it("parses --mode 2d", () => {
    const result = parseServeFlags(["--mode", "2d"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flags.mode).toBe("2d");
  });

  it("accepts --mode 2.5d at the flag-parsing level", () => {
    const result = parseServeFlags(["--mode", "2.5d"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flags.mode).toBe("2.5d");
  });

  it("accepts --mode 3d-experiment at the flag-parsing level", () => {
    const result = parseServeFlags(["--mode", "3d-experiment"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flags.mode).toBe("3d-experiment");
  });

  it("rejects an unknown --mode value", () => {
    const result = parseServeFlags(["--mode", "4d"]);
    expect(result).toEqual({ ok: false, error: "Unknown mode 4d" });
  });

  it("parses --snapshot to a numeric id", () => {
    const result = parseServeFlags(["--snapshot", "12"]);
    expect(result.ok).toBe(true);
    expect(result.ok && result.flags.snapshotId).toBe(12);
  });

  it("rejects a non-numeric --snapshot value", () => {
    const result = parseServeFlags(["--snapshot", "abc"]);
    expect(result).toEqual({ ok: false, error: "--snapshot requires a numeric id" });
  });

  it("rejects an unrecognized flag with the exact error string", () => {
    const result = parseServeFlags(["--bogus"]);
    expect(result).toEqual({ ok: false, error: "Unknown flag --bogus" });
  });

  it("parses multiple flags together", () => {
    const result = parseServeFlags(["--port", "5001", "--no-open", "--reindex", "--mode", "2d"]);
    expect(result).toEqual({
      ok: true,
      flags: { port: 5001, open: false, reindex: true, mode: "2d", snapshotId: null }
    });
  });
});
