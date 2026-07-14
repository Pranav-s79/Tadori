import { describe, expect, it } from "vitest";
import {
  edgeCanonicalIdentity,
  entityKey,
  escapeIdentityField,
  fileCanonicalIdentity,
  joinIdentityFields,
  nodeCanonicalIdentity,
  sha256Hex
} from "@tadori/core";

describe("identity escaping", () => {
  it("escapes backslashes before pipes", () => {
    expect(escapeIdentityField("a\\b|c")).toBe("a\\\\b\\|c");
  });

  it("escapes a pre-escaped-looking pipe unambiguously", () => {
    // The raw value contains the two characters `\|`; escaping must produce `\\\|`
    // so it cannot be confused with an escaped pipe of the raw value `|`.
    expect(escapeIdentityField("\\|")).toBe("\\\\\\|");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeIdentityField("src/math.ts.factorial")).toBe("src/math.ts.factorial");
  });

  it("keeps distinct field lists distinct after joining", () => {
    // Without escaping these two would both serialize to "a|b|c".
    expect(joinIdentityFields(["a|b", "c"])).not.toBe(joinIdentityFields(["a", "b|c"]));
  });
});

describe("pipe-delimited canonical serialization", () => {
  it("builds file identities", () => {
    expect(fileCanonicalIdentity("src/math.ts")).toBe("file|src/math.ts");
  });

  it("builds node identities", () => {
    expect(nodeCanonicalIdentity("function", "src/math.ts.factorial")).toBe(
      "node|function|src/math.ts.factorial"
    );
  });

  it("builds edge identities from endpoint entity keys", () => {
    expect(edgeCanonicalIdentity("aa".repeat(32), "contains", "bb".repeat(32))).toBe(
      `edge|${"aa".repeat(32)}|contains|${"bb".repeat(32)}`
    );
  });
});

describe("exact canonical SHA-256 values from the frozen fixture contract", () => {
  // Every expected value below is copied verbatim from
  // packages/fixtures/01-core-symbols/expected/graph.json.
  const cases: Array<[string, string]> = [
    [
      "node|package|@tadori-fixtures/core-symbols",
      "64466d169092b1f47b92fdda7ec332c472677c66566d7f9590b25196967f6ecd"
    ],
    [
      "node|file|src/math.ts",
      "2afa6b72bd63b7754d1cce4ad8a8712b075f2f11de3969ffbe3fadb112ed23e0"
    ],
    [
      "node|function|src/math.ts.factorial",
      "0bd3f4e85bab78e96fb891f977abd443d52a2423eb609557ff21e832a87d1992"
    ],
    [
      "node|method|src/strategy.ts.Strategy.run",
      "fb72984abe5a82f5b4f20198dedfcfe628103cacf7495816b6fa59f108fca926"
    ],
    [
      "node|unresolved|src/dynamic.ts::<unresolved handlers[key]>",
      "1fc1cd00ca1eefb9906c282ea5632ea3cc9936ae98b5f13df1b96a3a15b100bd"
    ]
  ];

  it.each(cases)("sha256(%s)", (canonical, expected) => {
    expect(sha256Hex(canonical)).toBe(expected);
    expect(entityKey(canonical)).toBe(expected);
  });

  it("hashes the package-contains-math edge exactly as the fixture", () => {
    const pkgKey = entityKey("node|package|@tadori-fixtures/core-symbols");
    const fileKey = entityKey("node|file|src/math.ts");
    const canonical = edgeCanonicalIdentity(pkgKey, "contains", fileKey);
    expect(canonical).toBe(
      "edge|64466d169092b1f47b92fdda7ec332c472677c66566d7f9590b25196967f6ecd|contains|2afa6b72bd63b7754d1cce4ad8a8712b075f2f11de3969ffbe3fadb112ed23e0"
    );
    expect(entityKey(canonical)).toBe(
      "4ea8ad9a45579f4e9759f02e93ff3627c4ab1e95c739945d4e454dc3987bd45b"
    );
  });
});

describe("hash stability and collision handling", () => {
  it("produces identical keys across repeated calls", () => {
    const canonical = nodeCanonicalIdentity("class", "src/runner.ts.Runner");
    const first = entityKey(canonical);
    for (let i = 0; i < 100; i += 1) {
      expect(entityKey(canonical)).toBe(first);
    }
  });

  it("rehashes with an appended collision index", () => {
    const canonical = "node|function|src/math.ts.factorial";
    expect(entityKey(canonical, 1)).toBe(sha256Hex(`${canonical}|1`));
    expect(entityKey(canonical, 1)).not.toBe(entityKey(canonical));
    expect(entityKey(canonical, 2)).not.toBe(entityKey(canonical, 1));
  });

  it("rejects negative or fractional collision indexes", () => {
    expect(() => entityKey("x", -1)).toThrow(/non-negative integer/);
    expect(() => entityKey("x", 0.5)).toThrow(/non-negative integer/);
  });
});
