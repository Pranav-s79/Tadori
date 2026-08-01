import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SnapshotGraph } from "@tadori/core";
import {
  ANALYZER_VERSION,
  IncrementalRepositoryIndexer,
  captureRepository,
  createProjectServices,
  extractRepositoryGraph,
  indexRepository,
  mergeSnapshotRegion
} from "@tadori/indexer";
import {
  getActiveSnapshot,
  insertSnapshotGraph,
  listSnapshots,
  loadSnapshotGraph,
  openDatabase,
  runMigrations,
  type Database
} from "@tadori/store";

const PRE_ATTRIBUTION_ANALYZER_VERSION = ANALYZER_VERSION.replace(
  "tadori-indexer/0.2.1",
  "tadori-indexer/0.2.0"
);

let db: Database;
let repo: string;
let indexer: IncrementalRepositoryIndexer | null = null;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
  repo = mkdtempSync(path.join(tmpdir(), "tadori-analyzer-version-"));
  mkdirSync(path.join(repo, "src"), { recursive: true });
  writeFileSync(path.join(repo, "package.json"), '{"name":"version-fixture"}\n');
  writeFileSync(path.join(repo, "src", "value.ts"), "export function value(): number { return 1; }\n");
});

afterEach(async () => {
  await indexer?.stop();
  indexer = null;
  db.close();
  rmSync(repo, { recursive: true, force: true });
});

function preAttributionGraph(graph: SnapshotGraph): SnapshotGraph {
  const nodeByKey = new Map(graph.nodes.map((node) => [node.entityKey, node]));
  return {
    ...graph,
    analyzerVersion: PRE_ATTRIBUTION_ANALYZER_VERSION,
    edges: graph.edges.map((edge) => {
      const source = nodeByKey.get(edge.srcEntityKey);
      const target = nodeByKey.get(edge.dstEntityKey);
      if (edge.relation !== "contains" || source?.kind !== "package" || target?.kind !== "file") {
        return edge;
      }
      return {
        ...edge,
        language: null,
        provenance: {
          extractorId: "tadori-typescript",
          extractorVersion: "1",
          capability: "semantic",
          derivation: "compiler-resolved",
          unresolvedReason: null
        }
      };
    })
  };
}

