import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import externalRepositoriesJson from "../external-repositories.json" with { type: "json" };
import {
  snapshotExtractorSchema,
  type Evidence,
  type ExtractionCapability,
  type SnapshotExtractor
} from "@tadori/core";
import {
  CAPABILITY_BY_LANGUAGE,
  captureRepository,
  declaredPrimaryCapability,
  indexRepository,
  type RepositoryCapture
} from "@tadori/indexer";
import {
  findDanglingEndpoints,
  foreignKeyCheck,
  insertSnapshotGraph,
  loadSnapshotGraph,
  openDatabase,
  runMigrations
} from "@tadori/store";

const hex40 = z.string().regex(/^[0-9a-f]{40}$/u);
const languageId = z.string().regex(/^[a-z][a-z0-9-]*$/u);

const externalInvariantThresholdSchema = z.object({
  minimumFiles: z.number().int().positive(),
  minimumNodes: z.number().int().positive(),
  minimumEdges: z.number().int().positive(),
  minimumDistinctLanguages: z.number().int().positive(),
  maximumErrorDiagnostics: z.number().int().nonnegative(),
  requiredLanguages: z.array(languageId).min(1),
  requiredCapabilities: z.array(z.object({
    language: languageId,
    capability: z.enum(["semantic", "structural", "repository"]),
    minimumAttributedItems: z.number().int().positive()
  }).strict()).min(1)
}).strict().superRefine((invariants, context) => {
  const sortedUnique = [...new Set(invariants.requiredLanguages)].sort();
  if (!isDeepStrictEqual(invariants.requiredLanguages, sortedUnique)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredLanguages"],
      message: "requiredLanguages must be sorted and unique"
    });
  }
  if (invariants.minimumDistinctLanguages < invariants.requiredLanguages.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["minimumDistinctLanguages"],
      message: "minimumDistinctLanguages cannot be smaller than requiredLanguages"
    });
  }
  const capabilityLanguages = invariants.requiredCapabilities.map((requirement) => requirement.language);
  if (!isDeepStrictEqual(capabilityLanguages, [...new Set(capabilityLanguages)].sort())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["requiredCapabilities"],
      message: "requiredCapabilities must be sorted by unique language"
    });
  }
  for (const [index, requirement] of invariants.requiredCapabilities.entries()) {
    if (!invariants.requiredLanguages.includes(requirement.language)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiredCapabilities", index, "language"],
        message: "required capability languages must also be listed in requiredLanguages"
      });
    }
  }
});

export const externalRepositorySpecSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/u),
  url: z.string().url().startsWith("https://"),
  commit: hex40,
  license: z.string().min(1),
  purpose: z.string().min(1),
  invariants: externalInvariantThresholdSchema
}).strict();
export type ExternalRepositorySpec = z.infer<typeof externalRepositorySpecSchema>;

export const externalRepositoryManifestSchema = z.object({
  $schema: z.string().min(1).optional(),
  version: z.literal(1),
  repositories: z.array(externalRepositorySpecSchema).min(1)
}).strict().superRefine((manifest, context) => {
  const ids = manifest.repositories.map((repository) => repository.id);
  if (!isDeepStrictEqual(ids, [...new Set(ids)].sort())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repositories"],
      message: "repository ids must be sorted and unique"
    });
  }
});

export const EXTERNAL_REPOSITORY_MANIFEST = externalRepositoryManifestSchema.parse(
  externalRepositoriesJson
);

export const externalInvariantResultSchema = z.object({
  id: z.string().min(1),
  passed: z.boolean(),
  detail: z.string().min(1)
}).strict();
export type ExternalInvariantResult = z.infer<typeof externalInvariantResultSchema>;

export const externalValidationReportSchema = z.object({
  status: z.enum(["completed", "failed"]),
  repositoryId: z.string().regex(/^[a-z][a-z0-9-]*$/u),
  url: z.string().url(),
  license: z.string().min(1),
  purpose: z.string().min(1),
  expectedCommit: hex40,
  observedCommit: hex40.nullable(),
  success: z.boolean(),
  graphDigest: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  workspaceHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
  analyzerVersion: z.string().min(1).nullable(),
  counts: z.object({
    files: z.number().int().nonnegative(),
    nodes: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    projects: z.number().int().nonnegative(),
    diagnostics: z.number().int().nonnegative(),
    errorDiagnostics: z.number().int().nonnegative()
  }).strict().nullable(),
  languages: z.array(languageId),
  extractors: z.array(snapshotExtractorSchema.strict()),
  error: z.object({
    name: z.string().min(1),
    message: z.string().min(1)
  }).strict().nullable(),
  invariants: z.array(externalInvariantResultSchema).min(1)
}).strict().superRefine((report, context) => {
  const invariantIds = report.invariants.map((invariant) => invariant.id);
  if (new Set(invariantIds).size !== invariantIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["invariants"],
      message: "invariant ids must be unique"
    });
  }
  if (!isDeepStrictEqual(report.languages, [...new Set(report.languages)].sort())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["languages"],
      message: "languages must be sorted and unique"
    });
  }
  const extractorIds = report.extractors.map((extractor) =>
    JSON.stringify([extractor.id, extractor.version])
  );
  if (!isDeepStrictEqual(extractorIds, [...new Set(extractorIds)].sort())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["extractors"],
      message: "extractors must be sorted by unique id and version"
    });
  }
  for (const [index, extractor] of report.extractors.entries()) {
    if (!isDeepStrictEqual(extractor.languages, [...new Set(extractor.languages)].sort())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extractors", index, "languages"],
        message: "extractor languages must be sorted and unique"
      });
    }
  }
  if (report.success !== report.invariants.every((invariant) => invariant.passed)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["success"],
      message: "success must equal the conjunction of repository invariants"
    });
  }
  const completedFieldsPresent = report.observedCommit !== null && report.graphDigest !== null &&
    report.workspaceHash !== null && report.analyzerVersion !== null && report.counts !== null;
  const completedFieldsAbsent = report.graphDigest === null && report.workspaceHash === null &&
    report.analyzerVersion === null && report.counts === null;
  if (report.status === "completed" && (!completedFieldsPresent || report.error !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "completed reports require graph metadata and cannot contain an execution error"
    });
  }
  if (report.status === "failed" && (
    !completedFieldsAbsent || report.error === null || report.success ||
    report.languages.length > 0 || report.extractors.length > 0
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "failed reports require an error and cannot claim completed graph metadata"
    });
  }
});
export type ExternalValidationReport = z.infer<typeof externalValidationReportSchema>;

export const externalValidationSuiteReportSchema = z.object({
  $schema: z.literal("./external-validation-report.schema.json"),
  schemaVersion: z.literal(1),
  manifestVersion: z.literal(1),
  recordedAt: z.string().datetime({ offset: true }),
  validator: z.object({
    commit: hex40,
    sourceChanges: z.boolean()
  }).strict(),
  success: z.boolean(),
  repositories: z.array(externalValidationReportSchema).min(1)
}).strict().superRefine((report, context) => {
  const repositoryIds = report.repositories.map((repository) => repository.repositoryId);
  if (!isDeepStrictEqual(repositoryIds, [...new Set(repositoryIds)].sort())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["repositories"],
      message: "repository reports must be sorted by unique repository id"
    });
  }
  const expectedSuccess = !report.validator.sourceChanges &&
    report.repositories.every((repository) => repository.success);
  if (report.success !== expectedSuccess) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["success"],
      message: "suite success requires a committed validator and successful repository reports"
    });
  }
});
export type ExternalValidationSuiteReport = z.infer<typeof externalValidationSuiteReportSchema>;

interface CheckoutIdentity {
  root: string;
  commit: string;
}

class ExternalValidationInputError extends Error {
  override readonly name = "ExternalValidationInputError";

  constructor(
    readonly invariantId: string,
    message: string,
    readonly observedCommit: string | null = null
  ) {
    super(message);
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value) ?? "undefined";
}

function canonicalizeDigestValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalizeDigestValue(item))
      .sort((left, right) => compareCanonicalText(canonicalJson(left), canonicalJson(right)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCanonicalText(left, right))
        .map(([key, item]) => [key, canonicalizeDigestValue(item)])
    );
  }
  return value;
}

export function portableGraphDigest<T extends { repoRootPath: string }>(graph: T): string {
  return digest(canonicalizeDigestValue({ ...graph, repoRootPath: "." }));
}

const REDIRECTING_GIT_ENVIRONMENT = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE"
]);

export function isolatedGitEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    const normalizedKey = key.toUpperCase();
    if (
      REDIRECTING_GIT_ENVIRONMENT.has(normalizedKey) ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/u.test(normalizedKey)
    ) {
      delete environment[key];
    }
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_ATTR_NOSYSTEM = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_PAGER = "";
  return environment;
}

function runGitRaw(
  root: string,
  args: readonly string[],
  input?: Buffer,
  maxBuffer = 64 * 1024 * 1024
): Buffer {
  const safeRoot = path.resolve(root).split(path.sep).join("/");
  return execFileSync("git", [
    "--no-optional-locks",
    "-c", "core.autocrlf=false",
    "-c", "core.attributesFile=",
    "-c", "core.excludesFile=",
    "-c", "core.fsmonitor=false",
    "-c", "core.hooksPath=",
    "-c", `safe.directory=${safeRoot}`,
    "-C", root,
    ...args
  ], {
    env: isolatedGitEnvironment(),
    input,
    maxBuffer,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function runGit(root: string, args: readonly string[]): string {
  return runGitRaw(root, args).toString("utf8").trim();
}

interface GitTreeEntry {
  mode: string;
  objectId: string;
  stage: string;
  path: string;
}

function parseIndexEntries(raw: Buffer): GitTreeEntry[] {
  return raw.toString("utf8").split("\0").filter((record) => record.length > 0).map((record) => {
    const match = /^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/u.exec(record);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined) {
      throw new Error(`Could not parse Git index entry ${JSON.stringify(record)}`);
    }
    return { mode: match[1], objectId: match[2], stage: match[3], path: match[4] };
  });
}

function parseHeadEntries(raw: Buffer): GitTreeEntry[] {
  return raw.toString("utf8").split("\0").filter((record) => record.length > 0).map((record) => {
    const match = /^(\d{6}) (?:blob|commit) ([0-9a-f]+)\t([\s\S]+)$/u.exec(record);
    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
      throw new Error(`Could not parse Git tree entry ${JSON.stringify(record)}`);
    }
    return { mode: match[1], objectId: match[2], stage: "0", path: match[3] };
  });
}

function localGitConfig(root: string): Array<{ key: string; value: string }> {
  const raw = runGitRaw(root, ["config", "--local", "--no-includes", "--null", "--list"])
    .toString("utf8");
  return raw.split("\0").filter((record) => record.length > 0).map((record) => {
    const separator = record.indexOf("\n");
    return separator < 0
      ? { key: record.toLowerCase(), value: "" }
      : { key: record.slice(0, separator).toLowerCase(), value: record.slice(separator + 1) };
  });
}

function assertSafeLocalGitConfiguration(
  root: string,
  repositoryId: string,
  observedCommit: string | null
): void {
  const commandBearing = localGitConfig(root).filter(({ key, value }) => {
    if (/^include(?:if\..+)?\.path$/u.test(key) || key === "extensions.worktreeconfig") return true;
    if (key === "core.fsmonitor") return value.trim().toLowerCase() !== "false";
    return (
      key === "core.hookspath" ||
      /^filter\..+\.(?:clean|smudge|process)$/u.test(key) ||
      /^diff\..+\.(?:command|textconv)$/u.test(key) ||
      /^merge\..+\.driver$/u.test(key)
    ) && value.trim().length > 0;
  });
  if (commandBearing.length > 0) {
    throw new ExternalValidationInputError(
      "git-config-safety",
      `${repositoryId}: command-bearing or redirecting local Git configuration is forbidden: ` +
        commandBearing.map(({ key }) => key).sort().join(", "),
      observedCommit
    );
  }
}

function pathIsInScope(candidate: string, scopes: readonly string[] | null): boolean {
  return scopes === null || scopes.some(
    (scope) => candidate === scope || candidate.startsWith(`${scope}/`)
  );
}

function pathCanContainScope(candidate: string, scopes: readonly string[] | null): boolean {
  return scopes === null || pathIsInScope(candidate, scopes) || scopes.some(
    (scope) => scope.startsWith(`${candidate}/`)
  );
}

/**
 * Compares HEAD, index, and raw worktree bytes without Git status/diff. This
 * deliberately bypasses attributes and cannot invoke clean/process filters,
 * textconv drivers, hooks, or fsmonitor commands from the target repository.
 */
function checkoutChanges(
  root: string,
  expectedTreeish: string,
  scopes: readonly string[] | null = null
): string[] {
  const changes: string[] = [];
  const indexEntries = parseIndexEntries(runGitRaw(root, ["ls-files", "--stage", "-z"]));
  const headEntries = parseHeadEntries(
    runGitRaw(root, ["ls-tree", "-r", "-z", "--full-tree", expectedTreeish])
  );
  const indexByPath = new Map<string, GitTreeEntry>();
  for (const entry of indexEntries) {
    if (entry.stage !== "0") {
      if (pathIsInScope(entry.path, scopes)) changes.push(`unmerged index entry ${JSON.stringify(entry.path)}`);
      continue;
    }
    indexByPath.set(entry.path, entry);
  }
  const headByPath = new Map(headEntries.map((entry) => [entry.path, entry]));
  const relevantPaths = [...new Set([...headByPath.keys(), ...indexByPath.keys()])]
    .filter((candidate) => pathIsInScope(candidate, scopes))
    .sort(compareCanonicalText);
  for (const candidate of relevantPaths) {
    const head = headByPath.get(candidate);
    const indexed = indexByPath.get(candidate);
    if (
      head === undefined || indexed === undefined ||
      head.mode !== indexed.mode || head.objectId !== indexed.objectId
    ) {
      changes.push(`HEAD/index mismatch ${JSON.stringify(candidate)}`);
    }
  }

  const objectFormat = runGit(root, ["rev-parse", "--show-object-format"]);
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error(`Unsupported Git object format ${JSON.stringify(objectFormat)}`);
  }
  const trackedFiles = new Set<string>();
  const gitlinks = new Set<string>();
  for (const entry of indexByPath.values()) {
    if (entry.mode === "160000") {
      gitlinks.add(entry.path);
      continue;
    }
    trackedFiles.add(entry.path);
    if (!pathIsInScope(entry.path, scopes)) continue;
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      changes.push(`non-regular tracked entry ${JSON.stringify(entry.path)} (${entry.mode})`);
      continue;
    }
    const absolute = path.join(root, ...entry.path.split("/"));
    const stats = lstatSync(absolute, { throwIfNoEntry: false });
    if (stats === undefined || stats.isSymbolicLink() || !stats.isFile()) {
      changes.push(`missing or non-regular worktree file ${JSON.stringify(entry.path)}`);
      continue;
    }
    const contents = readFileSync(absolute);
    const objectId = createHash(objectFormat)
      .update(`blob ${contents.length}\0`)
      .update(contents)
      .digest("hex");
    if (objectId !== entry.objectId) changes.push(`modified worktree file ${JSON.stringify(entry.path)}`);
  }

  const walk = (directory: string, relativeDirectory: string): void => {
    for (const name of readdirSync(directory).sort(compareCanonicalText)) {
      if (relativeDirectory.length === 0 && name === ".git") continue;
      const relative = relativeDirectory.length === 0 ? name : `${relativeDirectory}/${name}`;
      if (!pathCanContainScope(relative, scopes)) continue;
      const absolute = path.join(directory, name);
      const stats = lstatSync(absolute);
      if (gitlinks.has(relative)) {
        if (!stats.isDirectory() || readdirSync(absolute).length > 0) {
          changes.push(`initialized or non-empty submodule ${JSON.stringify(relative)}`);
        }
        continue;
      }
      if (stats.isDirectory()) {
        walk(absolute, relative);
      } else if (!trackedFiles.has(relative) && pathIsInScope(relative, scopes)) {
        changes.push(`untracked or ignored entry ${JSON.stringify(relative)}`);
      }
    }
  };
  walk(root, "");
  return [...new Set(changes)].sort(compareCanonicalText);
}

