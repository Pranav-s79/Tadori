import { createHash } from "node:crypto";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { ExtractionContext } from "../src/extractorContract.js";
import { LANGUAGE_BY_ID } from "../src/languageRegistry.js";
import { structuralExtractor } from "../src/structuralExtractor.js";

function contextFor(files: Readonly<Record<string, { language: string; source: string }>>): ExtractionContext {
  const fileContents = new Map<string, Buffer>();
  const indexedFiles = Object.entries(files).map(([normalizedPath, input]) => {
    const registration = LANGUAGE_BY_ID.get(input.language);
    if (registration === undefined) throw new Error(`Missing test registration for ${input.language}`);
    const bytes = Buffer.from(input.source);
    fileContents.set(normalizedPath, bytes);
    return {
      absolutePath: path.resolve("C:/fixture", normalizedPath),
      normalizedPath,
      indexed: true,
      language: input.language,
      isGenerated: false,
      registration
    };
  });
  return {
    root: "C:/fixture",
    registrations: LANGUAGE_BY_ID,
    capture: {
      scan: { indexedFiles, supportFiles: [], diagnostics: [] },
      fileContents,
      fileHashes: new Map(
        [...fileContents].map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")])
      ),
      manifestHashes: new Map(
        [...fileContents].map(([normalizedPath, contents]) => [
          normalizedPath,
          createHash("sha256").update(contents).digest("hex")
        ])
      ),
      workspaceHash: "0".repeat(64)
    }
  };
}

describe("structural extractor", () => {
  test("emits deterministic multi-language symbols, local calls, tests, imports, and unresolved calls", () => {
    const context = contextFor({
      "api/sample.py": {
        language: "python",
        source: [
          "import json",
          "class Base:",
          "    pass",
          "class Child(Base):",
          "    def method(self):",
          "        return helper()",
          "def helper():",
          "    return 1",
          "def test_behavior():",
          "    helper()",
          "    dynamic_target()",
          ""
        ].join("\n")
      },
      "native/sample.c": {
        language: "c",
        source: "#include <stdio.h>\nstruct Item { int value; };\nint answer(void) { return 42; }\n"
      },
      "service/sample.go": {
        language: "go",
        source: "package sample\nimport \"fmt\"\ntype Item struct { Value int }\nfunc answer() int { fmt.Println(42); return 42 }\n"
      },
      "tools/sample.rs": {
        language: "rust",
        source: "use std::fmt;\ntrait Value { fn value(&self) -> i32; }\nstruct Item;\nimpl Value for Item { fn value(&self) -> i32 { 42 } }\n"
      },
      "app/Sample.java": {
        language: "java",
        source: "import java.util.List;\nclass Base {}\nclass Sample extends Base { int value() { return 42; } }\n"
      },
      "native/sample.cpp": {
        language: "cpp",
        source: "#include <vector>\nclass Base {};\nclass Sample : public Base { public: int value() { return 42; } };\n"
      }
    });

    const first = structuralExtractor.extract(context);
    const second = structuralExtractor.extract(context);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    expect(first.nodes.some((node) => node.kind === "class" && node.displayName === "Child")).toBe(true);
    expect(first.nodes.some((node) => node.kind === "method" && node.displayName === "method")).toBe(true);
    expect(first.nodes.some((node) => node.kind === "test" && node.displayName === "test_behavior")).toBe(true);
    expect(first.nodes.some((node) => node.kind === "type" && node.displayName === "Item" && node.language === "c")).toBe(true);
    expect(first.nodes.some((node) => node.kind === "type" && node.displayName === "Item" && node.language === "go")).toBe(true);
    expect(first.nodes.some((node) => node.kind === "method" && node.displayName === "value" && node.language === "rust")).toBe(true);
    expect(first.nodes.some((node) => node.kind === "method" && node.displayName === "value" && node.language === "java")).toBe(true);
    expect(first.nodes.some((node) => node.kind === "method" && node.displayName === "value" && node.language === "cpp")).toBe(true);
    expect(first.edges.some((edge) => edge.relation === "extends" && edge.resolution === "resolved")).toBe(true);
    expect(first.edges.some((edge) => edge.relation === "implements" && edge.language === "rust")).toBe(true);
    expect(first.edges.some((edge) => edge.relation === "tests" && edge.resolution === "resolved")).toBe(true);
    expect(first.edges.some((edge) => edge.relation === "calls" && edge.resolution === "unresolved")).toBe(true);
    expect(first.edges.filter((edge) => edge.relation === "imports").length).toBeGreaterThanOrEqual(3);
    expect(first.nodes.every((node) => node.lineStart === null || node.lineStart >= 1)).toBe(true);
    expect(first.nodes.every((node) => node.bodyHash === null || /^[0-9a-f]{64}$/.test(node.bodyHash))).toBe(true);
  });

  test("isolates one language parser failure and retains unaffected files", () => {
    const context = contextFor({
      "bad.py": { language: "python", source: "def broken():\n    pass\n" },
      "good.go": { language: "go", source: "package sample\nfunc good() {}\n" }
    });
    const registrations = new Map(context.registrations);
    const python = registrations.get("python");
    if (python === undefined) throw new Error("Missing Python registration");
    registrations.set("python", { ...python, parserId: "tree-sitter-not-allowed" });

    const result = structuralExtractor.extract({ ...context, registrations });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "structural-parse-failed", file: "bad.py", language: "python"
    }));
    expect(result.nodes.some((node) => node.file === "good.go" && node.displayName === "good")).toBe(true);
    expect(result.nodes.some((node) => node.file === "bad.py")).toBe(false);
  });
});
