import { existsSync, realpathSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { resolveRepoRoot } from "./repoResolve.js";

/** Exit codes (mirror serve.ts's convention). */
export const PURGE_EXIT_CLEAN = 0;
export const PURGE_EXIT_UNEXPECTED_ERROR = 1;
export const PURGE_EXIT_UNSUPPORTED_REPOSITORY = 2;
export const PURGE_EXIT_CONFINEMENT_VIOLATION = 5;

/** The single local data directory Tadori writes under a served repository. */
const DATA_DIR = ".tadori";

export interface RunPurgeDeps {
  stdout?(text: string): void;
  stderr?(text: string): void;
}

/**
 * Confinement audit (12-01): assert `target` resolves to a real path that is a
 * strict descendant of `root`. Both paths are resolved through the filesystem
 * (`realpathSync`) FIRST, so a symlinked `.tadori` that points outside the
 * repository is detected and refused — a purge must never delete anything
 * outside the repository root, even via a planted symlink.
 *
 * Returns the confined real path on success, or null when the target escapes,
 * does not exist, or equals the root itself (caller refuses to delete).
 */
export function confinedRealPath(target: string, root: string): string | null {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    // Target does not exist — not a violation, just nothing to confine/delete.
    return null;
  }
  const rel = path.relative(realRoot, realTarget);
  // Inside iff `rel` is a real descendant: not empty (== root itself), not an
  // ascent (`..`), not absolute (different drive/root). `root/.tadori` yields
  // rel ".tadori", a normal descendant.
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return realTarget;
}

/**
 * `tadori purge <repository>`: remove the repository's local `.tadori` data
 * directory (the SQLite DB, tour progress, any cached artifacts) — the
 * data-lifecycle "delete my local index" operation. Idempotent: a repo with no
 * `.tadori` reports "nothing to purge" and exits clean. Strictly confined: the
 * directory is deleted only after a real-path confinement audit proves it lies
 * inside the repository root, so a symlinked `.tadori` can never cause deletion
 * outside the repo. Never deletes the repository itself or any source file.
 */
export function runPurge(argv: readonly string[], deps: RunPurgeDeps = {}): number {
  const stdout = deps.stdout ?? ((t) => process.stdout.write(t));
  const stderr = deps.stderr ?? ((t) => process.stderr.write(t));

  const target = argv[0];
  if (target === undefined) {
    stderr("Usage: tadori purge <repository>\n");
    return PURGE_EXIT_UNSUPPORTED_REPOSITORY;
  }

  const resolved = resolveRepoRoot(target);
  if (!resolved.ok) {
    stderr(`${resolved.error}\n`);
    return PURGE_EXIT_UNSUPPORTED_REPOSITORY;
  }
  const root = resolved.root;
  const dataDir = path.join(root, DATA_DIR);

  if (!existsSync(dataDir)) {
    stdout(`Nothing to purge: no ${DATA_DIR} directory in ${root}.\n`);
    return PURGE_EXIT_CLEAN;
  }

  // Confinement audit before any deletion.
  const confined = confinedRealPath(dataDir, root);
  if (confined === null) {
    stderr(
      `Refusing to purge: ${path.join(root, DATA_DIR)} does not resolve to a path ` +
        `inside the repository root (possible symlink escape). Nothing was deleted.\n`
    );
    return PURGE_EXIT_CONFINEMENT_VIOLATION;
  }

  // Defense in depth: the confined real path must be a directory, never a file
  // or device, before a recursive remove.
  try {
    if (!statSync(confined).isDirectory()) {
      stderr(`Refusing to purge: ${confined} is not a directory. Nothing was deleted.\n`);
      return PURGE_EXIT_CONFINEMENT_VIOLATION;
    }
    rmSync(confined, { recursive: true, force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr(`Failed to purge ${confined}: ${message}\n`);
    return PURGE_EXIT_UNEXPECTED_ERROR;
  }

  stdout(`Purged ${DATA_DIR} data for ${root}.\n`);
  return PURGE_EXIT_CLEAN;
}
