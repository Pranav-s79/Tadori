import { runDiff } from "../packages/cli/src/diff.ts";
import { runServe } from "../packages/cli/src/index.ts";
import { runPurge } from "../packages/cli/src/purge.ts";

function usage(): never {
  throw new Error("Usage: tadori <diff|serve|purge> <repository> [options]");
}

const args = process.argv.slice(2);

if (args[0] === "diff") {
  process.exitCode = await runDiff(args.slice(1));
} else if (args[0] === "serve") {
  process.exitCode = await runServe(args.slice(1));
} else if (args[0] === "purge") {
  process.exitCode = runPurge(args.slice(1));
} else {
  usage();
}
