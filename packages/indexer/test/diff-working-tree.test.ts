import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffWorkingTree,
  indexRepositoryIntoStore
} from "@tadori/indexer";
import { openDatabase, runMigrations, type Database } from "@tadori/store";

let db: Database | null = null;
let repo: string | null = null;

afterEach(() => {
  db?.close();
  db = null;
  if (repo) {
    rmSync(repo, { recursive: true, force: true });
    repo = null;
  }
});

describe("tadori diff working-tree flow", () => {
  it("persists project-root evidence when manifests are support-only", () => {
    repo = mkdtempSync(path.join(tmpdir(), "tadori-project-evidence-"));
    mkdirSync(path.join(repo, "packages", "harness", "src"), { recursive: true });
    writeFileSync(path.join(repo, "package.json"), '{"name":"workspace"}\n');
    writeFileSync(
      path.join(repo, "packages", "harness", "package.json"),
      '{"name":"@workspace/harness"}\n'
    );
    writeFileSync(
      path.join(repo, "packages", "harness", "src", "index.ts"),
      "export const harness = true;\n"
    );
    db = openDatabase(":memory:");
    runMigrations(db);

    const indexed = indexRepositoryIntoStore(db, repo, { kind: "working_tree" });
    const snapshotFiles = new Set(indexed.graph.files.map((file) => file.normalizedPath));
    const evidence = [...indexed.graph.nodes, ...indexed.graph.edges]
      .flatMap((item) => item.evidence);

    expect(indexed.graph.projects).toContainEqual(expect.objectContaining({
      manifest: "packages/harness/package.json",
      root: "packages/harness"
    }));
    expect(evidence.every((item) => snapshotFiles.has(item.file))).toBe(true);
  });

  it("reconciles disk and returns the frozen deterministic edge diff", async () => {
    repo = mkdtempSync(path.join(tmpdir(), "tadori-diff-command-"));
    mkdirSync(path.join(repo, "src"));
    writeFileSync(path.join(repo, "package.json"), '{"name":"diff-fixture"}\n');
    writeFileSync(
      path.join(repo, "src", "value.ts"),
      "export function value(): number { return 1; }\n"
    );
    writeFileSync(
      path.join(repo, "src", "consumer.ts"),
      'import { value } from "./value.js";\nexport function consume(): number { return value(); }\n'
    );
    db = openDatabase(":memory:");
    runMigrations(db);
    const base = indexRepositoryIntoStore(db, repo, { kind: "working_tree" });
    writeFileSync(
      path.join(repo, "src", "consumer.ts"),
      "export function consume(): number { return 0; }\n"
    );

    const result = await diffWorkingTree(db, repo);
    expect(result.baseSnapshotId).toBe(base.snapshotId);
    expect(result.headSnapshotId).not.toBe(base.snapshotId);
    expect(result.changed).toBe(true);
    expect(result.edges.map((edge) => [edge.change_kind, edge.relation])).toEqual(
      expect.arrayContaining([
        ["removed", "calls"],
        ["removed", "imports"]
      ])
    );
    expect(result.edges).toEqual(
      [...result.edges].sort((left, right) =>
        [left.change_kind, left.source, left.relation, left.destination]
          .join("\0")
          .localeCompare(
            [right.change_kind, right.source, right.relation, right.destination].join("\0")
          )
      )
    );
  });
});
