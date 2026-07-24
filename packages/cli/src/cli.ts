import { pathToFileURL } from "node:url";
import { runPurge } from "./purge.js";
import { runServe } from "./serve.js";

/**
 * Thin executable entry. Mirrors the eventual `bin` shape 12-03 will wire,
 * but invoked directly via `tsx` in this phase — no `bin` field yet (§8).
 */
export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (command === "serve") {
    return runServe(argv.slice(1));
  }
  if (command === "purge") {
    // Synchronous data-lifecycle command (12-01): delete the repo's local
    // .tadori data directory, confinement-audited. No server, no async work.
    return runPurge(argv.slice(1));
  }
  process.stderr.write("Usage: tadori serve <repository> [options]\n");
  process.stderr.write("       tadori purge <repository>\n");
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
