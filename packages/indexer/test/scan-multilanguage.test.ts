import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepository, scanRepository } from "@tadori/indexer";

let root: string | null = null;

afterEach(() => {
  if (root !== null) {
    rmSync(root, { recursive: true, force: true });
    root = null;
  }
});

function repository(): string {
  root = mkdtempSync(path.join(tmpdir(), "tadori-mixed-scan-"));
  return root;
}

function write(relativePath: string, contents: string): void {
  if (root === null) throw new Error("repository was not created");
  const absolutePath = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

describe("mixed-language repository scanning", () => {
  it("indexes registered languages and repository-visible non-TS manifests together", () => {
    repository();
    write("frontend/app.ts", "export const app = true;\n");
    write("api/main.py", "def main():\n    pass\n");
    write("native/main.cpp", "int main() { return 0; }\n");
    write("tools/main.rs", "fn main() {}\n");
    write("proto/catalog.proto", "syntax = \"proto3\";\n");
    write("infra/main.tf", "terraform {}\n");
    write("docs/README.md", "# Architecture\n");
    write("go.mod", "module example.test/catalog\n");
    write("image.png", "not actually an image");

    const scan = scanRepository(root!);
    expect(scan.indexedFiles.map((file) => [file.normalizedPath, file.language])).toEqual([
      ["api/main.py", "python"], ["docs/README.md", "markdown"],
      ["frontend/app.ts", "typescript"], ["go.mod", "toml"],
      ["image.png", "unknown"], ["infra/main.tf", "terraform"],
      ["native/main.cpp", "cpp"], ["proto/catalog.proto", "protobuf"],
      ["tools/main.rs", "rust"]
    ]);
    expect(scan.supportFiles).toEqual([]);
  });

  it("keeps legacy TS configuration support-only while indexing repository config and non-TS manifests", () => {
    repository();
    write("package.json", "{\"name\":\"compat\"}\n");
    write("tsconfig.json", "{\"compilerOptions\":{}}\n");
    write("tadori.rules.json", "{\"boundaries\":[]}\n");
    write(".gitignore", "dist/\n");
    write("requirements.txt", "pytest==8.0.0\n");
    write("native/compile_commands.json", "[]\n");
    write("service/pom.xml", "<project/>\n");
    write("src/index.ts", "export const ready = true;\n");

    const scan = scanRepository(root!);
    expect(scan.indexedFiles.map((file) => [file.normalizedPath, file.language])).toEqual([
      [".gitignore", "repository-config"],
      ["native/compile_commands.json", "json"],
      ["requirements.txt", "unknown"],
      ["service/pom.xml", "unknown"],
      ["src/index.ts", "typescript"]
    ]);
    expect(scan.supportFiles.map((file) => file.normalizedPath)).toEqual([
      "package.json", "tadori.rules.json", "tsconfig.json"
    ]);

    const graph = indexRepository(root!, { kind: "working_tree" }).graph;
    const fileNodes = graph.nodes.filter((node) => node.kind === "file");
    for (const [file, language] of [
      [".gitignore", "repository-config"],
      ["native/compile_commands.json", "json"],
      ["requirements.txt", "unknown"],
      ["service/pom.xml", "unknown"]
    ] as const) {
      expect(fileNodes).toContainEqual(expect.objectContaining({
        file,
        language,
        provenance: expect.objectContaining({
          extractorId: "tadori-repository",
          capability: "repository",
          derivation: "repository-derived"
        })
      }));
    }
  });

  it("detects extensionless scripts by shebang and gives extensions precedence", () => {
    repository();
    write("bin/python-tool", "#!/usr/bin/env python3\nprint('ok')\n");
    write("bin/shell-tool", "#!/bin/bash\necho ok\n");
    write("bin/conflict.py", "#!/usr/bin/env node\nprint('python extension wins')\n");

    const scan = scanRepository(root!);
    expect(scan.indexedFiles.map((file) => [file.normalizedPath, file.language])).toEqual([
      ["bin/conflict.py", "python"], ["bin/python-tool", "python"],
      ["bin/shell-tool", "shell"]
    ]);
  });

  it("marks generated conventions without dropping authored or generated sources", () => {
    repository();
    write("api/catalog.pb.go", "package api\n");
    write("api/catalog.go", "package api\n");
    write("vendor/site-packages/pkg/module.py", "VALUE = 1\n");

    const scan = scanRepository(root!);
    expect(scan.indexedFiles.map((file) => [file.normalizedPath, file.isGenerated])).toEqual([
      ["api/catalog.go", false], ["api/catalog.pb.go", true],
      ["vendor/site-packages/pkg/module.py", true]
    ]);
  });
});
