import { mkdirSync } from "node:fs";
import path from "node:path";
import { diffWorkingTree } from "@tadori/indexer";
import { openDatabase, runMigrations } from "@tadori/store";

export interface RunDiffDeps {
  stdout?(text: string): void;
  stderr?(text: string): void;
}

/**
 * Capture the current working tree and print its graph diff. This is shared by
 * the workspace entry and the packaged binary so the two command surfaces
 * cannot drift.
 */
export async function runDiff(
  argv: readonly string[],
  deps: RunDiffDeps = {}
): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const repository = argv[0];
  if (repository === undefined) {
    stderr("Usage: tadori diff <repository> [--db <database>]\n");
    return 1;
  }

  const root = path.resolve(repository);
  let dbPath = path.join(root, ".tadori", "tadori.sqlite");
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] !== "--db" || argv[index + 1] === undefined || index + 2 !== argv.length) {
      stderr("Usage: tadori diff <repository> [--db <database>]\n");
      return 1;
    }
    dbPath = path.resolve(argv[index + 1] as string);
    index += 1;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
    const result = await diffWorkingTree(db, root);
    stdout(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } finally {
    db.close();
  }
}
