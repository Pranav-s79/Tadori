import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { indexRepositoryIntoStore } from "@tadori/indexer";
import { ConcurrentRefreshController } from "@tadori/mcp";
import { openDatabase, runMigrations, type Database } from "@tadori/store";
import { createServerApp } from "../src/app.js";

/**
 * Proxy corpus, per §16: reusing scripts/benchmark-incremental.mts's exact
 * generator inside a vitest file (writing to mkdtempSync, wired as a
 * standalone script) is impractical within one session, so this test builds
 * a smaller synthetic fixture with the SAME generator shape (a leaf-file
 * corpus with sequential exported functions), scaling the row/node/edge
 * counts down proportionally and recording the measured ratio here.
 *
 * Corpus sizing: 25 files x 1,000 lines/file = 25,000 LOC (>= 20,000 LOC
 * floor per §16) plus a 10-function import chain. This is 25,000 / 250,000
 * = 1/10 of the full benchmark corpus (exactly the documented minimum
 * ratio), justified because a smaller in-process vitest run must stay well
 * under the suite's default test timeout while still exercising a
 * non-trivial in-memory GraphService.graph (thousands of nodes/edges) for
 * the /nodes?level=package p95 budget.
 *
 * Budget: scaled proportionally to 20ms (200ms / 10, matching the 1/10
 * corpus ratio) rather than kept at the full 200ms — measured p95 against
 * this proxy corpus is consistently ~1-11ms (see the logged line below),
 * so 20ms still carries comfortable headroom while being an honest budget
 * for this corpus size rather than a 10x-lenient one relative to the title.
 */
const FILE_COUNT = 25;
const LINES_PER_FILE = 1_000;
const CHAIN_COUNT = 10;
const PROXY_LOC = FILE_COUNT * LINES_PER_FILE + CHAIN_COUNT * 2;
const FULL_BENCHMARK_LOC = 250 * 1_000 + 40 * 2;
const SCALING_RATIO = PROXY_LOC / FULL_BENCHMARK_LOC;
const FULL_BENCHMARK_BUDGET_MS = 200;
const SCALED_BUDGET_MS = Math.round(FULL_BENCHMARK_BUDGET_MS * SCALING_RATIO);

function writeLeaf(root: string, index: number): void {
  const comments = Array.from(
    { length: LINES_PER_FILE - 2 },
    (_, line) => `// corpus ${index} line ${line}`
  );
  const name = `value${String(index).padStart(3, "0")}`;
  writeFileSync(
    path.join(root, "src", `f${String(index).padStart(3, "0")}.ts`),
    [...comments, `export function ${name}(): number { return ${index}; }`, ""].join("\n")
  );
}

function writeChain(root: string, index: number): void {
  const next = index + 1;
  const source =
    next < CHAIN_COUNT
      ? `import { chain${next} } from "./chain${next}.js";\nexport function chain${index}(): number { return chain${next}(); }\n`
      : `export function chain${index}(): number { return 0; }\n`;
  writeFileSync(path.join(root, "src", `chain${index}.ts`), source);
}

function percentile95(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] as number;
}

let tempDir: string | null = null;
let db: Database | null = null;
let refresh: ConcurrentRefreshController | null = null;

afterAll(async () => {
  await refresh?.stop();
  db?.close();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("performance budget", () => {
  it(
    `/nodes?level=package p95 < ${SCALED_BUDGET_MS}ms against a ${PROXY_LOC.toLocaleString()}-LOC proxy corpus ` +
      `(${(SCALING_RATIO * 100).toFixed(1)}% of the 250k-LOC benchmark, budget scaled from the full ${FULL_BENCHMARK_BUDGET_MS}ms)`,
    async () => {
      tempDir = mkdtempSync(path.join(tmpdir(), "tadori-server-perf-"));
      const repoRoot = path.join(tempDir, "repo");
      const sourceRoot = path.join(repoRoot, "src");
      mkdirSync(sourceRoot, { recursive: true });
      writeFileSync(path.join(repoRoot, "package.json"), '{"name":"server-perf-corpus"}\n');
      writeFileSync(
        path.join(repoRoot, "tsconfig.json"),
        '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","strict":true},"include":["src"]}\n'
      );
      for (let index = 0; index < FILE_COUNT; index += 1) {
        writeLeaf(repoRoot, index);
      }
      for (let index = 0; index < CHAIN_COUNT; index += 1) {
        writeChain(repoRoot, index);
      }

      const dbPath = path.join(tempDir, "tadori.sqlite");
      db = openDatabase(dbPath);
      runMigrations(db);
      indexRepositoryIntoStore(db, repoRoot, { kind: "working_tree" });
      refresh = await ConcurrentRefreshController.start(db, repoRoot);
      const app = await createServerApp({ db, repoRoot, refresh });

      const samples: number[] = [];
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const startedAt = performance.now();
        const response = await app.inject({ method: "GET", url: "/api/v1/nodes?level=package&limit=500" });
        samples.push(performance.now() - startedAt);
        expect(response.statusCode).toBe(200);
      }

      const p95 = percentile95(samples);
      const median = samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)];
      console.log(
        `[performance] proxy corpus ${PROXY_LOC} LOC (ratio ${SCALING_RATIO.toFixed(3)} of 250k benchmark), ` +
          `budget ${SCALED_BUDGET_MS}ms (scaled from ${FULL_BENCHMARK_BUDGET_MS}ms), ` +
          `/nodes?level=package median=${median?.toFixed(2)}ms p95=${p95.toFixed(2)}ms over ${samples.length} inject() calls`
      );
      expect(p95).toBeLessThan(SCALED_BUDGET_MS);

      await app.close();
    },
    60_000
  );
});
