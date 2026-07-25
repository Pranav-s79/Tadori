import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectServices } from "../src/project.js";
import { extractGraph } from "../src/extract.js";
import { captureRepository } from "../src/indexRepository.js";
import { attributeTypeScriptExtraction } from "../src/typescriptExtractor.js";

const FIXTURE = path.resolve("packages/fixtures/01-core-symbols/repo");

function legacyShape(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item: unknown) =>
      key === "language" || key === "provenance" || key === "extractors" ? undefined : item
    )
  );
}

describe("TypeScript extractor adapter parity", () => {
  it("preserves normalized legacy graph output and every canonical identity", () => {
    const capture = captureRepository(FIXTURE);
    const services = createProjectServices(
      FIXTURE,
      capture.scan.indexedFiles
        .filter((file) => file.language === "typescript" || file.language === "javascript")
        .map((file) => file.absolutePath),
      new Map(
        [...capture.fileContents].map(([relative, bytes]) => [
          path.resolve(FIXTURE, relative),
          bytes.toString("utf8")
        ])
      )
    );
    try {
      const legacy = extractGraph(FIXTURE, capture.scan, services, {
        fileContents: capture.fileContents
      });
      const adapted = attributeTypeScriptExtraction(legacy, capture.scan);
      expect(legacyShape(adapted)).toEqual(legacyShape(legacy));
      expect(adapted.nodes.every((node) => node.provenance !== undefined)).toBe(true);
      expect(adapted.edges.every((edge) => edge.provenance !== undefined)).toBe(true);
    } finally {
      services.languageService.dispose();
    }
  });
});
