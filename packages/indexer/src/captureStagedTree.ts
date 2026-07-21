import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Raised when `git` is not on PATH / not runnable. */
export class GitUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("git is not available on this system (required for staged comparison)");
    this.name = "GitUnavailableError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/** Raised when `rootPath` is not inside a git repository. */
export class NotAGitRepositoryError extends Error {
  constructor(rootPath: string) {
    super(`not a git repository: ${rootPath}`);
    this.name = "NotAGitRepositoryError";
  }
}

/** Raised when the staged index cannot be materialized (invalid index, checkout failure). */
export class StagedCaptureFailedError extends Error {
  constructor(detail: string, cause?: unknown) {
    super(`failed to capture the staged tree: ${detail}`);
    this.name = "StagedCaptureFailedError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * A materialized staged-index tree on disk plus a disposer. The staged (index)
 * contents of every tracked file are written to `dir`; unstaged working-tree
 * modifications are NOT reflected (that is the whole point — this is the git
 * index, not the working tree). `dispose()` removes the temp dir and is safe to
 * call more than once.
 */
export interface StagedTreeCapture {
  dir: string;
  dispose(): void;
}

/**
 * All git invocations: no shell (`execFile`), arguments always passed as an
 * array, never an interpolated command string — so a filename with spaces or
 * shell metacharacters can never be interpreted as a command. `cwd` is the
 * repo root; the working tree and index are never mutated (checkout-index
 * writes only into the isolated `--prefix` directory).
 */
async function git(rootPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: rootPath,
      shell: false,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
    return stdout;
  } catch (err) {
    // ENOENT means the git binary itself is missing.
    if (err !== null && typeof err === "object" && (err as { code?: unknown }).code === "ENOENT") {
      throw new GitUnavailableError(err);
    }
    throw err;
  }
}

async function assertGitRepository(rootPath: string): Promise<void> {
  let out: string;
  try {
    out = await git(rootPath, ["rev-parse", "--is-inside-work-tree"]);
  } catch (err) {
    if (err instanceof GitUnavailableError) {
      throw err;
    }
    // A non-zero exit here (fatal: not a git repository) is the not-a-repo case.
    throw new NotAGitRepositoryError(rootPath);
  }
  if (out.trim() !== "true") {
    throw new NotAGitRepositoryError(rootPath);
  }
}

/**
 * Materialize the current git index (the staged tree) into an isolated
 * temporary directory using `git checkout-index -a --prefix=<dir>/`, then hand
 * the caller that directory to index through the normal snapshot path. The
 * working tree and index are never modified.
 *
 * The caller MUST dispose the returned capture; do so in a `finally` so the
 * temp dir is cleaned on success, failure, and cancellation alike. On any
 * failure while capturing, the partially-created temp dir is cleaned before the
 * error propagates.
 */
export async function captureStagedTree(rootPath: string): Promise<StagedTreeCapture> {
  const root = path.resolve(rootPath);
  await assertGitRepository(root);

  const dir = mkdtempSync(path.join(tmpdir(), "tadori-staged-"));
  const dispose = (): void => {
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    // checkout-index writes each indexed path under `<prefix><path>`. The
    // prefix MUST end with the platform path separator, else git concatenates
    // it directly onto the filename (writing siblings of `dir`, not children).
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    await git(root, ["checkout-index", "-a", "-f", `--prefix=${prefix}`]);
    return { dir, dispose };
  } catch (err) {
    dispose();
    if (err instanceof GitUnavailableError || err instanceof NotAGitRepositoryError) {
      throw err;
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new StagedCaptureFailedError(detail, err);
  }
}
