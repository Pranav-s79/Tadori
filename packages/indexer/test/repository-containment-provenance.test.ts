import path from "node:path";
import { describe, expect, it } from "vitest";
import { indexRepository } from "../src/indexRepository.js";

const MIXED_FIXTURE = path.resolve("packages/bench/fixtures/mixed-oracle");

describe("repository containment provenance", () => {
  it("attributes root package-to-file edges to the repository layer and target language", () => {
    const graph = indexRepository(MIXED_FIXTURE, { kind: "working_tree" }).graph;
    const nodeByKey = new Map(graph.nodes.map((node) => [node.entityKey, node]));
    const rootPackage = graph.nodes.find(
      (node) => node.kind === "package" && node.qualifiedName === "mixed-oracle"
    );
    expect(rootPackage).toBeDefined();

    const containments = graph.edges.filter((edge) =>
      edge.srcEntityKey === rootPackage?.entityKey &&
      edge.relation === "contains" &&
      nodeByKey.get(edge.dstEntityKey)?.kind === "file"
    );
    const targetLanguages = new Set(
      containments.map((edge) => nodeByKey.get(edge.dstEntityKey)?.language)
    );
    expect([...targetLanguages]).toEqual(expect.arrayContaining([
      "c", "java", "markdown", "protobuf", "python", "typescript"
    ]));

    for (const containment of containments) {
      const target = nodeByKey.get(containment.dstEntityKey);
      expect(target?.kind).toBe("file");
      expect(containment.language).toBe(target?.language);
      expect(containment.provenance).toEqual({
        extractorId: "tadori-repository",
        extractorVersion: "1",
        capability: "repository",
        derivation: "repository-derived",
        unresolvedReason: null
      });
    }

    const repositoryExtractor = graph.extractors?.find(
      (extractor) => extractor.id === "tadori-repository" && extractor.version === "1"
    );
    expect(repositoryExtractor).toBeDefined();
    expect(repositoryExtractor?.languages).toEqual(expect.arrayContaining(
      [...targetLanguages].filter((language): language is string => language !== null && language !== undefined)
    ));

    const typescriptExtractor = graph.extractors?.find(
      (extractor) => extractor.id === "tadori-typescript" && extractor.version === "1"
    );
    expect(typescriptExtractor?.capability).toBe("semantic");
  });
});
