import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureRepository,
  detectPackageName,
  IncrementalRepositoryIndexer,
  indexRepository,
  scanRepository
} from "@tadori/indexer";
import {
  getActiveSnapshot,
  listSnapshots,
  loadSnapshotGraph,
  openDatabase,
  runMigrations
} from "@tadori/store";

type LinkType = "file" | "dir" | "junction";

const UNAVAILABLE_LINK_ERROR_CODES = new Set(["EACCES", "ENOSYS", "ENOTSUP", "EPERM"]);
const DIRECTORY_LINK_TYPE: LinkType = process.platform === "win32" ? "junction" : "dir";

function isUnavailableLinkError(error: unknown): boolean {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    UNAVAILABLE_LINK_ERROR_CODES.has(error.code);
}

function supportsLinkType(type: LinkType): boolean {
  const probe = mkdtempSync(path.join(tmpdir(), "tadori-link-probe-"));
  const target = path.join(probe, "target");
  const link = path.join(probe, "link");
  try {
    if (type === "file") {
      writeFileSync(target, "probe\n");
    } else {
      mkdirSync(target);
    }
    try {
      symlinkSync(target, link, type);
      return true;
    } catch (error) {
      if (isUnavailableLinkError(error)) {
        return false;
      }
      throw error;
    }
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const FILE_LINKS_SUPPORTED = supportsLinkType("file");
const DIRECTORY_LINKS_SUPPORTED = supportsLinkType(DIRECTORY_LINK_TYPE);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.reverse()) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function write(root: string, relativePath: string, contents: string): string {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
  return absolutePath;
}

async function exerciseIncrementalLinkLifecycle(type: LinkType): Promise<void> {
  const repository = temporaryDirectory("tadori-link-refresh-repository-");
  const outside = temporaryDirectory("tadori-link-refresh-outside-");
  write(repository, "src/owned.ts", "export const owned = true;\n");
  const target = type === "file"
    ? write(outside, "external.py", "SECRET = 1\n")
    : outside;
  if (type !== "file") write(outside, "secret.py", "SECRET = 1\n");
  const relativeLink = type === "file" ? "linked.py" : "linked";
  const link = path.join(repository, relativeLink);
  const database = openDatabase(":memory:");
  runMigrations(database);
  const incremental = new IncrementalRepositoryIndexer(database, repository);
  try {
    await incremental.initialize();
    await incremental.waitForIdle();
    const repositoryRow = database.prepare(
      "SELECT id FROM repositories WHERE root_path = ?"
    ).get(repository.split(path.sep).join("/")) as { id: number };
    const initialHead = getActiveSnapshot(database, repositoryRow.id, "working_tree");
    expect(initialHead).toBeDefined();
    const initialHash = captureRepository(repository).workspaceHash;
    expect(loadSnapshotGraph(database, initialHead!.id).diagnostics.filter(
      (diagnostic) => diagnostic.code === "repository-symbolic-link-skipped"
    )).toEqual([]);

    symlinkSync(target, link, type);
    const linkedCapture = captureRepository(repository);
    expect(linkedCapture.workspaceHash).not.toBe(initialHash);
    expect(linkedCapture.manifestHashes.has(relativeLink)).toBe(true);

    const targetSource = type === "file" ? target : path.join(target, "secret.py");
    writeFileSync(targetSource, "SECRET = 2\n");
    expect(captureRepository(repository).workspaceHash).toBe(linkedCapture.workspaceHash);

    let state = await incremental.refresh([{ path: relativeLink, kind: "rename" }]);
    expect(state).toMatchObject({ phase: "idle", lastError: null });
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      changedPaths: [relativeLink],
      reusedSnapshot: false
    });
    expect(state.snapshotId).not.toBe(initialHead!.id);
    expect(loadSnapshotGraph(database, state.snapshotId!).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "repository-symbolic-link-skipped",
        file: null,
        language: type === "file" ? "python" : "unknown"
      })
    );
    expect(listSnapshots(database, repositoryRow.id)).toHaveLength(2);

    unlinkSync(link);
    expect(captureRepository(repository).workspaceHash).toBe(initialHash);
    state = await incremental.refresh([{ path: relativeLink, kind: "rename" }]);
    expect(state).toMatchObject({ phase: "idle", lastError: null });
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      changedPaths: [relativeLink],
      reusedSnapshot: true,
      snapshotId: initialHead!.id
    });
    expect(loadSnapshotGraph(database, state.snapshotId!).diagnostics.filter(
      (diagnostic) => diagnostic.code === "repository-symbolic-link-skipped"
    )).toEqual([]);
    expect(listSnapshots(database, repositoryRow.id)).toHaveLength(2);
  } finally {
    await incremental.stop();
    database.close();
  }
}

