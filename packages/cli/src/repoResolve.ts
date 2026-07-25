import { existsSync } from "node:fs";
import path from "node:path";
import { scanRepository } from "@tadori/indexer";

export type ResolveRepoRootResult = { ok: true; root: string } | { ok: false; error: string };

/**
 * Resolves `<path>` (CLI_CONTRACT.md step 1) to a repository root. A
 * supported repository contains at least one registered source, interface,
 * documentation, manifest, or configuration file. A missing path is distinct.
 */
export function resolveRepoRoot(inputPath: string): ResolveRepoRootResult {
  const root = path.resolve(inputPath);
  if (!existsSync(root)) {
    return { ok: false, error: `'${root}' does not exist.` };
  }
  const scan = scanRepository(root);
  if (scan.indexedFiles.length === 0 && scan.supportFiles.length === 0) {
    return {
      ok: false,
      error:
        `'${root}' does not contain any supported or structurally indexable files.`
    };
  }
  return { ok: true, root };
}
