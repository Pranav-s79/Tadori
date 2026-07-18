import { pathToFileURL } from "node:url";
import { runServe } from "./serve.js";

/**
 * Thin executable entry. Mirrors the eventual `bin` shape 12-03 will wire,
 * but invoked directly via `tsx` in this phase — no `bin` field yet (§8).
 */
export async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] !== "serve") {
    process.stderr.write("Usage: tadori serve <repository> [options]\n");
    return 1;
  }
  return runServe(argv.slice(1));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
