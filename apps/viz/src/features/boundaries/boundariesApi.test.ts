import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBoundaries, violationFilePath } from "./boundariesApi.ts";

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => Promise.resolve(body)
      } as Response)
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("violationFilePath", () => {
  it("strips the file: prefix", () => {
    expect(violationFilePath("file:src/public/report.ts")).toBe("src/public/report.ts");
  });

  it("leaves a path without the prefix untouched", () => {
    expect(violationFilePath("src/public/report.ts")).toBe("src/public/report.ts");
  });
});

describe("fetchBoundaries", () => {
  it("returns the parsed body on 200", async () => {
    const body = {
      rulesPresent: true,
      violations: [
        {
          ruleId: "public-must-not-import-internal",
          src: "file:src/public/report.ts",
          edgeRelation: "imports",
          dst: "file:src/internal/secret.ts",
          severity: "error",
          evidence: [{ file: "src/public/report.ts", line: 1, contains: "../internal/secret.js" }]
        }
      ]
    };
    mockFetch(200, body);
    const res = await fetchBoundaries();
    expect(res.rulesPresent).toBe(true);
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]?.ruleId).toBe("public-must-not-import-internal");
  });

  it("treats an absent rules file (rulesPresent:false, empty) as a normal result, not an error", async () => {
    mockFetch(200, { rulesPresent: false, violations: [] });
    const res = await fetchBoundaries();
    expect(res.rulesPresent).toBe(false);
    expect(res.violations).toEqual([]);
  });

  it("throws the server error message on a 400 bad_rules", async () => {
    mockFetch(400, { error: "tadori.rules.json: boundary[0] missing string `id`", code: "bad_rules" });
    await expect(fetchBoundaries()).rejects.toThrow(/missing string `id`/);
  });

  it("throws a status-based message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: async () => Promise.reject(new Error("not json"))
        } as unknown as Response)
      )
    );
    await expect(fetchBoundaries()).rejects.toThrow(/boundaries failed: 500/);
  });
});
