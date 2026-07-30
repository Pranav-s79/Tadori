import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runDiff } from "./diff.js";
import { runPurge } from "./purge.js";
import { runServe } from "./serve.js";

/** Shared executable entry for the generated package's `tadori` binary. */
export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command === "diff") {
    return runDiff(argv.slice(1));
  }
  if (command === "serve") {
    return runServe(argv.slice(1));
  }
  if (command === "purge") {
    // Synchronous data-lifecycle command (12-01): delete the repo's local
    // .tadori data directory, confinement-audited. No server, no async work.
    return runPurge(argv.slice(1));
  }
  process.stderr.write("Usage: tadori diff <repository> [--db <database>]\n");
  process.stderr.write("       tadori serve <repository> [options]\n");
  process.stderr.write("       tadori purge <repository>\n");
  return 1;
}

/**
 * Node may expose one executable through different filesystem aliases. macOS,
 * for example, commonly reports `/var/...` in argv while import.meta.url uses
 * the canonical `/private/var/...`. Compare canonical native paths so an
 * installed binary still dispatches when npm's prefix lives below that alias.
 */
export function isDirectExecution(moduleUrl: string, argvPath: string): boolean {
  try {
    return realpathSync.native(fileURLToPath(moduleUrl)) === realpathSync.native(argvPath);
  } catch {
    return false;
  }
}

if (process.argv[1] !== undefined && isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
