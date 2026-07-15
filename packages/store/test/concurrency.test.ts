import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Hex } from "@tadori/core";
import {
  getActiveSnapshot,
  insertSnapshotGraph,
  openDatabase,
  runMigrations,
  type Database
} from "@tadori/store";
import { makeFile, makeGraph, makeNode } from "./helpers.js";

const databases: Database[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function graph(workspace: string) {
  const file = makeFile("src/a.ts", workspace);
  const node = makeNode("function", "src/a.ts.value", "src/a.ts");
  return {
    ...makeGraph({ files: [file], nodes: [node], edges: [] }, "working_tree"),
    workspaceHash: sha256Hex(workspace)
  };
}

describe("snapshot publication concurrency", () => {
  it("keeps an old reader generation visible until the writer commits", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tadori-store-concurrency-"));
    roots.push(root);
    const databasePath = path.join(root, "tadori.sqlite");
    const writer = openDatabase(databasePath);
    databases.push(writer);
    runMigrations(writer);
    const first = insertSnapshotGraph(writer, graph("one"));
    const reader = openDatabase(databasePath);
    databases.push(reader);

    let secondSnapshotId: number | null = null;
    const holdReaderGeneration = reader.transaction(() => {
      expect(getActiveSnapshot(reader, first.repoId, "working_tree")?.id).toBe(first.snapshotId);
      const second = insertSnapshotGraph(writer, graph("two"), {
        expectedActivationId: first.activationId
      });
      secondSnapshotId = second.snapshotId;
      // The writer committed, but this deferred reader transaction stays on
      // its original WAL generation until the callback returns.
      expect(getActiveSnapshot(reader, first.repoId, "working_tree")?.id).toBe(first.snapshotId);
    });
    holdReaderGeneration.deferred();

    expect(getActiveSnapshot(reader, first.repoId, "working_tree")?.id).toBe(secondSnapshotId);
  });
});
