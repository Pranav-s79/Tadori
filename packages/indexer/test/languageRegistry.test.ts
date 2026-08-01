import { describe, expect, it } from "vitest";
import { CAPABILITY_FEATURES, CAPABILITY_STATES } from "@tadori/core";
import {
  CAPABILITY_MATRIX,
  LANGUAGE_BY_ID,
  LANGUAGE_REGISTRY,
  UNKNOWN_TEXT_LANGUAGE,
  detectLanguage,
  isGeneratedPath
} from "@tadori/indexer";

describe("multi-language registry", () => {
  it("stays in exact ID parity with the active capability matrix", () => {
    const registryIds = [...LANGUAGE_REGISTRY.map((entry) => entry.id), UNKNOWN_TEXT_LANGUAGE.id].sort();
    expect(registryIds).toEqual(CAPABILITY_MATRIX.languages.map((entry) => entry.id).sort());
    expect(CAPABILITY_MATRIX.states).toEqual(CAPABILITY_STATES);
    for (const language of CAPABILITY_MATRIX.languages) {
      expect(Object.keys(language.features).sort()).toEqual([...CAPABILITY_FEATURES].sort());
      const registration = language.id === UNKNOWN_TEXT_LANGUAGE.id
        ? UNKNOWN_TEXT_LANGUAGE
        : LANGUAGE_BY_ID.get(language.id);
      expect(registration).toMatchObject({
        extractorId: language.extractorId,
        extractorVersion: language.extractorVersion
      });
    }
  });

  it("registers the required baseline languages with deterministic precedence", () => {
    expect(LANGUAGE_REGISTRY.map((entry) => entry.id)).toEqual([
      "dockerfile", "typescript", "javascript", "python", "cpp", "c", "go", "rust",
      "java", "protobuf", "terraform", "yaml", "markdown", "json", "shell", "toml",
      "cmake", "repository-config"
    ]);
    expect([...LANGUAGE_BY_ID.keys()]).toEqual(LANGUAGE_REGISTRY.map((entry) => entry.id));
    expect(LANGUAGE_REGISTRY.every((entry, index, entries) =>
      index === 0 || entries[index - 1]!.precedence >= entry.precedence
    )).toBe(true);
  });

  it("keeps semantic, structural, and repository capabilities explicit", () => {
    expect(LANGUAGE_BY_ID.get("typescript")?.capability).toBe("semantic");
    expect(LANGUAGE_BY_ID.get("python")?.capability).toBe("structural");
    expect(LANGUAGE_BY_ID.get("protobuf")?.capability).toBe("repository");
    expect(LANGUAGE_BY_ID.get("python")?.parserId).toBe("tree-sitter-python");
    expect(LANGUAGE_BY_ID.get("protobuf")?.parserId).toBeNull();
  });

  it("detects extensions, exact filenames, and extensionless shebang scripts", () => {
    expect(detectLanguage("src/main.py")?.id).toBe("python");
    expect(detectLanguage("native/widget.hpp")?.id).toBe("cpp");
    expect(detectLanguage("Dockerfile")?.id).toBe("dockerfile");
    expect(detectLanguage("tools/run", "#!/usr/bin/env python3")?.id).toBe("python");
    expect(detectLanguage("tools/build", "#!/bin/bash")?.id).toBe("shell");
    expect(detectLanguage("assets/logo.png")).toBeNull();
  });

  it("uses filename and extension ownership before a conflicting shebang", () => {
    expect(detectLanguage("tool.py", "#!/usr/bin/env node")?.id).toBe("python");
    expect(detectLanguage("Makefile", "#!/usr/bin/env python3")?.id).toBe("shell");
  });

  it("applies generated-file conventions per language", () => {
    expect(isGeneratedPath("api/catalog.pb.go", LANGUAGE_BY_ID.get("go")!)).toBe(true);
    expect(isGeneratedPath("vendor/site-packages/pkg/mod.py", LANGUAGE_BY_ID.get("python")!)).toBe(true);
    expect(isGeneratedPath("src/catalog.go", LANGUAGE_BY_ID.get("go")!)).toBe(false);
  });
});
