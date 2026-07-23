import { execFileSync } from "node:child_process";
import type { GraphEdge, GraphNode } from "@tadori/core";
import { edgeCanonicalIdentity, entityKey } from "@tadori/core";

/**
 * Co-change (`changed_with`) extraction from git history (09-04). This is an
 * ADDITIVE pass layered on the statically extracted graph: two files that change
 * together in enough commits get a `file -changed_with-> file` edge (origin
 * `git`, confidence `inferred`). It never runs during fixture extraction, so the
 * frozen golden edge diffs are untouched — it is opt-in via
 * `IndexOptions.extractCoChange` on the live serve path only.
 */

/** NUL record separator emitted by the `--format=%x00%H` git log format. */
const RECORD_SEPARATOR = String.fromCharCode(0);

/** Tuning ceilings. ponytail: fixed window/threshold; expose as serve flags if noisy on real repos. */
export interface CoChangeOptions {
  /** How many recent commits to scan (default 200). */
  maxCommits?: number;
  /** Minimum commits two files must share before an edge is emitted (default 2). */
  minSharedCommits?: number;
}

const DEFAULT_MAX_COMMITS = 200;
const DEFAULT_MIN_SHARED_COMMITS = 2;

/**
 * `git log` of the last `maxCommits` commits with each commit's changed files.
 * Returns one entry per commit `{ sha, files[] }`. Fails CLOSED: any git error
 * (binary missing, not a repo, empty history) yields `[]` — live serving must
 * never crash because co-change could not be computed.
 */
export function readCommitFileSets(
  rootPath: string,
  maxCommits: number
): Array<{ sha: string; files: string[] }> {
  let stdout: string;
  try {
    // Each commit record is prefixed with a NUL then its sha, so the sha is
    // unambiguously distinguishable from the --name-only paths that follow.
    // No shell, args passed as an array.
    stdout = execFileSync(
      "git",
      ["log", "--no-merges", "--name-only", "--format=%x00%H", "-n", String(maxCommits), "--", "."],
      { cwd: rootPath, shell: false, windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }
    );
  } catch {
    return [];
  }

  // Split on the NUL separator so the sha line is unambiguous; each record is
  // "<sha>\n<file>\n<file>...". Read the sha off line 1, paths off the rest.
  const commits: Array<{ sha: string; files: string[] }> = [];
  for (const record of stdout.split(RECORD_SEPARATOR)) {
    const lines = record.split("\n").map((l) => l.replace(/\r$/, ""));
    const sha = (lines[0] ?? "").trim();
    if (sha.length === 0) {
      continue;
    }
    // git prints posix-style paths already; keep verbatim so they match node.file.
    const files = lines.slice(1).filter((l) => l.length > 0);
    commits.push({ sha, files });
  }
  return commits;
}

/**
 * Compute `changed_with` edges from git co-change. Only files that have a node
 * in the current graph participate (unrelated churn — deleted files, non-TS,
 * paths outside the indexed set — drops out). One edge per unordered file pair
 * that co-changed in at least `minSharedCommits` commits; endpoints are ordered
 * lexicographically by entityKey so `A->B` and `B->A` never both appear.
 */
export function computeCoChangeEdges(
  rootPath: string,
  fileNodes: readonly GraphNode[],
  options: CoChangeOptions = {}
): GraphEdge[] {
  const maxCommits = options.maxCommits ?? DEFAULT_MAX_COMMITS;
  const minShared = options.minSharedCommits ?? DEFAULT_MIN_SHARED_COMMITS;

  const keyByPath = new Map<string, string>();
  for (const node of fileNodes) {
    if (node.kind === "file" && node.file !== null) {
      keyByPath.set(node.file, node.entityKey);
    }
  }
  if (keyByPath.size === 0) {
    return [];
  }

  const commits = readCommitFileSets(rootPath, maxCommits);

  // Count co-change per unordered pair of graph-present files.
  const pairCounts = new Map<string, { a: string; b: string; count: number; sha: string }>();
  for (const commit of commits) {
    const present = commit.files.filter((f) => keyByPath.has(f));
    // Dedup within a commit (a path listed twice must not self-inflate the count).
    const unique = [...new Set(present)].sort();
    for (let i = 0; i < unique.length; i += 1) {
      for (let j = i + 1; j < unique.length; j += 1) {
        const pathA = unique[i]!;
        const pathB = unique[j]!;
        const pairKey = `${pathA}${RECORD_SEPARATOR}${pathB}`;
        const existing = pairCounts.get(pairKey);
        if (existing) {
          existing.count += 1;
        } else {
          // First-seen commit sha anchors the evidence.
          pairCounts.set(pairKey, { a: pathA, b: pathB, count: 1, sha: commit.sha });
        }
      }
    }
  }

  const edges: GraphEdge[] = [];
  for (const { a, b, count, sha } of pairCounts.values()) {
    if (count < minShared) {
      continue;
    }
    const keyA = keyByPath.get(a)!;
    const keyB = keyByPath.get(b)!;
    // Deterministic endpoint order: lexicographic by entityKey.
    const [srcKey, srcPath, dstKey] = keyA <= keyB ? [keyA, a, keyB] : [keyB, b, keyA];
    const canonical = edgeCanonicalIdentity(srcKey, "changed_with", dstKey);
    edges.push({
      srcEntityKey: srcKey,
      relation: "changed_with",
      dstEntityKey: dstKey,
      canonicalIdentity: canonical,
      entityKey: entityKey(canonical),
      origin: "git",
      confidence: "inferred",
      resolution: "resolved",
      evidence: [
        {
          file: srcPath,
          kind: "git",
          lineStart: 1,
          lineEnd: 1,
          commitSha: sha
        }
      ]
    });
  }
  // Deterministic edge order, matching the analyzer's canonicalIdentity sort.
  edges.sort((x, y) => x.canonicalIdentity.localeCompare(y.canonicalIdentity));
  return edges;
}