describe("analyzer attribution version boundary", () => {
  it("rejects a regional merge across the pre-attribution analyzer boundary", () => {
    expect(PRE_ATTRIBUTION_ANALYZER_VERSION).not.toBe(ANALYZER_VERSION);
    const current = indexRepository(repo, { kind: "working_tree" }).graph;
    const previous = preAttributionGraph(current);
    writeFileSync(path.join(repo, "src", "value.ts"), "export function value(): number { return 2; }\n");
    const capture = captureRepository(repo);
    const services = createProjectServices(
      repo,
      capture.scan.indexedFiles
        .filter((file) => file.language === "typescript" || file.language === "javascript")
        .map((file) => file.absolutePath)
    );
    try {
      const replacement = extractRepositoryGraph(repo, capture, services, {
        fileRegion: ["src/value.ts"],
        seedGraph: previous,
        fileContents: capture.fileContents
      });
      const target = indexRepository(repo, { kind: "working_tree" }).graph;
      expect(() => mergeSnapshotRegion(previous, replacement, {
        invalidatedFiles: ["src/value.ts"],
        target: {
          repoRootPath: target.repoRootPath,
          kind: target.kind,
          label: target.label,
          baseCommitSha: target.baseCommitSha,
          workspaceHash: target.workspaceHash,
          analyzerVersion: target.analyzerVersion,
          extractors: target.extractors,
          diagnostics: target.diagnostics
        }
      })).toThrow(/analyzer version changed; use full extraction/);
    } finally {
      services.languageService.dispose();
    }
  });

  it("performs a full reindex and publishes only current attribution", async () => {
    const current = indexRepository(repo, { kind: "working_tree" }).graph;
    const previous = preAttributionGraph(current);
    const inserted = insertSnapshotGraph(db, previous);
    expect(inserted.activationId).not.toBeNull();
    writeFileSync(path.join(repo, "src", "value.ts"), "export function value(): number { return 2; }\n");

    indexer = new IncrementalRepositoryIndexer(db, repo);
    await indexer.initialize();
    await indexer.waitForIdle();
    const state = indexer.state();
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      reason: "stored analyzer version differs from the current indexer"
    });

    const repository = db.prepare("SELECT id FROM repositories WHERE root_path = ?").get(
      repo.split(path.sep).join("/")
    ) as { id: number };
    const head = getActiveSnapshot(db, repository.id, "working_tree");
    expect(head).toBeDefined();
    const stored = loadSnapshotGraph(db, head!.id);
    const nodeByKey = new Map(stored.nodes.map((node) => [node.entityKey, node]));
    const packageFileEdges = stored.edges.filter((edge) =>
      edge.relation === "contains" &&
      nodeByKey.get(edge.srcEntityKey)?.kind === "package" &&
      nodeByKey.get(edge.dstEntityKey)?.kind === "file"
    );
    expect(stored.analyzerVersion).toBe(ANALYZER_VERSION);
    expect(packageFileEdges.every(
      (edge) => edge.provenance?.derivation === "repository-derived"
    )).toBe(true);
    expect(stored.nodes.map((node) => node.entityKey).sort()).toEqual(
      current.nodes.map((node) => node.entityKey).sort()
    );
    expect(stored.edges.map((edge) => edge.entityKey).sort()).toEqual(
      current.edges.map((edge) => edge.entityKey).sort()
    );
    expect(listSnapshots(db, repository.id)).toHaveLength(2);
  });

  it("publishes an analyzer-distinct snapshot when repository bytes are unchanged", async () => {
    const current = indexRepository(repo, { kind: "working_tree" }).graph;
    const previous = preAttributionGraph(current);
    const inserted = insertSnapshotGraph(db, previous);
    expect(inserted.activationId).not.toBeNull();

    indexer = new IncrementalRepositoryIndexer(db, repo);
    await indexer.initialize();
    await indexer.waitForIdle();
    const state = indexer.state();
    expect(state).toMatchObject({ phase: "idle", lastError: null });
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      reason: "stored analyzer version differs from the current indexer",
      reusedSnapshot: false
    });
    expect(state.snapshotId).not.toBe(inserted.snapshotId);

    const repository = db.prepare("SELECT id FROM repositories WHERE root_path = ?").get(
      repo.split(path.sep).join("/")
    ) as { id: number };
    const snapshots = listSnapshots(db, repository.id);
    expect(snapshots).toHaveLength(2);
    expect(new Set(snapshots.map((snapshot) => snapshot.workspace_hash))).toEqual(
      new Set([current.workspaceHash])
    );
    expect(snapshots.map((snapshot) => snapshot.analyzer_version).sort()).toEqual([
      ANALYZER_VERSION,
      PRE_ATTRIBUTION_ANALYZER_VERSION
    ].sort());
    expect(loadSnapshotGraph(db, state.snapshotId!).analyzerVersion).toBe(ANALYZER_VERSION);
  });

  it("publishes an analyzer-distinct snapshot for an empty unchanged repository", async () => {
    rmSync(path.join(repo, "package.json"));
    rmSync(path.join(repo, "src"), { recursive: true });
    const current = indexRepository(repo, { kind: "working_tree" }).graph;
    expect(current.files).toEqual([]);
    const previous = preAttributionGraph(current);
    const inserted = insertSnapshotGraph(db, previous);
    expect(inserted.activationId).not.toBeNull();

    indexer = new IncrementalRepositoryIndexer(db, repo);
    await indexer.initialize();
    await indexer.waitForIdle();
    const state = indexer.state();

    expect(state).toMatchObject({ phase: "idle", lastError: null });
    expect(state.lastRefresh).toMatchObject({
      mode: "full",
      reason: "stored analyzer version differs from the current indexer",
      changedPaths: [],
      reusedSnapshot: false
    });
    expect(state.snapshotId).not.toBe(inserted.snapshotId);
    expect(loadSnapshotGraph(db, state.snapshotId!).analyzerVersion).toBe(ANALYZER_VERSION);
    const repository = db.prepare("SELECT id FROM repositories WHERE root_path = ?").get(
      repo.split(path.sep).join("/")
    ) as { id: number };
    expect(listSnapshots(db, repository.id)).toHaveLength(2);
  });
});
