/**
 * Safe `vscode://file/...` deep-link construction for inspected entities.
 *
 * Tadori is inspect-only and localhost-first; a deep link is the one outward
 * action the panel offers, so its target MUST be confined to the repository
 * root. The server (`GraphService.resolveSnapshotPath`, service.ts:168-192) is
 * the enforcing boundary, but this builder independently refuses any path that
 * escapes the root as client-side defense in depth — a non-confined result
 * yields `null`, and the caller renders NO link element at all (never a link
 * with a dangerous href).
 *
 * `isRootConfined` is a pure string check (the browser has no filesystem
 * access): a repo-relative file is confined iff, once normalized, no path
 * segment climbs above the root via `..` and it is not itself absolute. It
 * mirrors the *intent* of the server's `..`-segment rejection without doing any
 * real path resolution.
 */

/** Segments that would escape or destabilize the repo-relative path. */
function isEscapingSegment(segment: string): boolean {
  return segment === "..";
}

/**
 * True iff `repoRelativeFile` stays within the repository root. Rejects: an
 * empty path, an absolute path (POSIX `/…` or Windows `C:\…` / `\\…`), and any
 * path containing a `..` segment (before or after normalization of separators).
 * A leading `./` and redundant `/` are tolerated (they do not escape).
 */
export function isRootConfined(repoRelativeFile: string): boolean {
  if (repoRelativeFile.length === 0) {
    return false;
  }
  // Absolute POSIX, Windows drive, or UNC paths are never repo-relative.
  if (repoRelativeFile.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(repoRelativeFile) || repoRelativeFile.startsWith("\\\\")) {
    return false;
  }
  const segments = repoRelativeFile.split(/[\\/]+/);
  return !segments.some(isEscapingSegment);
}

/**
 * Join a repository root and a repo-relative file into a `vscode://file/...`
 * URL, or return `null` if the file is not root-confined. The path is
 * percent-encoded per segment (spaces/special chars are encoded; separators are
 * preserved). `rootAbsolutePath` may be a POSIX or Windows absolute path; both
 * produce the documented `vscode://file/<encoded-abs-path>[:line]` shape with
 * forward slashes.
 */
export function buildDeepLink(
  rootAbsolutePath: string,
  repoRelativeFile: string,
  line?: number | null
): string | null {
  if (!isRootConfined(repoRelativeFile)) {
    return null;
  }
  const normalizedRoot = rootAbsolutePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedFile = repoRelativeFile.replace(/\\/g, "/").replace(/^\.\//, "");
  const joined = `${normalizedRoot}/${normalizedFile}`;
  // Encode each segment but keep the `/` separators and a leading Windows drive.
  const encoded = joined
    .split("/")
    .map((segment) => (/^[a-zA-Z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join("/");
  const suffix = typeof line === "number" && line > 0 ? `:${line}` : "";
  return `vscode://file/${encoded}${suffix}`;
}
