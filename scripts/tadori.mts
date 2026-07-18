import path from "node:path";
import { mkdirSync } from "node:fs";
import { diffWorkingTree } from "../packages/indexer/src/index.ts";
import { openDatabase, runMigrations } from "../packages/store/src/index.ts";
import { runServe } from "../packages/cli/src/index.ts";

function usage(): never {
  throw new Error("Usage: tadori <diff|serve> <repository> [options]");
}

const args = process.argv.slice(2);

if (args[0] === "diff") {
  if (args[1] === undefined) {
    usage();
  }
  const root = path.resolve(args[1]);
  let dbPath = path.join(root, ".tadori", "tadori.sqlite");
  for (let index = 2; index < args.length; index += 1) {
    if (args[index] !== "--db" || args[index + 1] === undefined || index + 2 !== args.length) {
      usage();
    }
    dbPath = path.resolve(args[index + 1] as string);
    index += 1;
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  try {
    runMigrations(db);
    const result = await diffWorkingTree(db, root);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
} else if (args[0] === "serve") {
  process.exitCode = await runServe(args.slice(1));
} else {
  usage();
}
