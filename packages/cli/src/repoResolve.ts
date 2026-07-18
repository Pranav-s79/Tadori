import { existsSync } from "node:fs";
import path from "node:path";

export type ResolveRepoRootResult = { ok: true; root: string } | { ok: false; error: string };

/**
 * Resolves `<path>` (CLI_CONTRACT.md step 1) to a repository root. A
 * supported repository has a `package.json` or a `tsconfig.json` at its
 * resolved root; a path that does not exist at all is a distinct error.
 */
export function resolveRepoRoot(inputPath: string): ResolveRepoRootResult {
  const root = path.resolve(inputPath);
  if (!existsSync(root)) {
    return { ok: false, error: `'${root}' does not exist.` };
  }
  const hasPackageJson = existsSync(path.join(root, "package.json"));
  const hasTsconfig = existsSync(path.join(root, "tsconfig.json"));
  if (!hasPackageJson && !hasTsconfig) {
    return {
      ok: false,
      error:
        `'${root}' is not a supported TypeScript/JavaScript repository ` +
        "(no package.json or tsconfig.json found at the repository root)."
    };
  }
  return { ok: true, root };
}
