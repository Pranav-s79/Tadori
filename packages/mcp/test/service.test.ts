import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexRepositoryIntoStore } from "@tadori/indexer";
import { insertSnapshotGraph, openDatabase, runMigrations, type Database } from "@tadori/store";
import { GraphService } from "../src/service.js";
import { makeEdge, makeFile, makeGraph, makeNode } from "./helpers.js";

let db: Database;
let tempRoot: string;

beforeEach(() => {
  db = openDatabase(":memory:");
  runMigrations(db);
  tempRoot = mkdtempSync(path.join(tmpdir(), "tadori-mcp-service-"));
});

afterEach(() => {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
});

function openTwoFileService() {
  const sourceA = "export function alpha() {}\n";
  const sourceB = "export function beta() {}\n";
  mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  writeFileSync(path.join(tempRoot, "src", "a.ts"), sourceA, "utf8");
  writeFileSync(path.join(tempRoot, "src", "b.ts"), sourceB, "utf8");
  const fileA = makeFile("src/a.ts", sourceA);
  const fileB = makeFile("src/b.ts", sourceB);
  const alpha = makeNode("function", "src/a.ts.alpha", fileA.normalizedPath, {
    displayName: "alpha"
  });
  const beta = makeNode("function", "src/b.ts.beta", fileB.normalizedPath, {
    displayName: "beta"
  });
  const edge = makeEdge(alpha, "calls", beta);
  insertSnapshotGraph(db, makeGraph(tempRoot, [fileA, fileB], [alpha, beta], [edge]));
  return { service: GraphService.open(db, tempRoot), alpha, beta, edge };
}

