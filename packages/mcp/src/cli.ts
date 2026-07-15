import path from "node:path";
import { openDatabase, runMigrations } from "@tadori/store";
import { startStdioServer } from "./stdio.js";

interface CliOptions {
  dbPath: string;
  repoRoot: string;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  let dbPath: string | null = null;
  let repoRoot: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if ((argument === "--db" || argument === "--repo") && value === undefined) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === "--db") {
      dbPath = path.resolve(value!);
      index += 1;
    } else if (argument === "--repo") {
      repoRoot = path.resolve(value!);
      index += 1;
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(argument)}`);
    }
  }
  if (dbPath === null || repoRoot === null) {
    throw new Error("Usage: tadori-mcp --db <sqlite-path> --repo <repository-root>");
  }
  return { dbPath, repoRoot };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const db = openDatabase(options.dbPath);
  runMigrations(db);
  const runtime = await startStdioServer({ db, repoRoot: options.repoRoot });
  let shuttingDown = false;
  const shutdown = async (status: "completed" | "aborted"): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      await runtime.close(status);
    } finally {
      db.close();
    }
  };
  process.stdin.once("end", () => void shutdown("completed"));
  process.once("SIGINT", () => void shutdown("aborted"));
  process.once("SIGTERM", () => void shutdown("aborted"));
  process.once("exit", () => runtime.finalize("aborted"));
}

void main().catch((error: unknown) => {
  process.stderr.write(`Tadori MCP failed: ${String(error)}\n`);
  process.exitCode = 1;
});
