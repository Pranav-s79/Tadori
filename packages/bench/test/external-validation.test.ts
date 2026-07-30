import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { captureRepository } from "@tadori/indexer";
import externalManifestJson from "../external-repositories.json" with { type: "json" };
import externalManifestJsonSchema from "../external-repositories.schema.json" with { type: "json" };
import externalReportJsonSchema from "../external-validation-report.schema.json" with { type: "json" };
import {
  assertExternalReportOutput,
  parseExternalValidationArguments,
  writeExternalReportAtomically
} from "../src/cli-external.js";
import {
  EXTERNAL_REPOSITORY_MANIFEST,
  createPinnedCaptureBinding,
  declaredCapabilityCeilingIssues,
  externalRepositoryManifestSchema,
  externalValidationSuiteReportSchema,
  isolatedGitEnvironment,
  portableGraphDigest,
  runExternalValidationSuite,
  validateExternalRepository,
  type ExternalRepositorySpec
} from "../src/externalValidation.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures/mixed-oracle", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli-external.ts", import.meta.url));
const temporaryRoots: string[] = [];

function createSchemaValidator(): Ajv2020 {
  return new Ajv2020({
    allErrors: true,
    strict: true,
    formats: {
      "date-time": (value: string) => value.includes("T") && !Number.isNaN(Date.parse(value)),
      uri: (value: string) => {
        try {
          new URL(value);
          return true;
        } catch {
          return false;
        }
      }
    }
  });
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [
    "-c", "core.autocrlf=false",
    "-c", "core.excludesFile=",
    "-C", root,
    ...args
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function createPinnedFixture(): { root: string; spec: ExternalRepositorySpec } {
  const container = mkdtempSync(path.join(tmpdir(), "tadori-external-validation-"));
  temporaryRoots.push(container);
  const root = path.join(container, "mixed-fixture");
  cpSync(fixtureRoot, root, { recursive: true });
  git(root, ["init"]);
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Tadori Test", "-c", "user.email=tadori@example.invalid", "commit", "-m", "fixture"]);
  const commit = git(root, ["rev-parse", "HEAD"]);
  const url = "https://example.invalid/tadori-fixture.git";
  git(root, ["remote", "add", "origin", url]);
  return {
    root,
    spec: {
      id: "mixed-fixture",
      url,
      commit,
      license: "test-only",
      purpose: "external validation contract test",
      invariants: {
        minimumFiles: 1,
        minimumNodes: 1,
        minimumEdges: 1,
        minimumDistinctLanguages: 2,
        maximumErrorDiagnostics: 2,
        requiredLanguages: ["cpp", "python"],
        requiredCapabilities: [
          { language: "cpp", capability: "structural", minimumAttributedItems: 1 },
          { language: "python", capability: "structural", minimumAttributedItems: 1 }
        ]
      }
    }
  };
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe("external repository validation", () => {
  it("loads a strict, sorted manifest accepted by both runtime and JSON schemas", () => {
    const ajv = createSchemaValidator();
    const validateManifest = ajv.compile(externalManifestJsonSchema);
    expect(validateManifest(externalManifestJson), JSON.stringify(validateManifest.errors)).toBe(true);
    expect(() => ajv.compile(externalReportJsonSchema)).not.toThrow();
    expect(() => externalRepositoryManifestSchema.parse(EXTERNAL_REPOSITORY_MANIFEST)).not.toThrow();
    expect(EXTERNAL_REPOSITORY_MANIFEST.repositories.map((repository) => repository.id)).toEqual([
      "microservices-demo",
      "protobuf"
    ]);

    const invalidManifest = structuredClone(EXTERNAL_REPOSITORY_MANIFEST);
    const firstRepository = invalidManifest.repositories[0];
    if (firstRepository === undefined) throw new Error("external manifest unexpectedly empty");
    firstRepository.id = "Invalid-Repository";
    expect(validateManifest(invalidManifest)).toBe(false);
    expect(() => externalRepositoryManifestSchema.parse(invalidManifest)).toThrow();

    const invalidUrlManifest = structuredClone(EXTERNAL_REPOSITORY_MANIFEST);
    const invalidUrlRepository = invalidUrlManifest.repositories[0];
    if (invalidUrlRepository === undefined) throw new Error("external manifest unexpectedly empty");
    invalidUrlRepository.url = "https://";
    expect(validateManifest(invalidUrlManifest)).toBe(false);
    expect(() => externalRepositoryManifestSchema.parse(invalidUrlManifest)).toThrow();
  });

  it("records deterministic graph, provenance, evidence, and store invariants", () => {
    const { root, spec } = createPinnedFixture();

    const previousIndex = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = path.join(path.dirname(root), "ambient-index-must-not-be-used");
    let report: ReturnType<typeof validateExternalRepository>;
    try {
      report = validateExternalRepository(root, spec);
    } finally {
      if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = previousIndex;
    }

    const failures = report.invariants.filter((invariant) => !invariant.passed);
    expect(failures, JSON.stringify(failures)).toEqual([]);
    expect(report.success).toBe(true);
    expect(report.status).toBe("completed");
    if (report.counts === null) throw new Error("completed report omitted counts");
    expect(report.observedCommit).toBe(spec.commit);
    expect(report.counts.files).toBeGreaterThanOrEqual(spec.invariants.minimumFiles);
    expect(report.languages).toEqual(expect.arrayContaining(spec.invariants.requiredLanguages));
    expect(report.invariants.every((invariant) => invariant.passed)).toBe(true);
    expect(report.invariants.map((invariant) => invariant.id)).toEqual(expect.arrayContaining([
      "deterministic-repeat",
      "maximum-error-diagnostics",
      "declared-capability-ceilings",
      "node-file-membership",
      "one-based-line-spans",
      "one-based-column-spans",
      "honest-compiler-derivation",
      "concrete-cross-language-boundaries",
      "store-endpoint-integrity",
      "store-foreign-key-integrity",
      "pinned-source-binding",
      "pinned-commit-unchanged",
      "source-tree-unchanged"
    ]));

    const suiteReport = externalValidationSuiteReportSchema.parse({
      $schema: "./external-validation-report.schema.json",
      schemaVersion: 1,
      manifestVersion: 1,
      recordedAt: "2026-07-30T00:00:00.000Z",
      validator: { commit: spec.commit, sourceChanges: false },
      success: true,
      repositories: [report]
    });
    const ajv = createSchemaValidator();
    const validateReport = ajv.compile(externalReportJsonSchema);
    expect(validateReport(suiteReport), JSON.stringify(validateReport.errors)).toBe(true);

    const copyContainer = mkdtempSync(path.join(tmpdir(), "tadori-external-validation-copy-"));
    temporaryRoots.push(copyContainer);
    const copyRoot = path.join(copyContainer, "mixed-fixture");
    cpSync(root, copyRoot, { recursive: true });
    const copyReport = validateExternalRepository(copyRoot, spec);
    expect(copyReport.graphDigest).toBe(report.graphDigest);
    expect(copyReport.workspaceHash).toBe(report.workspaceHash);
  }, 120_000);

  it("canonicalizes digest ordering and rejects declared capability overclaims", () => {
    const left = {
      repoRootPath: "C:/first/location",
      values: [{ id: "z", languages: ["python", "cpp"] }, { id: "a", languages: ["go"] }]
    };
    const right = {
      repoRootPath: "/different/location",
      values: [{ id: "a", languages: ["go"] }, { languages: ["cpp", "python"], id: "z" }]
    };
    expect(portableGraphDigest(left)).toBe(portableGraphDigest(right));

    expect(declaredCapabilityCeilingIssues(
      [{ language: "go", provenance: { capability: "semantic" } }],
      [{ id: "overclaim", version: "1", capability: "semantic", languages: ["go"] }]
    )).toEqual([
      "item 0: go semantic exceeds structural",
      "extractor overclaim@1: go semantic exceeds structural"
    ]);
    expect(declaredCapabilityCeilingIssues(
      [{ language: "typescript", provenance: { capability: "semantic" } }],
      [{ id: "tadori-typescript", version: "1", capability: "semantic", languages: ["typescript"] }]
    )).toEqual([]);

    const isolated = isolatedGitEnvironment({
      Path: process.env.Path,
      git_dir: "redirected.git",
      Git_Index_File: "redirected.index",
      git_config_count: "1",
      Git_Config_Key_0: "core.excludesFile",
      GIT_CONFIG_VALUE_0: "redirected.ignore"
    });
    expect(Object.keys(isolated).filter((key) =>
      key.toUpperCase() === "GIT_DIR" ||
      key.toUpperCase() === "GIT_INDEX_FILE" ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key.toUpperCase())
    )).toEqual([]);
  });

  it("rejects a dirty checkout instead of validating unpinned source", () => {
    const { root, spec } = createPinnedFixture();
    writeFileSync(path.join(root, "untracked.txt"), "not part of the pin\n", "utf8");

    expect(() => validateExternalRepository(root, spec)).toThrow(
      /checkout differs[\s\S]*untracked or ignored entry/u
    );
  });

  it("keeps invariant inputs commit-bound and rejects capture mutation after an earlier clean capture", () => {
    const { root, spec } = createPinnedFixture();
    const binding = createPinnedCaptureBinding(root, spec.id, spec.commit);
    const normalizedTarget = "src/python/api.py";
    const target = path.join(root, "src", "python", "api.py");
    const original = readFileSync(target);
    const committedLineCount = binding.lineCounts.get(normalizedTarget);
    const committedSource = binding.sourceFiles.get(normalizedTarget);
    if (committedLineCount === undefined) throw new Error("pinned source line count unexpectedly missing");
    if (committedSource === undefined) throw new Error("pinned source metadata unexpectedly missing");

    expect(committedLineCount).toBeGreaterThan(2);
    expect(committedSource.bytes).toBe(original.length);
    expect(() => binding.assertCapture(captureRepository(root))).not.toThrow();

    writeFileSync(target, "def changed_after_preflight():\n    return True\n", "utf8");
    try {
      const changedCapture = captureRepository(root);
      expect(changedCapture.fileContents.get(normalizedTarget)?.toString("utf8").split("\n")).toHaveLength(3);
      expect(binding.lineCounts.get(normalizedTarget)).toBe(committedLineCount);
      expect(binding.sourceFiles.get(normalizedTarget)).toBe(committedSource);
      expect(() => binding.assertCapture(changedCapture)).toThrow(/captured Buffer differs from immutable blob/u);
    } finally {
      writeFileSync(target, original);
    }

    writeFileSync(target, Buffer.from([0, 1, 2, 3]));
    const omittedCapture = captureRepository(root);
    writeFileSync(target, original);
    expect(() => binding.assertCapture(omittedCapture)).toThrow(/indexed-file membership differs/u);
  });

  it("rejects command-bearing local Git configuration before cleanliness checks", () => {
    const { root, spec } = createPinnedFixture();
    git(root, ["config", "filter.untrusted.process", "definitely-not-an-executable"]);

    expect(() => validateExternalRepository(root, spec)).toThrow(
      /command-bearing or redirecting local Git configuration.*filter\.untrusted\.process/u
    );
  });

  it("rejects ignored files and nonstandard index flags hidden from ordinary status", () => {
    const { root, spec } = createPinnedFixture();
    writeFileSync(path.join(root, ".git", "info", "exclude"), "hidden.py\n", "utf8");
    writeFileSync(path.join(root, "hidden.py"), "def hidden():\n    return True\n", "utf8");

    expect(() => validateExternalRepository(root, spec)).toThrow(/untracked or ignored entry/u);

    rmSync(path.join(root, "hidden.py"));
    git(root, ["update-index", "--skip-worktree", "src/python/api.py"]);
    expect(() => validateExternalRepository(root, spec)).toThrow(/nonstandard index entries/u);
  });

  it("rejects replacement refs and tracked symbolic-link entries", () => {
    const first = createPinnedFixture();
    const tree = git(first.root, ["write-tree"]);
    const replacement = git(first.root, [
      "-c", "user.name=Tadori Test",
      "-c", "user.email=tadori@example.invalid",
      "commit-tree", tree, "-m", "replacement"
    ]);
    git(first.root, ["replace", first.spec.commit, replacement]);
    expect(() => validateExternalRepository(first.root, first.spec)).toThrow(/replacement refs/u);

    const second = createPinnedFixture();
    const payload = path.join(second.root, "link-payload.txt");
    writeFileSync(payload, "outside-target.py\n", "utf8");
    const blob = git(second.root, ["hash-object", "-w", payload]);
    git(second.root, ["update-index", "--add", "--cacheinfo", `120000,${blob},linked.py`]);
    expect(() => validateExternalRepository(second.root, second.spec)).toThrow(/tracked symbolic links/u);
  });

  it("rejects a different commit and origin before indexing", () => {
    const { root, spec } = createPinnedFixture();

    expect(() => validateExternalRepository(root, { ...spec, commit: "0".repeat(40) }))
      .toThrow(/expected commit/u);
    expect(() => validateExternalRepository(root, {
      ...spec,
      url: "https://example.invalid/different.git"
    })).toThrow(/expected origin/u);
  });

  it("records every repository when preflight validation fails", () => {
    const { root, spec } = createPinnedFixture();
    const missingSpec: ExternalRepositorySpec = {
      ...spec,
      id: "z-missing-fixture",
      url: "https://example.invalid/missing-fixture.git"
    };

    const suite = runExternalValidationSuite(path.dirname(root), repositoryRoot, {
      recordedAt: "2026-07-30T00:00:00.000Z",
      repositories: [{ ...spec, commit: "0".repeat(40) }, missingSpec]
    });

    expect(suite.success).toBe(false);
    expect(suite.repositories).toHaveLength(2);
    expect(suite.repositories.map((report) => report.status)).toEqual(["failed", "failed"]);
    expect(suite.repositories[0]?.invariants[0]?.id).toBe("pinned-commit");
    expect(suite.repositories[0]?.observedCommit).toBe(spec.commit);
    expect(suite.repositories[1]?.invariants[0]?.id).toBe("validation-completed");
    const ajv = createSchemaValidator();
    const validateReport = ajv.compile(externalReportJsonSchema);
    expect(validateReport(suite), JSON.stringify(validateReport.errors)).toBe(true);
    expect(() => externalValidationSuiteReportSchema.parse({ ...suite, success: true })).toThrow();
  });

  it("confines report output and replaces it atomically", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tadori-external-output-"));
    temporaryRoots.push(root);
    const checkoutRoot = path.join(root, "checkouts");
    const output = path.join(root, "external-validation-results.json");
    mkdirSync(checkoutRoot);

    expect(parseExternalValidationArguments([
      "--checkout-root", checkoutRoot,
      "--output", output
    ])).toEqual({ checkoutRoot, output });
    expect(() => parseExternalValidationArguments([
      "--checkout-root", checkoutRoot,
      "--checkout-root", checkoutRoot
    ])).toThrow(/only once/u);
    expect(() => assertExternalReportOutput(path.join(root, "package.json"), checkoutRoot))
      .toThrow(/filename/u);
    expect(() => assertExternalReportOutput(
      path.join(checkoutRoot, "external-validation-results.json"),
      checkoutRoot
    )).toThrow(/outside/u);

    assertExternalReportOutput(output, checkoutRoot);
    writeExternalReportAtomically(output, "first\n");
    writeExternalReportAtomically(output, "second\n");
    expect(readFileSync(output, "utf8")).toBe("second\n");
    expect(readdirSync(root).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("runs the CLI entrypoint and reports argument failures on stderr", () => {
    const invocation = spawnSync(process.execPath, ["--import", "tsx", cliPath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });

    expect(invocation.status).toBe(1);
    expect(invocation.stdout).toBe("");
    expect(invocation.stderr).toContain("--checkout-root is required");
    expect(invocation.stderr).toContain("Usage: pnpm external:validate");
  });
});