type GitObjectFormat = "sha1" | "sha256";

interface ImmutableTreeEntry extends GitTreeEntry {
  type: "blob" | "commit";
  size: number | null;
}

interface ImmutableCaptureExpectation {
  objectFormat: GitObjectFormat;
  entriesByPath: ReadonlyMap<string, ImmutableTreeEntry>;
  indexedPaths: readonly string[];
  supportPaths: readonly string[];
  indexedScan: readonly CaptureScanEntryExpectation[];
  supportScan: readonly CaptureScanEntryExpectation[];
  sourceFiles: ReadonlyMap<string, PinnedSourceFileMetadata>;
  lineCounts: ReadonlyMap<string, number>;
  workspaceHash: string;
}

export interface PinnedSourceFileMetadata {
  readonly bytes: number;
  readonly characters: number;
  readonly contentHash: string;
}

export interface PinnedCaptureBinding {
  readonly sourceFiles: ReadonlyMap<string, PinnedSourceFileMetadata>;
  readonly lineCounts: ReadonlyMap<string, number>;
  assertCapture(capture: RepositoryCapture): void;
}

interface CaptureScanEntryExpectation {
  normalizedPath: string;
  indexed: boolean;
  language: string;
  isGenerated: boolean;
  registration: {
    id: string;
    parserId: string | null;
    parserVersion: string | null;
    extractorId: string;
    extractorVersion: string;
    capability: ExtractionCapability;
    queryBundle: string | null;
  };
}

const CAPTURE_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
const CAT_FILE_BATCH_CONTENT_LIMIT_BYTES = 24 * 1024 * 1024;
const CAT_FILE_BATCH_ENTRY_LIMIT = 4096;

function gitBlobObjectId(contents: Buffer, objectFormat: GitObjectFormat): string {
  return createHash(objectFormat)
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest("hex");
}

function capturedLineCount(contents: Buffer): number {
  const text = contents.toString("utf8");
  const lines = text.split(/\r\n|[\r\n]/u);
  return Math.max(1, lines.length - (/\r$|\n$/u.test(text) ? 1 : 0));
}

function captureScanProjection(
  files: RepositoryCapture["scan"]["indexedFiles"] | RepositoryCapture["scan"]["supportFiles"]
): CaptureScanEntryExpectation[] {
  return files.map((file) => ({
    normalizedPath: file.normalizedPath,
    indexed: file.indexed,
    language: file.language,
    isGenerated: file.isGenerated,
    registration: {
      id: file.registration.id,
      parserId: file.registration.parserId,
      parserVersion: file.registration.parserVersion,
      extractorId: file.registration.extractorId,
      extractorVersion: file.registration.extractorVersion,
      capability: file.registration.capability,
      queryBundle: file.registration.queryBundle
    }
  }));
}

function parseImmutableTreeEntries(raw: Buffer): ImmutableTreeEntry[] {
  return raw.toString("utf8").split("\0").filter((record) => record.length > 0).map((record) => {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]+) +(-|\d+)\t([\s\S]+)$/u.exec(record);
    if (
      match?.[1] === undefined || match[2] === undefined || match[3] === undefined ||
      match[4] === undefined || match[5] === undefined
    ) {
      throw new Error(`Could not parse immutable Git tree entry ${JSON.stringify(record)}`);
    }
    const size = match[4] === "-" ? null : Number(match[4]);
    if (size !== null && (!Number.isSafeInteger(size) || size < 0)) {
      throw new Error(`Invalid Git blob size ${JSON.stringify(match[4])}`);
    }
    return {
      mode: match[1],
      type: match[2] as "blob" | "commit",
      objectId: match[3],
      stage: "0",
      size,
      path: match[5]
    };
  });
}

function materializedPath(root: string, normalizedPath: string): string {
  if (!isNormalizedRepositoryPath(normalizedPath)) {
    throw new Error(`Commit tree contains non-canonical path ${JSON.stringify(normalizedPath)}`);
  }
  return path.join(root, ...normalizedPath.split("/"));
}

function writeImmutableBlob(
  root: string,
  entry: ImmutableTreeEntry,
  contents: Buffer,
  objectFormat: GitObjectFormat
): void {
  if (entry.size !== contents.length) {
    throw new Error(
      `Git blob ${entry.objectId} for ${JSON.stringify(entry.path)} has size ${contents.length}, ` +
      `expected ${String(entry.size)}`
    );
  }
  const objectId = gitBlobObjectId(contents, objectFormat);
  if (objectId !== entry.objectId) {
    throw new Error(`Git blob ${entry.objectId} failed object-id verification for ${JSON.stringify(entry.path)}`);
  }
  const destination = materializedPath(root, entry.path);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents, { flag: "wx" });
}

