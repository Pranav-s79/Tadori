import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { GraphNode } from "@tadori/core";
import { entityKey, fileCanonicalIdentity } from "@tadori/core";
import { afterEach, describe, expect, it } from "vitest";
import { computeCoChangeEdges, readCommitFileSets } from "../src/coChange.js";

let repo: string | null = null;

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tadori-cochange-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "T"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  git(dir, ["config", "core.autocrlf", "false"]);
  return dir;
}

/** Write files and record them as a single commit. */
function commit(dir: string, files: Record<string, string>, message: string): void {
  for (const [rel, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, rel), contents);
  }
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", message]);
}

/** A minimal file node with a real entityKey for the given normalized path. */
function fileNode(normalizedPath: string): GraphNode {
  return {
    kind: "file",
    qualifiedName: normalizedPath,
    displayName: normalizedPath,
    canonicalIdentity: fileCanonicalIdentity(normalizedPath),
    entityKey: entityKey(fileCanonicalIdentity(normalizedPath)),
    file: normalizedPath,
    exported: false,
    spanStart: null,
    spanEnd: null,
    lineStart: null,
    lineEnd: null,
    signature: null,
    bodyHash: null,
    evidence: []
  };
}

afterEach(() => {
  if (repo) {
    rmSync(repo, { recursive: true, force: true });
    repo = null;
  }
});

describe("computeCoChangeEdges", () => {
  it("emits a changed_with edge for a pair that co-changed in >= minShared commits", () => {
    repo = initRepo();
    // a.ts and b.ts change together twice; c.ts is alone → no edge for c.
    commit(repo, { "a.ts": "1", "b.ts": "1", "c.ts": "1" }, "c1");
    commit(repo, { "a.ts": "2", "b.ts": "2" }, "c2");
    const nodes = [fileNode("a.ts"), fileNode("b.ts"), fileNode("c.ts")];

    const edges = computeCoChangeEdges(repo, nodes, { minSharedCommits: 2 });

    expect(edges).toHaveLength(1);
    const [edge] = edges;
    expect(edge?.relation).toBe("changed_with");
    expect(edge?.origin).toBe("git");
    expect(edge?.confidence).toBe("inferred");
    // Endpoints are a.ts and b.ts (order is deterministic by entityKey).
    const endpoints = new Set([edge?.srcEntityKey, edge?.dstEntityKey]);
    expect(endpoints).toEqual(new Set([fileNode("a.ts").entityKey, fileNode("b.ts").entityKey]));
    expect(edge?.evidence[0]?.kind).toBe("git");
    expect(typeof edge?.evidence[0]?.commitSha).toBe("string");
  });

  it("drops a pair that co-changed in fewer than minShared commits", () => {
    repo = initRepo();
    commit(repo, { "a.ts": "1", "b.ts": "1" }, "c1"); // one shared commit only
    const nodes = [fileNode("a.ts"), fileNode("b.ts")];

    expect(computeCoChangeEdges(repo, nodes, { minSharedCommits: 2 })).toEqual([]);
  });

  it("drops files that have no node in the graph", () => {
    repo = initRepo();
    // a.ts co-changes with untracked.ts twice, but untracked.ts has no node.
    commit(repo, { "a.ts": "1", "untracked.ts": "1", "b.ts": "1" }, "c1");
    commit(repo, { "a.ts": "2", "untracked.ts": "2" }, "c2");
    const nodes = [fileNode("a.ts"), fileNode("b.ts")];

    // a×untracked co-changed twice but untracked has no node → no edge; a×b only once.
    expect(computeCoChangeEdges(repo, nodes, { minSharedCommits: 2 })).toEqual([]);
  });

  it("orders endpoints deterministically by entityKey", () => {
    repo = initRepo();
    commit(repo, { "a.ts": "1", "b.ts": "1" }, "c1");
    commit(repo, { "a.ts": "2", "b.ts": "2" }, "c2");
    const nodes = [fileNode("a.ts"), fileNode("b.ts")];

    const edge = computeCoChangeEdges(repo, nodes, { minSharedCommits: 2 })[0];
    const keyA = fileNode("a.ts").entityKey;
    const keyB = fileNode("b.ts").entityKey;
    const [expectedSrc, expectedDst] = keyA <= keyB ? [keyA, keyB] : [keyB, keyA];
    expect(edge?.srcEntityKey).toBe(expectedSrc);
    expect(edge?.dstEntityKey).toBe(expectedDst);
  });

  it("fails closed on a directory that is not a git repository", () => {
    const notRepo = mkdtempSync(path.join(tmpdir(), "tadori-notgit-"));
    try {
      expect(computeCoChangeEdges(notRepo, [fileNode("a.ts")], { minSharedCommits: 1 })).toEqual([]);
      expect(readCommitFileSets(notRepo, 10)).toEqual([]);
    } finally {
      rmSync(notRepo, { recursive: true, force: true });
    }
  });

  it("returns nothing when the graph has no file nodes", () => {
    repo = initRepo();
    commit(repo, { "a.ts": "1", "b.ts": "1" }, "c1");
    commit(repo, { "a.ts": "2", "b.ts": "2" }, "c2");
    expect(computeCoChangeEdges(repo, [], { minSharedCommits: 1 })).toEqual([]);
  });
});
