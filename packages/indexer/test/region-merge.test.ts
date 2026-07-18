import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SnapshotGraph } from "@tadori/core";
import {
  createProjectServices,
  extractGraph,
  indexRepository,
  mergeSnapshotRegion,
  scanRepository,
  type SnapshotGraphMetadata,
  UnsafeIncrementalMergeError,
  UnsafeRegionExtractionError
} from "@tadori/indexer";

const FIXTURES = path.resolve(__dirname, "../../fixtures");
let workdir: string;

beforeAll(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "tadori-region-merge-"));
});

afterAll(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function copyFixture(name: string, source: string): string {
  const repo = path.join(workdir, name);
  cpSync(path.join(FIXTURES, source), repo, { recursive: true });
  return repo;
}

function replaceText(repo: string, relativePath: string, before: string, after: string): void {
  const absolute = path.join(repo, relativePath);
  const text = readFileSync(absolute, "utf8");
  if (!text.includes(before)) {
    throw new Error(`${relativePath} does not contain ${JSON.stringify(before)}`);
  }
  writeFileSync(absolute, text.replace(before, after), "utf8");
}

function metadataOf(graph: SnapshotGraph): SnapshotGraphMetadata {
  return {
    repoRootPath: graph.repoRootPath,
    kind: graph.kind,
    label: graph.label,
    baseCommitSha: graph.baseCommitSha,
    workspaceHash: graph.workspaceHash,
    analyzerVersion: graph.analyzerVersion
  };
}

function extractRegion(repo: string, seedGraph: SnapshotGraph, files: readonly string[]) {
  const scan = scanRepository(repo);
  const services = createProjectServices(
    repo,
    scan.indexedFiles
      .filter((file) => file.language === "typescript" || file.language === "javascript")
      .map((file) => file.absolutePath)
  );
  return extractGraph(repo, scan, services, { fileRegion: files, seedGraph });
}

function expectRegionalParity(
  repo: string,
  previous: SnapshotGraph,
  invalidatedFiles: readonly string[]
): SnapshotGraph {
  const full = indexRepository(repo, { kind: "working_tree" }).graph;
  const replacement = extractRegion(repo, previous, invalidatedFiles);
  const merged = mergeSnapshotRegion(previous, replacement, {
    invalidatedFiles,
    target: metadataOf(full)
  });
  expect(merged).toEqual(full);
  return merged;
}

describe("regional extraction and graph merge", () => {
  it("matches full extraction after a safe function-body change", () => {
    const repo = copyFixture("body", "01-core-symbols/repo");
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(repo, "src/math.ts", "return String(value);", "return String(value).trim();");

    expectRegionalParity(repo, previous, ["src/math.ts"]);
  });

  it("matches full extraction after an external import change and removes the orphan dependency", () => {
    const repo = path.join(workdir, "import");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "package.json"), '{"name":"import-fixture"}\n', "utf8");
    writeFileSync(
      path.join(repo, "tsconfig.json"),
      '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext"},"include":["src"]}\n',
      "utf8"
    );
    writeFileSync(
      path.join(repo, "src", "main.ts"),
      'import "first-dependency";\nexport function main(): number { return 1; }\n',
      "utf8"
    );
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(repo, "src/main.ts", '"first-dependency"', '"second-dependency"');

    const merged = expectRegionalParity(repo, previous, ["src/main.ts"]);
    expect(merged.nodes.some((node) => node.qualifiedName === "npm:first-dependency")).toBe(false);
    expect(merged.nodes.some((node) => node.qualifiedName === "npm:second-dependency")).toBe(true);
  });

  it("matches full extraction after an Express route identity change", () => {
    const repo = copyFixture("route", "02-express-routes/repo");
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(repo, "src/routes/users.ts", '"/users/:id"', '"/users/:userId"');

    expectRegionalParity(repo, previous, ["src/routes/users.ts"]);
  });

  it("matches full extraction after test linkage evidence changes", () => {
    const repo = copyFixture("test", "02-express-routes/repo");
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(
      repo,
      "tests/user-controller.test.ts",
      "void controller.getUser;",
      "controller.getUser({} as never, {} as never);"
    );

    expectRegionalParity(repo, previous, ["tests/user-controller.test.ts"]);
  });

  it("matches full extraction after ADR links change", () => {
    const repo = copyFixture("adr", "01-core-symbols/repo");
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(repo, "docs/ADR-001-math.md", "`src/math.ts`", "`src/strategy.ts`");
    replaceText(repo, "docs/ADR-001-math.md", "`factorial`", "`DoubleStrategy`");

    expectRegionalParity(repo, previous, ["docs/ADR-001-math.md"]);
  });

  it("matches full extraction after a barrel export changes", () => {
    const repo = copyFixture("barrel", "03-next-routes/repo");
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(
      repo,
      "lib/index.ts",
      'export { createSession, getSession } from "./session-service.js";',
      [
        'export { createSession, getSession } from "./session-service.js";',
        'export { findSession } from "./db.js";'
      ].join("\n")
    );

    expectRegionalParity(repo, previous, ["lib/index.ts"]);
  });

  it("fails closed when declaration identities change", () => {
    const repo = copyFixture("rename", "01-core-symbols/repo");
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(repo, "src/math.ts", "factorial", "renamedFactorial");
    const full = indexRepository(repo, { kind: "working_tree" }).graph;
    const replacement = extractRegion(repo, previous, ["src/math.ts"]);

    expect(() =>
      mergeSnapshotRegion(previous, replacement, {
        invalidatedFiles: ["src/math.ts"],
        target: metadataOf(full)
      })
    ).toThrow(UnsafeIncrementalMergeError);
  });

  it("rejects a changed file omitted from the requested region", () => {
    const repo = copyFixture("under-invalidated", "01-core-symbols/repo");
    const previous = indexRepository(repo, { kind: "commit" }).graph;
    replaceText(repo, "src/math.ts", "return String(value);", "return `${value}`;");

    expect(() => extractRegion(repo, previous, ["src/runner.ts"])).toThrow(
      UnsafeRegionExtractionError
    );
  });
});