function materializeImmutableBatch(
  repositoryRoot: string,
  materializedRoot: string,
  entries: readonly ImmutableTreeEntry[],
  objectFormat: GitObjectFormat
): void {
  if (entries.length === 0) return;
  const output = runGitRaw(
    repositoryRoot,
    ["cat-file", "--batch"],
    Buffer.from(`${entries.map((entry) => entry.objectId).join("\n")}\n`, "utf8"),
    Math.max(
      64 * 1024 * 1024,
      entries.reduce((total, entry) => total + (entry.size ?? 0) + 128, 1024 * 1024)
    )
  );
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error(`Missing cat-file header for Git blob ${entry.objectId}`);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    const match = /^([0-9a-f]+) blob (\d+)$/u.exec(header);
    if (match?.[1] !== entry.objectId || match[2] === undefined) {
      throw new Error(`Unexpected cat-file header ${JSON.stringify(header)} for Git blob ${entry.objectId}`);
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Invalid cat-file size ${JSON.stringify(match[2])} for Git blob ${entry.objectId}`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error(`Truncated cat-file payload for Git blob ${entry.objectId}`);
    }
    writeImmutableBlob(materializedRoot, entry, output.subarray(contentStart, contentEnd), objectFormat);
    offset = contentEnd + 1;
  }
  if (offset !== output.length) throw new Error("Unexpected trailing bytes from git cat-file --batch");
}

function buildImmutableCaptureExpectation(
  repositoryRoot: string,
  commit: string
): ImmutableCaptureExpectation {
  const objectFormatValue = runGit(repositoryRoot, ["rev-parse", "--show-object-format"]);
  if (objectFormatValue !== "sha1" && objectFormatValue !== "sha256") {
    throw new Error(`Unsupported Git object format ${JSON.stringify(objectFormatValue)}`);
  }
  const objectFormat: GitObjectFormat = objectFormatValue;
  const entries = parseImmutableTreeEntries(
    runGitRaw(repositoryRoot, ["ls-tree", "-r", "-l", "-z", "--full-tree", commit])
  );
  const entriesByPath = new Map<string, ImmutableTreeEntry>();
  const blobs: ImmutableTreeEntry[] = [];
  for (const entry of entries) {
    materializedPath(repositoryRoot, entry.path);
    const expectedObjectIdLength = objectFormat === "sha1" ? 40 : 64;
    if (entry.objectId.length !== expectedObjectIdLength) {
      throw new Error(`Commit tree contains invalid ${objectFormat} object ID ${entry.objectId}`);
    }
    if (entriesByPath.has(entry.path)) {
      throw new Error(`Commit tree contains duplicate path ${JSON.stringify(entry.path)}`);
    }
    entriesByPath.set(entry.path, entry);
    if (entry.mode === "160000" && entry.type === "commit") continue;
    if (
      entry.type !== "blob" || entry.size === null ||
      (entry.mode !== "100644" && entry.mode !== "100755")
    ) {
      throw new Error(
        `Commit tree contains forbidden non-regular entry ${JSON.stringify(entry.path)} (${entry.mode})`
      );
    }
    blobs.push(entry);
  }

  const materializedRoot = mkdtempSync(path.join(tmpdir(), "tadori-pinned-tree-"));
  try {
    let batch: ImmutableTreeEntry[] = [];
    let batchBytes = 0;
    const flush = (): void => {
      materializeImmutableBatch(repositoryRoot, materializedRoot, batch, objectFormat);
      batch = [];
      batchBytes = 0;
    };
    for (const entry of blobs) {
      const size = entry.size as number;
      const scanControlFile = entry.path === ".gitignore" || entry.path === ".tadoriignore";
      if (size > CAPTURE_FILE_SIZE_LIMIT_BYTES && !scanControlFile) {
        flush();
        const destination = materializedPath(materializedRoot, entry.path);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, Buffer.alloc(0), { flag: "wx" });
        truncateSync(destination, size);
        continue;
      }
      if (
        batch.length > 0 &&
        (batch.length >= CAT_FILE_BATCH_ENTRY_LIMIT || batchBytes + size > CAT_FILE_BATCH_CONTENT_LIMIT_BYTES)
      ) flush();
      batch.push(entry);
      batchBytes += size;
    }
    flush();

    const expectedCapture = captureRepository(materializedRoot);
    if (expectedCapture.scan.diagnostics.length > 0) {
      throw new Error("Immutable commit materialization produced omission diagnostics");
    }
    const sourceFiles = new Map(
      [...expectedCapture.fileContents].map(([normalizedPath, contents]) => [
        normalizedPath,
        {
          bytes: contents.length,
          characters: contents.toString("utf8").length,
          contentHash: createHash("sha256").update(contents).digest("hex")
        }
      ] as const)
    );
    const lineCounts = new Map(
      [...expectedCapture.fileContents].map(([normalizedPath, contents]) => [
        normalizedPath,
        capturedLineCount(contents)
      ] as const)
    );
    return {
      objectFormat,
      entriesByPath,
      indexedPaths: expectedCapture.scan.indexedFiles.map((file) => file.normalizedPath),
      supportPaths: expectedCapture.scan.supportFiles.map((file) => file.normalizedPath),
      indexedScan: captureScanProjection(expectedCapture.scan.indexedFiles),
      supportScan: captureScanProjection(expectedCapture.scan.supportFiles),
      sourceFiles,
      lineCounts,
      workspaceHash: expectedCapture.workspaceHash
    };
  } finally {
    rmSync(materializedRoot, { recursive: true, force: true });
  }
}

/** Binds index assertions and source-derived invariants to one immutable commit capture. */
export function createPinnedCaptureBinding(
  repositoryRoot: string,
  repositoryId: string,
  commit: string
): PinnedCaptureBinding {
  let expectation: ImmutableCaptureExpectation;
  try {
    expectation = buildImmutableCaptureExpectation(repositoryRoot, commit);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ExternalValidationInputError(
      "pinned-source-binding",
      `${repositoryId}: could not build immutable commit-tree capture expectation: ${detail}`,
      commit
    );
  }
  const assertCapture = (capture: RepositoryCapture): void => {
    const fail = (detail: string): never => {
      throw new ExternalValidationInputError(
        "pinned-source-binding",
        `${repositoryId}: exact index capture is not bound to commit ${commit}: ${detail}`,
        commit
      );
    };
    if (capture.scan.diagnostics.length > 0) {
      fail(`capture contains omission diagnostics: ${capture.scan.diagnostics
        .map((diagnostic) => `${diagnostic.code}:${diagnostic.normalizedPath}`)
        .sort(compareCanonicalText)
        .join(", ")}`);
    }
    const indexedPaths = capture.scan.indexedFiles.map((file) => file.normalizedPath);
    const supportPaths = capture.scan.supportFiles.map((file) => file.normalizedPath);
    if (!isDeepStrictEqual(indexedPaths, expectation.indexedPaths)) {
      fail("indexed-file membership differs from the immutable commit tree");
    }
    if (!isDeepStrictEqual(supportPaths, expectation.supportPaths)) {
      fail("support-file membership differs from the immutable commit tree");
    }
    if (!isDeepStrictEqual(captureScanProjection(capture.scan.indexedFiles), expectation.indexedScan)) {
      fail("indexed-file scan metadata differs from the immutable commit tree");
    }
    if (!isDeepStrictEqual(captureScanProjection(capture.scan.supportFiles), expectation.supportScan)) {
      fail("support-file scan metadata differs from the immutable commit tree");
    }
    const expectedCapturedPaths = [...expectation.indexedPaths, ...expectation.supportPaths]
      .sort(compareCanonicalText);
    const capturedPaths = [...capture.fileContents.keys()].sort(compareCanonicalText);
    if (!isDeepStrictEqual(capturedPaths, expectedCapturedPaths)) {
      fail("captured Buffer membership differs from indexed/support membership");
    }
    for (const normalizedPath of expectedCapturedPaths) {
      const entry = expectation.entriesByPath.get(normalizedPath) ??
        fail(`missing immutable tree entry for ${JSON.stringify(normalizedPath)}`);
      const contents = capture.fileContents.get(normalizedPath) ??
        fail(`missing captured Buffer for ${JSON.stringify(normalizedPath)}`);
      if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
        fail(`missing regular immutable tree blob for ${JSON.stringify(normalizedPath)}`);
      }
      const objectId = gitBlobObjectId(contents, expectation.objectFormat);
      if (objectId !== entry.objectId) {
        fail(`captured Buffer differs from immutable blob for ${JSON.stringify(normalizedPath)}`);
      }
      const contentHash = createHash("sha256").update(contents).digest("hex");
      if (capture.fileHashes.get(normalizedPath) !== contentHash) {
        fail(`capture content hash differs from its Buffer for ${JSON.stringify(normalizedPath)}`);
      }
    }
    if (capture.workspaceHash !== expectation.workspaceHash) {
      fail("workspace hash differs from the immutable commit-tree capture");
    }
  };
  return {
    assertCapture,
    sourceFiles: expectation.sourceFiles,
    lineCounts: expectation.lineCounts
  };
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function canonicalRemoteUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "").replace(/\.git$/u, "");
}

function inspectCheckout(root: string, spec: ExternalRepositorySpec): CheckoutIdentity {
  const resolvedRoot = realpathSync.native(path.resolve(root));
  const gitRoot = realpathSync.native(runGit(resolvedRoot, ["rev-parse", "--show-toplevel"]));
  if (!samePath(resolvedRoot, gitRoot)) {
    throw new ExternalValidationInputError(
      "checkout-root",
      `${spec.id}: checkout root must be the Git worktree root (${gitRoot})`
    );
  }

  const observedCommit = runGit(resolvedRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  assertSafeLocalGitConfiguration(resolvedRoot, spec.id, observedCommit);
  const replacementRefs = runGit(resolvedRoot, ["for-each-ref", "--format=%(refname)", "refs/replace"]);
  if (replacementRefs.length > 0) {
    throw new ExternalValidationInputError(
      "replacement-refs",
      `${spec.id}: replacement refs are forbidden in an exact-pinned checkout: ${replacementRefs}`,
      observedCommit
    );
  }
  if (observedCommit !== spec.commit) {
    throw new ExternalValidationInputError(
      "pinned-commit",
      `${spec.id}: expected commit ${spec.commit}, observed ${observedCommit}`,
      observedCommit
    );
  }

  let origin: string;
  try {
    origin = runGit(resolvedRoot, [
      "config", "--local", "--no-includes", "--get", "remote.origin.url"
    ]);
  } catch {
    throw new ExternalValidationInputError(
      "origin-url",
      `${spec.id}: checkout has no repository-local origin URL`,
      observedCommit
    );
  }
  if (canonicalRemoteUrl(origin) !== canonicalRemoteUrl(spec.url)) {
    throw new ExternalValidationInputError(
      "origin-url",
      `${spec.id}: expected origin ${spec.url}, observed ${origin}`,
      observedCommit
    );
  }

  const indexFlags = runGit(resolvedRoot, ["ls-files", "-v"])
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith("H "));
  if (indexFlags.length > 0) {
    throw new ExternalValidationInputError(
      "complete-git-checkout",
      `${spec.id}: checkout has sparse, skip-worktree, assume-unchanged, or nonstandard index entries`,
      observedCommit
    );
  }

  const trackedSymlinks = parseIndexEntries(
    runGitRaw(resolvedRoot, ["ls-files", "--stage", "-z"])
  ).filter((entry) => entry.mode === "120000");
  if (trackedSymlinks.length > 0) {
    throw new ExternalValidationInputError(
      "regular-file-checkout",
      `${spec.id}: tracked symbolic links are excluded from pinned validation: ${trackedSymlinks
        .slice(0, 5)
        .map((entry) => entry.path)
        .join(", ")}`,
      observedCommit
    );
  }

  const changes = checkoutChanges(resolvedRoot, spec.commit);
  if (changes.length > 0) {
    throw new ExternalValidationInputError(
      "clean-checkout",
      `${spec.id}: checkout differs from the pinned HEAD without invoking repository filters:\n` +
        changes.slice(0, 20).join("\n"),
      observedCommit
    );
  }
  const commitAfterInspection = runGit(
    resolvedRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"]
  );
  if (commitAfterInspection !== observedCommit || commitAfterInspection !== spec.commit) {
    throw new ExternalValidationInputError(
      "pinned-commit-unchanged",
      `${spec.id}: checkout commit changed during preflight from ${observedCommit} ` +
        `to ${commitAfterInspection}`,
      commitAfterInspection
    );
  }
  return { root: resolvedRoot, commit: observedCommit };
}

function duplicateCount(values: readonly string[]): number {
  return values.length - new Set(values).size;
}

function capabilityRank(capability: "semantic" | "structural" | "repository"): number {
  switch (capability) {
    case "repository": return 0;
    case "structural": return 1;
    case "semantic": return 2;
  }
}

interface CapabilityContribution {
  language?: string | null;
  provenance?: { capability: ExtractionCapability };
}

function declaredCapability(language: string): ExtractionCapability | undefined {
  const declaration = CAPABILITY_BY_LANGUAGE.get(language);
  if (declaration === undefined) return undefined;
  const capability = declaredPrimaryCapability(declaration);
  return capability === "repository-only" ? "repository" : capability;
}

export function declaredCapabilityCeilingIssues(
  items: readonly CapabilityContribution[],
  extractors: readonly SnapshotExtractor[]
): string[] {
  const issues: string[] = [];
  for (const [index, item] of items.entries()) {
    if (item.language === null || item.language === undefined || item.provenance === undefined) continue;
    const ceiling = declaredCapability(item.language);
    if (ceiling === undefined) {
      issues.push(`item ${index}: undeclared language ${item.language}`);
    } else if (capabilityRank(item.provenance.capability) > capabilityRank(ceiling)) {
      issues.push(`item ${index}: ${item.language} ${item.provenance.capability} exceeds ${ceiling}`);
    }
  }
  for (const extractor of extractors) {
    for (const language of extractor.languages) {
      const ceiling = declaredCapability(language);
      if (ceiling === undefined) {
        issues.push(`extractor ${extractor.id}@${extractor.version}: undeclared language ${language}`);
      } else if (capabilityRank(extractor.capability) > capabilityRank(ceiling)) {
        issues.push(
          `extractor ${extractor.id}@${extractor.version}: ${language} ` +
          `${extractor.capability} exceeds ${ceiling}`
        );
      }
    }
  }
  return issues;
}

function isNormalizedRepositoryPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !path.posix.isAbsolute(value) &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** Runs source-only invariants over one clean, exact-pinned Git checkout. */
export function validateExternalRepository(
  root: string,
  specInput: ExternalRepositorySpec
): ExternalValidationReport {
  const spec = externalRepositorySpecSchema.parse(specInput);
  const checkout = inspectCheckout(root, spec);
  const captureBinding = createPinnedCaptureBinding(checkout.root, spec.id, checkout.commit);
  const snapshotInput = {
    kind: "commit" as const,
    baseCommitSha: checkout.commit,
    assertCapture: captureBinding.assertCapture
  };
  const firstResult = indexRepository(checkout.root, snapshotInput);
  const secondResult = indexRepository(checkout.root, snapshotInput);
  const first = firstResult.graph;
  const second = secondResult.graph;
  const filePaths = new Set(first.files.map((file) => file.normalizedPath));
  const languageByFile = new Map(first.files.map((file) => [file.normalizedPath, file.language]));
  const fileKeys = first.files.map((file) => file.fileKey);
  const nodeKeys = new Set(first.nodes.map((node) => node.entityKey));
  const languages = [...new Set(
    first.files.flatMap((file) => file.language === null ? [] : [file.language])
  )].sort();
  const extractors = (first.extractors ?? []).map((extractor) => ({
    ...extractor,
    languages: [...extractor.languages].sort()
  })).sort((left, right) =>
    JSON.stringify([left.id, left.version]).localeCompare(JSON.stringify([right.id, right.version]))
  );
  const extractorKey = (id: string, version: string): string => JSON.stringify([id, version]);
  const extractorByKey = new Map(
    extractors.map((extractor) => [extractorKey(extractor.id, extractor.version), extractor])
  );
  const evidenceFiles = [
    ...first.nodes.flatMap((node) => node.evidence.map((evidence) => evidence.file)),
    ...first.edges.flatMap((edge) => edge.evidence.map((evidence) => evidence.file))
  ];
  const errorDiagnostics = first.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;

  const invariants: ExternalInvariantResult[] = [];
  const record = (id: string, passed: boolean, detail: string): void => {
    invariants.push(externalInvariantResultSchema.parse({ id, passed, detail }));
  };
  record("pinned-commit", checkout.commit === spec.commit, `${checkout.commit} == ${spec.commit}`);
  record("deterministic-repeat", isDeepStrictEqual(first, second), portableGraphDigest(first));
  record("minimum-files", first.files.length >= spec.invariants.minimumFiles,
    `${first.files.length} >= ${spec.invariants.minimumFiles}`);
  record("minimum-nodes", first.nodes.length >= spec.invariants.minimumNodes,
    `${first.nodes.length} >= ${spec.invariants.minimumNodes}`);
  record("minimum-edges", first.edges.length >= spec.invariants.minimumEdges,
    `${first.edges.length} >= ${spec.invariants.minimumEdges}`);
  record("maximum-error-diagnostics", errorDiagnostics <= spec.invariants.maximumErrorDiagnostics,
    `${errorDiagnostics} <= ${spec.invariants.maximumErrorDiagnostics}`);
  record("mixed-language", languages.length >= spec.invariants.minimumDistinctLanguages,
    `${languages.length} >= ${spec.invariants.minimumDistinctLanguages}: ${languages.join(", ")}`);
  const missingLanguages = spec.invariants.requiredLanguages.filter(
    (language) => !languages.includes(language)
  );
  record("required-languages", missingLanguages.length === 0,
    missingLanguages.length === 0 ? "all present" : `missing ${missingLanguages.join(", ")}`);
  const capabilityFailures = spec.invariants.requiredCapabilities.flatMap((requirement) => {
    const inventory = extractors.find((extractor) =>
      extractor.languages.includes(requirement.language) &&
      capabilityRank(extractor.capability) >= capabilityRank(requirement.capability)
    );
    const attributedItems = [...first.nodes, ...first.edges].filter((item) =>
      item.language === requirement.language && item.provenance !== undefined &&
      capabilityRank(item.provenance.capability) >= capabilityRank(requirement.capability)
    ).length;
    return inventory === undefined || attributedItems < requirement.minimumAttributedItems
      ? [`${requirement.language}:${requirement.capability} ` +
        `inventory=${String(inventory !== undefined)} items=${attributedItems}/` +
        `${requirement.minimumAttributedItems}`]
      : [];
  });
  record("required-capabilities", capabilityFailures.length === 0,
    capabilityFailures.length === 0 ? "all capability floors satisfied" : capabilityFailures.join("; "));
  const capabilityCeilingFailures = declaredCapabilityCeilingIssues(
    [...first.nodes, ...first.edges],
    extractors
  );
  record("declared-capability-ceilings", capabilityCeilingFailures.length === 0,
    capabilityCeilingFailures.length === 0
      ? "all attributed and inventory capabilities are within the declared matrix"
      : capabilityCeilingFailures.slice(0, 10).join("; "));
  record("unique-file-paths", filePaths.size === first.files.length,
    `${filePaths.size}/${first.files.length} unique normalized paths`);
  const scannedIndexedPaths = firstResult.scan.indexedFiles.map((file) => file.normalizedPath).sort();
  const graphPaths = first.files.map((file) => file.normalizedPath).sort();
  record("scan-graph-membership", isDeepStrictEqual(scannedIndexedPaths, graphPaths),
    `${graphPaths.length}/${scannedIndexedPaths.length} indexed scan files materialized in graph`);
  const invalidRepositoryPaths = first.files.filter(
    (file) => !isNormalizedRepositoryPath(file.normalizedPath)
  );
  record("normalized-file-paths", invalidRepositoryPaths.length === 0,
    `${invalidRepositoryPaths.length} invalid repository-relative path(s)`);
  record("unique-file-keys", duplicateCount(fileKeys) === 0,
    `${duplicateCount(fileKeys)} duplicate file key(s)`);
  const nodeIdentityDuplicates = duplicateCount(first.nodes.map((node) => node.canonicalIdentity));
  const nodeKeyDuplicates = duplicateCount(first.nodes.map((node) => node.entityKey));
  record("unique-nodes", nodeIdentityDuplicates === 0 && nodeKeyDuplicates === 0,
    `${nodeIdentityDuplicates} duplicate canonical identity(ies), ${nodeKeyDuplicates} duplicate key(s)`);
  const edgeIdentityDuplicates = duplicateCount(first.edges.map((edge) => edge.canonicalIdentity));
  const edgeKeyDuplicates = duplicateCount(first.edges.map((edge) => edge.entityKey));
  record("unique-edges", edgeIdentityDuplicates === 0 && edgeKeyDuplicates === 0,
    `${edgeIdentityDuplicates} duplicate canonical identity(ies), ${edgeKeyDuplicates} duplicate key(s)`);
  const dangling = first.edges.filter(
    (edge) => !nodeKeys.has(edge.srcEntityKey) || !nodeKeys.has(edge.dstEntityKey)
  );
  record("endpoint-membership", dangling.length === 0, `${dangling.length} dangling endpoint(s)`);
  const missingEvidence = evidenceFiles.filter((file) => !filePaths.has(file));
  record("evidence-membership", missingEvidence.length === 0,
    `${missingEvidence.length} evidence reference(s) outside snapshot files`);
  const missingNodeFiles = first.nodes.filter(
    (node) => node.file !== null && !filePaths.has(node.file)
  );
  record("node-file-membership", missingNodeFiles.length === 0,
    `${missingNodeFiles.length} node file reference(s) outside snapshot files`);
  const missingDiagnosticFiles = first.diagnostics.filter(
    (diagnostic) => diagnostic.file !== null && !filePaths.has(diagnostic.file)
  );
  record("diagnostic-membership", missingDiagnosticFiles.length === 0,
    `${missingDiagnosticFiles.length} diagnostic file reference(s) outside snapshot files`);
  record("unique-extractors", extractorByKey.size === extractors.length,
    `${extractors.length - extractorByKey.size} duplicate extractor identity(ies)`);
  let missingExtractorIdentities = 0;
  let overclaimedExtractorCapabilities = 0;
  let mismatchedExtractorLanguages = 0;
  for (const item of [...first.nodes, ...first.edges]) {
    if (item.provenance === undefined) continue;
    const extractor = extractorByKey.get(extractorKey(
      item.provenance.extractorId,
      item.provenance.extractorVersion
    ));
    if (extractor === undefined) {
      missingExtractorIdentities += 1;
      continue;
    }
    if (capabilityRank(item.provenance.capability) > capabilityRank(extractor.capability)) {
      overclaimedExtractorCapabilities += 1;
    }
    if (item.language !== null && item.language !== undefined &&
      !extractor.languages.includes(item.language)) mismatchedExtractorLanguages += 1;
  }
  for (const diagnostic of first.diagnostics) {
    const extractor = extractorByKey.get(extractorKey(
      diagnostic.extractorId,
      diagnostic.extractorVersion
    ));
    if (extractor === undefined) {
      missingExtractorIdentities += 1;
    } else if (diagnostic.language !== null && !extractor.languages.includes(diagnostic.language)) {
      mismatchedExtractorLanguages += 1;
    }
  }
  const extractorInventoryIssues = missingExtractorIdentities + overclaimedExtractorCapabilities +
    mismatchedExtractorLanguages;
  record("extractor-inventory", extractorInventoryIssues === 0,
    `${missingExtractorIdentities} missing identity(ies), ` +
    `${overclaimedExtractorCapabilities} capability overclaim(s), ` +
    `${mismatchedExtractorLanguages} language mismatch(es)`);

  let fileContentMismatches = 0;
  const fileExtents = new Map<string, { bytes: number; characters: number }>();
  for (const file of first.files) {
    if (!isNormalizedRepositoryPath(file.normalizedPath)) {
      fileContentMismatches += 1;
      continue;
    }
    const source = captureBinding.sourceFiles.get(file.normalizedPath);
    if (source === undefined) {
      fileContentMismatches += 1;
      continue;
    }
    fileExtents.set(file.normalizedPath, {
      bytes: source.bytes,
      characters: source.characters
    });
    if (source.bytes !== file.sizeBytes || source.contentHash !== file.contentHash) fileContentMismatches += 1;
  }
  record("file-content-membership", fileContentMismatches === 0,
    `${fileContentMismatches} file size/hash mismatch(es)`);

  const linesFor = (file: string): number | undefined => {
    if (!filePaths.has(file) || !isNormalizedRepositoryPath(file)) return undefined;
    return captureBinding.lineCounts.get(file);
  };
  let invalidLineSpans = 0;
  let invalidEvidenceColumns = 0;
  let invalidNodeSpans = 0;
  const inspectEvidenceSpan = (evidence: Evidence): void => {
    const count = linesFor(evidence.file);
    if (count === undefined || evidence.lineStart < 1 ||
      evidence.lineEnd < evidence.lineStart || evidence.lineEnd > count) invalidLineSpans += 1;
    const hasColumnStart = evidence.columnStart !== undefined;
    const hasColumnEnd = evidence.columnEnd !== undefined;
    if (hasColumnStart !== hasColumnEnd ||
      (evidence.columnStart !== undefined && evidence.columnStart < 1) ||
      (evidence.columnEnd !== undefined && evidence.columnEnd < 1) ||
      (evidence.lineStart === evidence.lineEnd && evidence.columnStart !== undefined &&
        evidence.columnEnd !== undefined && evidence.columnEnd < evidence.columnStart)) {
      invalidEvidenceColumns += 1;
    }
  };
  for (const node of first.nodes) {
    const hasSpanStart = node.spanStart !== null;
    const hasSpanEnd = node.spanEnd !== null;
    const hasLineStart = node.lineStart !== null;
    const hasLineEnd = node.lineEnd !== null;
    if (hasSpanStart !== hasSpanEnd || hasLineStart !== hasLineEnd) invalidNodeSpans += 1;
    if (node.file === null && (hasSpanStart || hasSpanEnd || hasLineStart || hasLineEnd)) {
      invalidNodeSpans += 1;
    }
    if (node.file !== null && node.spanStart !== null && node.spanEnd !== null) {
      const extent = fileExtents.get(node.file);
      const maximum = extent === undefined ? -1 : Math.max(extent.bytes, extent.characters);
      if (node.spanStart < 0 || node.spanEnd < node.spanStart || node.spanEnd > maximum) {
        invalidNodeSpans += 1;
      }
    }
    if (node.file !== null && node.lineStart !== null && node.lineEnd !== null) {
      const count = linesFor(node.file);
      if (count === undefined || node.lineStart < 1 || node.lineEnd < node.lineStart || node.lineEnd > count) {
        invalidLineSpans += 1;
      }
    }
    for (const evidence of node.evidence) {
      inspectEvidenceSpan(evidence);
    }
  }
  record("node-span-integrity", invalidNodeSpans === 0, `${invalidNodeSpans} invalid node span(s)`);
  for (const edge of first.edges) {
    for (const evidence of edge.evidence) {
      inspectEvidenceSpan(evidence);
    }
  }
  const mismatchedEvidenceCommits = [...first.nodes, ...first.edges].flatMap((item) => item.evidence)
    .filter((evidence) => evidence.commitSha !== undefined && evidence.commitSha !== checkout.commit);
  record("evidence-commit", mismatchedEvidenceCommits.length === 0,
    `${mismatchedEvidenceCommits.length} evidence commit mismatch(es)`);
  for (const diagnostic of first.diagnostics) {
    if (diagnostic.file !== null && diagnostic.lineStart !== null && diagnostic.lineEnd !== null) {
      const count = linesFor(diagnostic.file);
      if (count === undefined || diagnostic.lineStart < 1 ||
        diagnostic.lineEnd < diagnostic.lineStart || diagnostic.lineEnd > count) invalidLineSpans += 1;
    }
  }
  record("one-based-line-spans", invalidLineSpans === 0, `${invalidLineSpans} invalid line span(s)`);
  record("one-based-column-spans", invalidEvidenceColumns === 0,
    `${invalidEvidenceColumns} invalid evidence column span(s)`);

  const attributedItems = [...first.nodes, ...first.edges];
  const missingProvenance = attributedItems.filter((item) => item.provenance === undefined);
  record("complete-item-provenance", missingProvenance.length === 0,
    `${missingProvenance.length} node/edge item(s) without provenance`);
  const unresolvedWithoutReason = [
    ...first.nodes.filter((node) =>
      node.kind === "unresolved" &&
      (node.provenance?.unresolvedReason === null || node.provenance?.unresolvedReason === undefined)
    ),
    ...first.edges.filter((edge) =>
      edge.resolution === "unresolved" &&
      (edge.provenance?.unresolvedReason === null || edge.provenance?.unresolvedReason === undefined)
    )
  ];
  record("explicit-unresolved-reasons", unresolvedWithoutReason.length === 0,
    `${unresolvedWithoutReason.length} unresolved item(s) without a reason`);

  const nodeByKey = new Map(first.nodes.map((node) => [node.entityKey, node]));
  const compilerClaimsOutsideSemanticAdapter = attributedItems.filter((item) =>
    item.provenance?.derivation === "compiler-resolved" &&
    (item.provenance.extractorId !== "tadori-typescript" ||
      (item.language !== "typescript" && item.language !== "javascript" && !(
        (item.language === null || item.language === undefined) && item.evidence.length > 0 &&
        item.evidence.every((evidence) => {
          const language = languageByFile.get(evidence.file);
          return language === "typescript" || language === "javascript";
        })
      )))
  );
  record("honest-compiler-derivation", compilerClaimsOutsideSemanticAdapter.length === 0,
    `${compilerClaimsOutsideSemanticAdapter.length} compiler claim(s) outside TypeScript/JavaScript` +
    (compilerClaimsOutsideSemanticAdapter.length === 0 ? "" : `: ${compilerClaimsOutsideSemanticAdapter.slice(0, 3)
      .map((item) => {
        const target = "dstEntityKey" in item ? nodeByKey.get(item.dstEntityKey) : undefined;
        return `${item.provenance?.extractorId}/${String(item.language)}/${String(target?.language)}/` +
          `${String(target?.file)}/${item.canonicalIdentity}`;
      })
      .join("; ")}`));
  const configurationLanguages = new Set([
    "cmake", "dockerfile", "json", "make", "protobuf", "shell", "terraform", "toml", "yaml"
  ]);
  const unsupportedCrossLanguageEdges = first.edges.filter((edge) => {
    const sourceLanguage = nodeByKey.get(edge.srcEntityKey)?.language;
    const targetLanguage = nodeByKey.get(edge.dstEntityKey)?.language;
    if (sourceLanguage === null || sourceLanguage === undefined ||
      targetLanguage === null || targetLanguage === undefined || sourceLanguage === targetLanguage) return false;
    const semanticTypeScriptJavaScriptBoundary =
      (sourceLanguage === "typescript" || sourceLanguage === "javascript") &&
      (targetLanguage === "typescript" || targetLanguage === "javascript") &&
      edge.provenance?.extractorId === "tadori-typescript" &&
      edge.provenance.derivation === "compiler-resolved";
    const explicitRepositoryBoundary =
      edge.provenance?.extractorId === "tadori-cross-language-boundaries";
    const explicitInterfaceBoundary =
      edge.provenance?.extractorId === "tadori-interface-files" &&
      edge.provenance.derivation === "repository-derived" &&
      configurationLanguages.has(sourceLanguage);
    return edge.resolution !== "resolved" || edge.evidence.length === 0 ||
      (!semanticTypeScriptJavaScriptBoundary && !explicitRepositoryBoundary && !explicitInterfaceBoundary);
  });
  record("concrete-cross-language-boundaries", unsupportedCrossLanguageEdges.length === 0,
    `${unsupportedCrossLanguageEdges.length} cross-language edge(s) without a concrete boundary extractor` +
    (unsupportedCrossLanguageEdges.length === 0 ? "" : `: ${unsupportedCrossLanguageEdges.slice(0, 3)
      .map((edge) => `${edge.provenance?.extractorId}/${edge.provenance?.derivation}/${edge.canonicalIdentity}`)
      .join("; ")}`));

  const db = openDatabase(":memory:");
  try {
    runMigrations(db);
    const inserted = insertSnapshotGraph(db, first);
    const reused = insertSnapshotGraph(db, first);
    const stored = loadSnapshotGraph(db, inserted.snapshotId);
    const storedDangling = findDanglingEndpoints(db, inserted.snapshotId);
    const foreignKeys = foreignKeyCheck(db);
    const storedRepository = db.prepare("SELECT root_path FROM repositories WHERE id = ?")
      .get(inserted.repoId) as { root_path: string } | undefined;
    record("store-endpoint-integrity", storedDangling.length === 0,
      `${storedDangling.length} stored dangling endpoint(s)`);
    record("store-foreign-key-integrity", foreignKeys.length === 0,
      `${foreignKeys.length} foreign-key violation(s)`);
    record("store-immutable-reuse", reused.reused && reused.snapshotId === inserted.snapshotId,
      `first=${inserted.snapshotId}, second=${reused.snapshotId}, reused=${String(reused.reused)}`);
    const byFileKey = <T extends { fileKey: string }>(values: readonly T[]): T[] =>
      [...values].sort((left, right) => left.fileKey.localeCompare(right.fileKey));
    const byEntityKey = <T extends { entityKey: string }>(values: readonly T[]): T[] =>
      [...values].sort((left, right) => left.entityKey.localeCompare(right.entityKey));
    const componentMatches = {
      repoRootPath: storedRepository?.root_path === first.repoRootPath,
      kind: stored.snapshot.kind === first.kind,
      label: stored.snapshot.label === first.label,
      baseCommitSha: stored.snapshot.base_commit_sha === first.baseCommitSha,
      workspaceHash: stored.snapshot.workspace_hash === first.workspaceHash,
      analyzerVersion: stored.analyzerVersion === first.analyzerVersion,
      files: isDeepStrictEqual(byFileKey(stored.files), byFileKey(first.files)),
      nodes: isDeepStrictEqual(byEntityKey(stored.nodes), byEntityKey(first.nodes)),
      edges: isDeepStrictEqual(byEntityKey(stored.edges), byEntityKey(first.edges)),
      projects: isDeepStrictEqual(stored.projects, first.projects),
      extractors: isDeepStrictEqual(stored.extractors, first.extractors ?? []),
      diagnostics: isDeepStrictEqual(stored.diagnostics, first.diagnostics)
    };
    const roundTripMatches = Object.values(componentMatches).every(Boolean);
    record("store-round-trip", roundTripMatches,
      roundTripMatches ? "exact membership match" : `membership mismatch: ${JSON.stringify(componentMatches)}`);
  } finally {
    db.close();
  }

  const finalCommitBeforeInspection = runGit(
    checkout.root,
    ["rev-parse", "--verify", "HEAD^{commit}"]
  );
  if (finalCommitBeforeInspection !== checkout.commit || finalCommitBeforeInspection !== spec.commit) {
    throw new ExternalValidationInputError(
      "pinned-commit-unchanged",
      `${spec.id}: checkout commit changed during validation from ${checkout.commit} ` +
        `to ${finalCommitBeforeInspection}`,
      finalCommitBeforeInspection
    );
  }
  assertSafeLocalGitConfiguration(checkout.root, spec.id, finalCommitBeforeInspection);
  const changesAfter = checkoutChanges(checkout.root, spec.commit);
  if (changesAfter.length > 0) {
    throw new ExternalValidationInputError(
      "source-tree-unchanged",
      `${spec.id}: checkout changed during repeated indexing:\n${changesAfter.slice(0, 20).join("\n")}`,
      finalCommitBeforeInspection
    );
  }
  const pinnedCapture = captureRepository(checkout.root);
  captureBinding.assertCapture(pinnedCapture);
  if (
    pinnedCapture.workspaceHash !== first.workspaceHash ||
    pinnedCapture.workspaceHash !== second.workspaceHash
  ) {
    throw new ExternalValidationInputError(
      "pinned-source-binding",
      `${spec.id}: indexed/support bytes are not bound to the pinned commit tree`,
      finalCommitBeforeInspection
    );
  }
  const finalCommit = runGit(checkout.root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (finalCommit !== finalCommitBeforeInspection || finalCommit !== spec.commit) {
    throw new ExternalValidationInputError(
      "pinned-commit-unchanged",
      `${spec.id}: checkout commit changed during final inspection from ` +
        `${finalCommitBeforeInspection} to ${finalCommit}`,
      finalCommit
    );
  }
  record("pinned-source-binding", true, "indexed/support bytes match the immutable commit tree");
  record("pinned-commit-unchanged", true, `HEAD remained ${finalCommit}`);
  record("source-tree-unchanged", true, "raw HEAD, index, and worktree bytes remain identical");

  return externalValidationReportSchema.parse({
    status: "completed",
    repositoryId: spec.id,
    url: spec.url,
    license: spec.license,
    purpose: spec.purpose,
    expectedCommit: spec.commit,
    observedCommit: checkout.commit,
    success: invariants.every((invariant) => invariant.passed),
    graphDigest: portableGraphDigest(first),
    workspaceHash: first.workspaceHash,
    analyzerVersion: first.analyzerVersion,
    counts: {
      files: first.files.length,
      nodes: first.nodes.length,
      edges: first.edges.length,
      projects: first.projects.length,
      diagnostics: first.diagnostics.length,
      errorDiagnostics
    },
    languages,
    extractors,
    error: null,
    invariants
  });
}

function failedExternalValidationReport(
  spec: ExternalRepositorySpec,
  error: unknown
): ExternalValidationReport {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const invariantId = error instanceof ExternalValidationInputError
    ? error.invariantId
    : "validation-completed";
  return externalValidationReportSchema.parse({
    status: "failed",
    repositoryId: spec.id,
    url: spec.url,
    license: spec.license,
    purpose: spec.purpose,
    expectedCommit: spec.commit,
    observedCommit: error instanceof ExternalValidationInputError ? error.observedCommit : null,
    success: false,
    graphDigest: null,
    workspaceHash: null,
    analyzerVersion: null,
    counts: null,
    languages: [],
    extractors: [],
    error: {
      name: normalizedError.name,
      message: normalizedError.message
    },
    invariants: [{ id: invariantId, passed: false, detail: normalizedError.message }]
  });
}

export interface ExternalValidationSuiteOptions {
  recordedAt?: string;
  repositories?: readonly ExternalRepositorySpec[];
}

const VALIDATOR_SOURCE_SCOPES = [
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "docs/MULTILANGUAGE_CAPABILITIES.json",
  "docs/multilanguage-capabilities.schema.json",
  "packages/bench/package.json",
  "packages/bench/src",
  "packages/bench/external-repositories.json",
  "packages/bench/external-repositories.schema.json",
  "packages/bench/external-validation-report.schema.json",
  "packages/core/package.json",
  "packages/core/src",
  "packages/indexer/package.json",
  "packages/indexer/grammars.json",
  "packages/indexer/src",
  "packages/store/package.json",
  "packages/store/src"
] as const;

export function runExternalValidationSuite(
  checkoutRoot: string,
  validatorRoot: string,
  options: ExternalValidationSuiteOptions = {}
): ExternalValidationSuiteReport {
  const resolvedValidatorRoot = realpathSync.native(path.resolve(validatorRoot));
  const validatorGitRoot = realpathSync.native(
    runGit(resolvedValidatorRoot, ["rev-parse", "--show-toplevel"])
  );
  if (!samePath(resolvedValidatorRoot, validatorGitRoot)) {
    throw new Error(`validator root must be the Git worktree root (${validatorGitRoot})`);
  }
  const validatorCommit = runGit(resolvedValidatorRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  assertSafeLocalGitConfiguration(resolvedValidatorRoot, "validator", validatorCommit);
  const sourceChangesBefore = checkoutChanges(
    resolvedValidatorRoot,
    validatorCommit,
    VALIDATOR_SOURCE_SCOPES
  );
  const specs = options.repositories === undefined
    ? EXTERNAL_REPOSITORY_MANIFEST.repositories
    : externalRepositoryManifestSchema.parse({ version: 1, repositories: options.repositories }).repositories;
  const repositories = specs.map((spec) => {
    try {
      return validateExternalRepository(path.join(checkoutRoot, spec.id), spec);
    } catch (error) {
      return failedExternalValidationReport(spec, error);
    }
  });
  const validatorCommitAfter = runGit(
    resolvedValidatorRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"]
  );
  assertSafeLocalGitConfiguration(resolvedValidatorRoot, "validator", validatorCommitAfter);
  const sourceChangesAfter = checkoutChanges(
    resolvedValidatorRoot,
    validatorCommit,
    VALIDATOR_SOURCE_SCOPES
  );
  const validatorCommitAfterInspection = runGit(
    resolvedValidatorRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"]
  );
  const validatorSourceChanged =
    validatorCommitAfter !== validatorCommit ||
    validatorCommitAfterInspection !== validatorCommit ||
    sourceChangesBefore.length > 0 ||
    sourceChangesAfter.length > 0;
  return externalValidationSuiteReportSchema.parse({
    $schema: "./external-validation-report.schema.json",
    schemaVersion: 1,
    manifestVersion: EXTERNAL_REPOSITORY_MANIFEST.version,
    recordedAt: options.recordedAt ?? new Date().toISOString(),
    validator: {
      commit: validatorCommit,
      sourceChanges: validatorSourceChanged
    },
    success: !validatorSourceChanged && repositories.every((report) => report.success),
    repositories
  });
}