describe("GraphService snapshot safety", () => {
  it("reports freshness per returned item and never serves a stale body", () => {
    const { service, alpha, beta, edge } = openTwoFileService();
    expect(service.snapshotFreshness()).toMatchObject({ status: "fresh", stale: false });
    expect(service.nodeFreshness(alpha)).toMatchObject({ status: "fresh", stale: false });
    expect(service.readBody(alpha)).toMatchObject({
      body: "export function alpha() {}",
      status: "fresh",
      stale: false
    });

    writeFileSync(path.join(tempRoot, "src", "b.ts"), "export function changed() {}\n", "utf8");
    expect(service.nodeFreshness(alpha).stale).toBe(false);
    expect(service.nodeFreshness(beta)).toMatchObject({ status: "stale", stale: true });
    expect(service.edgeFreshness(edge).stale).toBe(true);
    expect(service.readBody(beta)).toMatchObject({
      body: null,
      status: "stale",
      reason: "content_changed"
    });
    writeFileSync(path.join(tempRoot, "src", "new.ts"), "export const added = true;\n", "utf8");
    expect(service.snapshotFreshness()).toMatchObject({ status: "stale", stale: true });
  });

  it("treats newly added compiler and package configuration as stale support state", () => {
    const { service } = openTwoFileService();
    writeFileSync(path.join(tempRoot, "tsconfig.json"), "{\"compilerOptions\":{}}\n", "utf8");
    expect(service.snapshotFreshness()).toMatchObject({ status: "stale", stale: true });
  });

  it("includes existing support configuration in the indexed workspace hash", () => {
    mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    writeFileSync(path.join(tempRoot, "src", "configured.ts"), "export const value = 1;\n");
    writeFileSync(path.join(tempRoot, "tsconfig.json"), "{\"compilerOptions\":{}}\n");
    indexRepositoryIntoStore(db, tempRoot, { kind: "working_tree" });
    const service = GraphService.open(db, tempRoot);
    expect(service.snapshotFreshness()).toMatchObject({ status: "fresh", stale: false });

    writeFileSync(
      path.join(tempRoot, "tsconfig.json"),
      "{\"compilerOptions\":{\"strict\":true}}\n"
    );
    expect(service.snapshotFreshness()).toMatchObject({ status: "stale", stale: true });
  });

  it("marks unchanged dependency paths stale while a refresh is pending", () => {
    const dirty = new Set<string>();
    let staleSnapshot = false;
    const overlay = {
      isPathStaleForSnapshot: (_snapshotId: number, normalizedPath: string) =>
        dirty.has(normalizedPath),
      isSnapshotStale: () => staleSnapshot
    };
    const opened = openTwoFileService();
    const service = GraphService.open(db, tempRoot, overlay);
    dirty.add("src/a.ts");
    staleSnapshot = true;

    expect(service.nodeFreshness(opened.alpha)).toMatchObject({
      status: "stale",
      stale: true,
      reason: "refresh_pending"
    });
    expect(service.readBody(opened.alpha)).toMatchObject({
      body: null,
      reason: "refresh_pending"
    });
    expect(service.snapshotFreshness()).toMatchObject({
      stale: true,
      reason: "refresh_pending"
    });
  });

  it("prefers the working-tree head over newer staged or patch snapshots", () => {
    const source = "export function live() {}\n";
    mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    writeFileSync(path.join(tempRoot, "src", "live.ts"), source);
    const file = makeFile("src/live.ts", source);
    const live = makeNode("function", "src/live.ts.live", file.normalizedPath);
    const working = insertSnapshotGraph(
      db,
      makeGraph(tempRoot, [file], [live], [], "working_tree")
    );
    const staged = makeGraph(tempRoot, [file], [live], [], "staged");
    insertSnapshotGraph(db, { ...staged, workspaceHash: "f".repeat(64) });

    expect(GraphService.open(db, tempRoot, undefined, "working_tree").snapshot.id).toBe(
      working.snapshotId
    );
  });

  it("opens one explicitly selected snapshot and rejects another repository's snapshot", () => {
    const source = "export function first() {}\n";
    mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    writeFileSync(path.join(tempRoot, "src", "first.ts"), source);
    const file = makeFile("src/first.ts", source);
    const first = makeNode("function", "src/first.ts.first", file.normalizedPath);
    const selected = insertSnapshotGraph(db, makeGraph(tempRoot, [file], [first], []));

    const otherRoot = mkdtempSync(path.join(tmpdir(), "tadori-mcp-other-"));
    try {
      mkdirSync(path.join(otherRoot, "src"), { recursive: true });
      writeFileSync(path.join(otherRoot, "src", "other.ts"), "export const other = true;\n");
      const otherFile = makeFile("src/other.ts", "export const other = true;\n");
      const otherNode = makeNode("function", "src/other.ts.other", otherFile.normalizedPath);
      const other = insertSnapshotGraph(db, makeGraph(otherRoot, [otherFile], [otherNode], []));

      expect(GraphService.openSnapshot(db, tempRoot, selected.snapshotId).snapshot.id).toBe(
        selected.snapshotId
      );
      expect(() => GraphService.openSnapshot(db, tempRoot, other.snapshotId)).toThrow(
        "is not available for repository"
      );
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("repairs missing legacy FTS rows before serving search requests", () => {
    const source = "export function searchable() {}\n";
    mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    writeFileSync(path.join(tempRoot, "src", "searchable.ts"), source);
    const file = makeFile("src/searchable.ts", source);
    const node = makeNode("function", "src/searchable.ts.searchable", file.normalizedPath);
    const inserted = insertSnapshotGraph(db, makeGraph(tempRoot, [file], [node], []));
    db.prepare("DELETE FROM node_fts WHERE snapshot_id = ?").run(inserted.snapshotId);

    const service = GraphService.open(db, tempRoot);

    expect(service.searchNodes("searchable", 10).matches.map((match) => match.entity_key))
      .toEqual([node.entityKey]);
  });

  it("preserves ambiguity for identical qualified names across node kinds", () => {
    const source = "export interface Shared {}\n";
    mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    writeFileSync(path.join(tempRoot, "src", "shared.ts"), source, "utf8");
    const file = makeFile("src/shared.ts", source);
    const classNode = makeNode("class", "src/shared.ts.Shared", file.normalizedPath);
    const interfaceNode = makeNode("interface", "src/shared.ts.Shared", file.normalizedPath);
    insertSnapshotGraph(db, makeGraph(tempRoot, [file], [classNode, interfaceNode], []));

    const resolution = GraphService.open(db, tempRoot).resolveEntity("src/shared.ts.Shared");
    expect(resolution.node).toBeNull();
    expect(resolution.candidates.map((node) => node.kind).sort()).toEqual(["class", "interface"]);
  });

  it("confines snapshot paths to the repository root", () => {
    const outside = path.join(path.dirname(tempRoot), `${path.basename(tempRoot)}-secret.txt`);
    writeFileSync(outside, "outside secret\n", "utf8");
    try {
      const relativeEscape = `../${path.basename(outside)}`;
      const file = makeFile(relativeEscape, "outside secret\n");
      const node = makeNode("function", "escape.read", relativeEscape);
      insertSnapshotGraph(db, makeGraph(tempRoot, [file], [node], []));

      const result = GraphService.open(db, tempRoot).readBody(node);
      expect(result).toMatchObject({
        body: null,
        status: "unknown",
        stale: true,
        reason: "outside_repository"
      });
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("rejects a symlink or junction that resolves outside the repository", () => {
    const outsideDirectory = mkdtempSync(path.join(tmpdir(), "tadori-mcp-outside-"));
    const outsideFile = path.join(outsideDirectory, "secret.ts");
    writeFileSync(outsideFile, "export const secret = true;\n", "utf8");
    const link = path.join(tempRoot, "linked");
    try {
      symlinkSync(outsideDirectory, link, process.platform === "win32" ? "junction" : "dir");
      const normalizedPath = "linked/secret.ts";
      const file = makeFile(normalizedPath, "export const secret = true;\n");
      const node = makeNode("function", "linked.secret", normalizedPath);
      insertSnapshotGraph(db, makeGraph(tempRoot, [file], [node], []));

      expect(GraphService.open(db, tempRoot).readBody(node)).toMatchObject({
        body: null,
        status: "unknown",
        stale: true,
        reason: "outside_repository"
      });
    } finally {
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });
});