describe("scanRepository symbolic-link boundaries", () => {
  it.skipIf(!FILE_LINKS_SUPPORTED)("does not index a file link to source outside the repository", () => {
    const repository = temporaryDirectory("tadori-scan-link-repository-");
    const outside = temporaryDirectory("tadori-scan-link-outside-");
    write(repository, "src/owned.ts", "export const owned = true;\n");
    const externalSource = write(outside, "external.py", "EXTERNAL = True\n");
    symlinkSync(externalSource, path.join(repository, "linked.py"), "file");

    const scan = scanRepository(repository);

    expect(scan.indexedFiles.map((file) => file.normalizedPath)).toEqual(["src/owned.ts"]);
    expect(scan.supportFiles).toEqual([]);
    expect(scan.diagnostics).toEqual([{
      code: "repository-symbolic-link-skipped",
      message: "Skipped symbolic link linked.py; link targets are outside the repository trust boundary",
      language: "python",
      normalizedPath: "linked.py"
    }]);
  });

  it.skipIf(!FILE_LINKS_SUPPORTED)("does not read linked ignore rules or package manifests", () => {
    const repository = temporaryDirectory("tadori-scan-metadata-repository-");
    const outside = temporaryDirectory("tadori-scan-metadata-outside-");
    const source = write(repository, "src/owned.ts", "export const owned = true;\n");
    const ignore = write(outside, "external.gitignore", "src/owned.ts\n");
    const manifest = write(outside, "external-package.json", "{\"name\":\"outside\"}\n");
    symlinkSync(ignore, path.join(repository, ".gitignore"), "file");
    symlinkSync(manifest, path.join(repository, "package.json"), "file");

    const scan = scanRepository(repository);

    expect(scan.indexedFiles.map((file) => file.normalizedPath)).toEqual(["src/owned.ts"]);
    expect(scan.supportFiles).toEqual([]);
    expect(scan.diagnostics).toEqual([
      {
        code: "repository-symbolic-link-skipped",
        message: "Skipped symbolic link .gitignore; link targets are outside the repository trust boundary",
        language: "repository-config",
        normalizedPath: ".gitignore"
      },
      {
        code: "repository-symbolic-link-skipped",
        message: "Skipped symbolic link package.json; link targets are outside the repository trust boundary",
        language: "json",
        normalizedPath: "package.json"
      }
    ]);
    expect(detectPackageName(repository, source)).toBeNull();
  });

  it("rejects package-name lookup for a file outside the repository", () => {
    const repository = temporaryDirectory("tadori-package-boundary-repository-");
    const outside = temporaryDirectory("tadori-package-boundary-outside-");
    const externalSource = write(outside, "src/external.ts", "export const external = true;\n");
    write(outside, "package.json", "{\"name\":\"outside\"}\n");

    expect(() => detectPackageName(repository, externalSource)).toThrow(/escapes repository root/u);
  });

  it.skipIf(!DIRECTORY_LINKS_SUPPORTED)("does not traverse a directory link outside the repository", () => {
    const repository = temporaryDirectory("tadori-scan-directory-repository-");
    const outside = temporaryDirectory("tadori-scan-directory-outside-");
    write(repository, "src/main.go", "package main\n");
    write(outside, "secret.py", "SECRET = True\n");
    symlinkSync(outside, path.join(repository, "external"), DIRECTORY_LINK_TYPE);

    const scan = scanRepository(repository);

    expect(scan.indexedFiles.map((file) => file.normalizedPath)).toEqual(["src/main.go"]);
    expect(scan.supportFiles).toEqual([]);
    expect(scan.diagnostics).toEqual([{
      code: "repository-symbolic-link-skipped",
      message: "Skipped symbolic link external; link targets are outside the repository trust boundary",
      language: "unknown",
      normalizedPath: "external"
    }]);
    expect(scanRepository(repository)).toEqual(scan);

    const graph = indexRepository(repository, { kind: "working_tree" }).graph;
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: "repository-symbolic-link-skipped",
      file: null,
      language: "unknown",
      extractorId: "tadori-repository",
      extractorVersion: "1"
    }));
    expect(graph.extractors).toContainEqual(expect.objectContaining({
      id: "tadori-repository",
      version: "1",
      languages: expect.arrayContaining(["go", "unknown"])
    }));
  });

  it.skipIf(!DIRECTORY_LINKS_SUPPORTED)("does not recurse through a directory-link cycle", () => {
    const repository = temporaryDirectory("tadori-scan-cycle-repository-");
    write(repository, "src/main.rs", "fn main() {}\n");
    symlinkSync(repository, path.join(repository, "src", "cycle"), DIRECTORY_LINK_TYPE);

    const scan = scanRepository(repository);

    expect(scan.indexedFiles.map((file) => file.normalizedPath)).toEqual(["src/main.rs"]);
    expect(scan.supportFiles).toEqual([]);
    expect(scan.diagnostics).toEqual([{
      code: "repository-symbolic-link-skipped",
      message: "Skipped symbolic link src/cycle; link targets are outside the repository trust boundary",
      language: "unknown",
      normalizedPath: "src/cycle"
    }]);
  });

  it.skipIf(!FILE_LINKS_SUPPORTED)(
    "refreshes diagnostics when a skipped file link is added and removed",
    async () => exerciseIncrementalLinkLifecycle("file")
  );

  it.skipIf(!DIRECTORY_LINKS_SUPPORTED)(
    "refreshes diagnostics when a skipped directory link or junction is added and removed",
    async () => exerciseIncrementalLinkLifecycle(DIRECTORY_LINK_TYPE)
  );

  it.skipIf(process.platform === "win32")("does not read a Unix-domain socket as source", async () => {
    const repository = temporaryDirectory("td-sock-");
    write(repository, "src/main.rs", "fn main() {}\n");
    const socketPath = path.join(repository, "s");
    const server = createServer();

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
      const scan = scanRepository(repository);
      expect(scan.indexedFiles.map((file) => file.normalizedPath)).toEqual(["src/main.rs"]);
      expect(scan.supportFiles).toEqual([]);
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error === undefined ? resolve() : reject(error));
        });
      } else {
        server.unref();
      }
    }
  });
});
