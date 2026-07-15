import path from "node:path";
import { mkdirSync } from "node:fs";
import { diffWorkingTree } from "../packages/indexer/src/index.ts";
import { openDatabase, runMigrations } from "../packages/store/src/index.ts";

function usage(): never {
  throw new Error("Usage: tadori diff <repository> [--db <sqlite-path>]");
}

const args = process.argv.slice(2);
if (args[0] !== "diff" || args[1] === undefined) {
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
