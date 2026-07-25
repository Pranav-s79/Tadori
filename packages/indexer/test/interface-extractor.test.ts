import { createHash } from "node:crypto";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { ExtractionContext } from "../src/extractorContract.js";
import { interfaceExtractor } from "../src/interfaceExtractor.js";
import { LANGUAGE_BY_ID } from "../src/languageRegistry.js";

function contextFor(files: Readonly<Record<string, { language: string; source: string; indexed?: boolean }>>): ExtractionContext {
  const fileContents = new Map<string, Buffer>();
  const indexedFiles: ExtractionContext["capture"]["scan"]["indexedFiles"] = [];
  const supportFiles: ExtractionContext["capture"]["scan"]["supportFiles"] = [];
  for (const [normalizedPath, input] of Object.entries(files)) {
    const registration = LANGUAGE_BY_ID.get(input.language);
    if (registration === undefined) throw new Error(`Missing test registration for ${input.language}`);
    const bytes = Buffer.from(input.source);
    fileContents.set(normalizedPath, bytes);
    const scanned = { absolutePath: path.resolve("C:/fixture", normalizedPath), normalizedPath, indexed: input.indexed !== false, language: input.language, isGenerated: false, registration };
    (input.indexed === false ? supportFiles : indexedFiles).push(scanned);
  }
  return {
    root: "C:/fixture",
    registrations: LANGUAGE_BY_ID,
    capture: {
      scan: { indexedFiles, supportFiles, diagnostics: [] },
      fileContents,
      fileHashes: new Map([...fileContents].map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")])),
      workspaceHash: "0".repeat(64)
    }
  };
}

describe("repository and interface-file extractor", () => {
  test("extracts protobuf packages, messages, services, RPCs, imports, and unresolved protocol types", () => {
    const context = contextFor({
      "proto/common.proto": { language: "protobuf", source: "message Common {}\n" },
      "proto/catalog.proto": { language: "protobuf", source: [
        "syntax = \"proto3\";",
        "package catalog.v1;",
        "import \"common.proto\";",
        "message Request {}",
        "service Catalog {",
        "  rpc Get(Request) returns (Missing);",
        "}", ""
      ].join("\n") }
    });
    const first = interfaceExtractor.extract(context);
    expect(JSON.stringify(interfaceExtractor.extract(context))).toBe(JSON.stringify(first));
    expect(first.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "package", displayName: "catalog.v1", language: "protobuf" }),
      expect.objectContaining({ kind: "type", displayName: "Request" }),
      expect.objectContaining({ kind: "interface", displayName: "Catalog" }),
      expect.objectContaining({ kind: "method", displayName: "Get" }),
      expect.objectContaining({ kind: "unresolved", displayName: "Missing", provenance: expect.objectContaining({ unresolvedReason: "protobuf-rpc-type-not-declared-in-file" }) })
    ]));
    expect(first.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: "imports", resolution: "resolved" }),
      expect.objectContaining({ relation: "references", resolution: "resolved" }),
      expect.objectContaining({ relation: "references", resolution: "unresolved" })
    ]));
  });

  test("models declarations and only evidence-backed file, build, and subprocess relations", () => {
    const result = interfaceExtractor.extract(contextFor({
      "README.md": { language: "markdown", source: "# Design\nSee [schema](config/app.json).\n" },
      "config/app.json": { language: "json", source: "{\"extends\": \"../base.json\"}\n" },
      "base.json": { language: "json", source: "{}\n" },
      "infra/main.tf": { language: "terraform", source: "module \"api\" {\n source = \"../modules/api\"\n}\n" },
      "modules/api/main.tf": { language: "terraform", source: "output \"url\" { value = \"x\" }\n" },
      "Dockerfile": { language: "dockerfile", source: "FROM node:22\nCOPY config/app.json /app/config.json\nRUN npm test\n" },
      "CMakeLists.txt": { language: "cmake", source: "add_executable(app main.cpp)\nexecute_process(COMMAND protoc api.proto)\n" },
      "Makefile": { language: "shell", source: "build: config/app.json\n\tnpm run build\n" },
      "scripts/run.sh": { language: "shell", source: "run() {\n  python app.py\n}\n" }
    }));
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "doc_section", displayName: "Design" }),
      expect.objectContaining({ kind: "type", displayName: "module.api" }),
      expect.objectContaining({ kind: "type", displayName: "app", language: "cmake" }),
      expect.objectContaining({ kind: "type", displayName: "build", language: "shell" }),
      expect.objectContaining({ kind: "function", displayName: "run" })
    ]));
    expect(result.edges.some((edge) => edge.relation === "references" && edge.resolution === "resolved")).toBe(true);
    expect(result.edges.filter((edge) => edge.relation === "calls").length).toBeGreaterThanOrEqual(4);
    expect(result.edges.every((edge) => edge.evidence.length > 0)).toBe(true);
  });

  test("discovers manifest projects and isolates malformed files", () => {
    const result = interfaceExtractor.extract(contextFor({
      "package.json": { language: "json", source: "{\"name\":\"workspace\"}\n", indexed: false },
      "native/CMakeLists.txt": { language: "cmake", source: "add_library(core core.cpp)\n", indexed: false },
      "bad.json": { language: "json", source: "{ nope\n" },
      "docs/README.md": { language: "markdown", source: "# Still indexed\n" }
    }));
    expect(result.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ manifest: "package.json", name: "workspace", kind: "manifest" }),
      expect.objectContaining({ manifest: "native/CMakeLists.txt", root: "native" })
    ]));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "interface-json-invalid", file: "bad.json" }));
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: "doc_section", displayName: "Still indexed" }));
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: "file", file: "bad.json" }));
  });

  test("reports missing captures per file without discarding unaffected files", () => {
    const context = contextFor({
      "missing.yaml": { language: "yaml", source: "key: value\n" },
      "good.toml": { language: "toml", source: "name = \"good\"\n" }
    });
    (context.capture.fileContents as Map<string, Buffer>).delete("missing.yaml");
    const result = interfaceExtractor.extract(context);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "interface-source-missing", file: "missing.yaml" }));
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: "file", file: "good.toml" }));
  });
});
