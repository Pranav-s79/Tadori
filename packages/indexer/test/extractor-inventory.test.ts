import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepository } from "@tadori/indexer";
import { snapshotDiagnostics } from "../src/diagnostics.js";
import { buildSnapshotExtractorInventory } from "../src/extractorInventory.js";

let repo: string | null = null;

afterEach(() => {
  if (repo !== null) rmSync(repo, { recursive: true, force: true });
  repo = null;
});

describe("snapshot extractor inventory", () => {
  it("includes diagnostic-only TypeScript and JavaScript participation", () => {
    repo = mkdtempSync(path.join(tmpdir(), "tadori-diagnostic-inventory-"));
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src", "broken.ts"), "const answer = ;\n");
    writeFileSync(path.join(repo, "src", "broken.js"), "const value = ;\n");

    const graph = indexRepository(repo, { kind: "working_tree" }).graph;
    const diagnostics = graph.diagnostics.filter(
      (diagnostic) => diagnostic.code === "typescript-syntax"
    );
    expect(diagnostics.map((diagnostic) => diagnostic.language).sort()).toEqual([
      "javascript", "typescript"
    ]);
    expect([...graph.nodes, ...graph.edges].filter(
      (item) => item.provenance?.extractorId === "tadori-typescript"
    )).toEqual([]);

    const semantic = graph.extractors?.find(
      (extractor) => extractor.id === "tadori-typescript" && extractor.version === "1"
    );
    expect(semantic).toEqual({
      id: "tadori-typescript",
      version: "1",
      capability: "semantic",
      languages: ["javascript", "typescript"]
    });
    for (const diagnostic of diagnostics) {
      expect(semantic?.languages).toContain(diagnostic.language);
      expect(diagnostic.extractorVersion).toBe(semantic?.version);
    }
  });

  it("keeps explicit file/project participation without retaining language-only seeds", () => {
    const inventory = buildSnapshotExtractorInventory({
      inventories: [[
        {
          id: "tadori-typescript",
          version: "1",
          capability: "semantic",
          languages: ["javascript", "typescript"]
        },
        {
          id: "tadori-interface-files",
          version: "1",
          capability: "repository",
          languages: ["go", "toml"]
        },
        {
          id: "tadori-tree-sitter",
          version: "1",
          capability: "structural",
          languages: ["python"]
        }
      ]],
      files: [
        {
          path: "src/worker.js",
          normalizedPath: "src/worker.js",
          originIdentity: "file|src/worker.js",
          fileKey: "0".repeat(64),
          packageName: null,
          language: "javascript",
          contentHash: "1".repeat(64),
          sizeBytes: 0,
          isGenerated: false,
          isBinary: false
        },
        {
          path: "src/empty.py",
          normalizedPath: "src/empty.py",
          originIdentity: "file|src/empty.py",
          fileKey: "3".repeat(64),
          packageName: null,
          language: "python",
          contentHash: "4".repeat(64),
          sizeBytes: 0,
          isGenerated: false,
          isBinary: false
        }
      ],
      projects: [{
        projectId: "2".repeat(64),
        root: ".",
        manifest: "go.mod",
        kind: "manifest",
        name: null,
        languages: ["go", "toml"]
      }],
      nodes: [],
      edges: [],
      diagnostics: []
    });

    expect(inventory).toEqual([
      {
        id: "tadori-interface-files",
        version: "1",
        capability: "repository",
        languages: ["go", "toml"]
      }, {
        id: "tadori-tree-sitter",
        version: "1",
        capability: "structural",
        languages: ["python"]
      }
    ]);
  });

  it("resolves repository diagnostic identity without a file-backed inventory", () => {
    const diagnostics = snapshotDiagnostics([{
      code: "repository-symbolic-link-skipped",
      message: "Skipped symbolic link src/linked.ts",
      severity: "warning",
      file: null,
      language: "typescript",
      extractorId: "tadori-repository"
    }], [], undefined);
    expect(diagnostics[0]?.extractorVersion).toBe("1");

    const inventory = buildSnapshotExtractorInventory({
      inventories: [],
      files: [],
      projects: [],
      nodes: [{
        kind: "package",
        qualifiedName: "repository",
        displayName: "repository",
        canonicalIdentity: "node|package|repository",
        entityKey: "3".repeat(64),
        file: null,
        exported: false,
        spanStart: null,
        spanEnd: null,
        lineStart: null,
        lineEnd: null,
        signature: null,
        bodyHash: null,
        evidence: [],
        language: null,
        provenance: {
          extractorId: "tadori-repository",
          extractorVersion: "1",
          capability: "repository",
          derivation: "repository-derived",
          unresolvedReason: null
        }
      }],
      edges: [],
      diagnostics
    });
    expect(inventory).toEqual([{
      id: "tadori-repository",
      version: "1",
      capability: "repository",
      languages: ["typescript"]
    }]);
  });
});
