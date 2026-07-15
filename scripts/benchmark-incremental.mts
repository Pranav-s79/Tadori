import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  IncrementalRepositoryIndexer,
  indexRepositoryIntoStore
} from "../packages/indexer/src/index.ts";
import { openDatabase, runMigrations } from "../packages/store/src/index.ts";

const FILE_COUNT = 250;
const LINES_PER_FILE = 1_000;
const CHAIN_COUNT = 40;
const ITERATIONS = 12;

function percentile95(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate p95 of an empty sample");
  }
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] as number;
}

function pageBytes(db: ReturnType<typeof openDatabase>): number {
  const pageCount = db.pragma("page_count", { simple: true }) as number;
  const pageSize = db.pragma("page_size", { simple: true }) as number;
  return pageCount * pageSize;
}

function writeLeaf(root: string, index: number, revision: number): void {
  const comments = Array.from(
    { length: LINES_PER_FILE - 2 },
    (_, line) => `// corpus ${index} line ${line}`
  );
  const name = `value${String(index).padStart(3, "0")}`;
  writeFileSync(
    path.join(root, "src", `f${String(index).padStart(3, "0")}.ts`),
    [...comments, `export function ${name}(): number { return ${revision}; }`, ""].join("\n")
  );
}

function writeChain(root: string, index: number, revision: number): void {
  const next = index + 1;
  const source =
    next < CHAIN_COUNT
      ? `import { chain${next} } from "./chain${next}.js";\nexport function chain${index}(): number { return chain${next}(); }\n`
      : `export function chain${index}(): number { return ${revision}; }\n`;
  writeFileSync(path.join(root, "src", `chain${index}.ts`), source);
}

const root = mkdtempSync(path.join(tmpdir(), "tadori-incremental-benchmark-"));
const sourceRoot = path.join(root, "src");
mkdirSync(sourceRoot);
writeFileSync(path.join(root, "package.json"), '{"name":"benchmark-corpus"}\n');
writeFileSync(
  path.join(root, "tsconfig.json"),
  '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true},"include":["src"]}\n'
);
for (let index = 0; index < FILE_COUNT; index += 1) {
  writeLeaf(root, index, 0);
}
for (let index = 0; index < CHAIN_COUNT; index += 1) {
  writeChain(root, index, 0);
}
const exports = Array.from(
  { length: FILE_COUNT },
  (_, index) =>
    `export { value${String(index).padStart(3, "0")} } from "./f${String(index).padStart(3, "0")}.js";`
);
writeFileSync(path.join(sourceRoot, "index.ts"), `${exports.join("\n")}\n`);

const databasePath = path.join(root, ".tadori", "benchmark.sqlite");
mkdirSync(path.dirname(databasePath));
const db = openDatabase(databasePath);
runMigrations(db);
let indexer: IncrementalRepositoryIndexer | null = null;
try {
  const heapBefore = process.memoryUsage().heapUsed;
  const coldStartedAt = performance.now();
  const initial = indexRepositoryIntoStore(db, root, { kind: "working_tree" });
  const coldFullMs = performance.now() - coldStartedAt;
  const heapAfterCold = process.memoryUsage().heapUsed;
  const databaseBytesBeforeRefreshes = pageBytes(db);

  indexer = new IncrementalRepositoryIndexer(db, root);
  await indexer.initialize();

  const oneFileMs: number[] = [];
  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    writeLeaf(root, 0, iteration);
    const startedAt = performance.now();
    const state = await indexer.refresh([{ path: "src/f000.ts", kind: "change" }]);
    if (state.phase !== "idle") {
      throw state.lastError ?? new Error("One-file refresh did not return to idle");
    }
    oneFileMs.push(performance.now() - startedAt);
  }

  writeChain(root, CHAIN_COUNT - 1, 1);
  let startedAt = performance.now();
  const dependency = await indexer.refresh([
    { path: `src/chain${CHAIN_COUNT - 1}.ts`, kind: "change" }
  ]);
  const dependencyRegionMs = performance.now() - startedAt;

  writeFileSync(path.join(sourceRoot, "index.ts"), `${exports.slice(1).join("\n")}\n`);
  startedAt = performance.now();
  const barrel = await indexer.refresh([{ path: "src/index.ts", kind: "change" }]);
  const largeBarrelMs = performance.now() - startedAt;

  writeFileSync(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true},"include":["src"],"exclude":[]}\n'
  );
  startedAt = performance.now();
  const packageRefresh = await indexer.refresh([{ path: "tsconfig.json", kind: "change" }]);
  const packageInvalidationMs = performance.now() - startedAt;

  const databaseBytesAfterRefreshes = pageBytes(db);
  const heapAfterRefreshes = process.memoryUsage().heapUsed;
  const result = {
    corpus: {
      approximateLoc: FILE_COUNT * LINES_PER_FILE + CHAIN_COUNT * 2 + FILE_COUNT,
      files: FILE_COUNT + CHAIN_COUNT + 1,
      iterations: ITERATIONS,
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`
    },
    coldFullMs,
    coldSnapshotId: initial.snapshotId,
    singleFile: {
      p95Ms: percentile95(oneFileMs),
      minMs: Math.min(...oneFileMs),
      maxMs: Math.max(...oneFileMs),
      samplesMs: oneFileMs
    },
    dependencyRegion: {
      durationMs: dependencyRegionMs,
      mode: dependency.lastRefresh?.mode,
      affectedFiles: dependency.lastRefresh?.affectedPaths.length
    },
    largeBarrel: {
      durationMs: largeBarrelMs,
      mode: barrel.lastRefresh?.mode,
      affectedFiles: barrel.lastRefresh?.affectedPaths.length
    },
    packageInvalidation: {
      durationMs: packageInvalidationMs,
      mode: packageRefresh.lastRefresh?.mode,
      affectedFiles: packageRefresh.lastRefresh?.affectedPaths.length
    },
    memory: {
      heapBeforeBytes: heapBefore,
      heapAfterColdBytes: heapAfterCold,
      heapAfterRefreshesBytes: heapAfterRefreshes,
      heapGrowthBytes: heapAfterRefreshes - heapBefore
    },
    database: {
      bytesBeforeRefreshes: databaseBytesBeforeRefreshes,
      bytesAfterRefreshes: databaseBytesAfterRefreshes,
      growthBytes: databaseBytesAfterRefreshes - databaseBytesBeforeRefreshes,
      snapshotCount: (
        db.prepare("SELECT COUNT(*) AS count FROM repository_snapshots").get() as {
          count: number;
        }
      ).count
    }
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.singleFile.p95Ms >= 2_000) {
    throw new Error(`Single-file p95 ${result.singleFile.p95Ms.toFixed(1)}ms exceeds 2000ms`);
  }
  if (packageInvalidationMs >= 10_000) {
    throw new Error(`Package invalidation ${packageInvalidationMs.toFixed(1)}ms exceeds 10000ms`);
  }
  if (result.memory.heapGrowthBytes >= 512 * 1024 * 1024) {
    throw new Error("Incremental benchmark heap growth exceeds the documented 512 MiB ceiling");
  }
  const databaseGrowthPerSnapshot =
    result.database.growthBytes / Math.max(1, result.database.snapshotCount - 1);
  if (databaseGrowthPerSnapshot >= 2 * 1024 * 1024) {
    throw new Error("Database growth exceeds the documented 2 MiB per-snapshot ceiling");
  }
} finally {
  await indexer?.stop();
  db.close();
  rmSync(root, { recursive: true, force: true });
}
