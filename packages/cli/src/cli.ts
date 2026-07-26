import { pathToFileURL } from "node:url";
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
