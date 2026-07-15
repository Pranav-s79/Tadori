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
