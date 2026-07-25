import { describe, expect, test } from "vitest";

import { LANGUAGE_BY_ID } from "../src/languageRegistry.js";
import { parseStructuralSourceSync } from "../src/treeSitterRuntime.js";

const samples = new Map<string, string>([
  ["python", "def answer():\n    return 42\n"],
  ["c", "int answer(void) { return 42; }\n"],
  ["cpp", "class Answer { public: int get() { return 42; } };\n"],
  ["go", "package sample\nfunc answer() int { return 42 }\n"],
  ["rust", "fn answer() -> i32 { 42 }\n"],
  ["java", "class Answer { int get() { return 42; } }\n"]
]);

describe("pinned tree-sitter runtime", () => {
  for (const [language, source] of samples) {
    test(`parses ${language} with its registered package-local grammar`, () => {
      const registration = LANGUAGE_BY_ID.get(language);
      expect(registration).toBeDefined();
      const result = parseStructuralSourceSync(registration!, source);
      expect(result.language).toBe(language);
      expect(result.root.startRow).toBe(0);
      expect(result.root.endRow).toBeGreaterThanOrEqual(1);
      expect(result.root.children.length).toBeGreaterThan(0);
      expect(result.hasErrors).toBe(false);
    });
  }
});
