/** Machine-variance benchmark; CI-excluded. */
import { performance } from "node:perf_hooks";
import { create150kCorpus, loadPackageMapInBrowser, removeCorpus, startServe } from "./lib/serveBenchmark.mts";

const BUDGET_MS = 5_000;
const corpus = create150kCorpus("tadori-serve-coldstart-");
const startedAt = performance.now();
let serve: Awaited<ReturnType<typeof startServe>> | null = null;
let browser: Awaited<ReturnType<typeof loadPackageMapInBrowser>> | null = null;
try {
  serve = await startServe(corpus.root);
  const serveStartMs = performance.now() - startedAt;
  browser = await loadPackageMapInBrowser(serve.url);
  const elapsedMs = performance.now() - startedAt;
  const result = { approximateLoc: corpus.approximateLoc, serveStartMs, interactiveMs: elapsedMs, elapsedMs };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (elapsedMs >= BUDGET_MS) {
    throw new Error(`Cold package-map interactive time ${elapsedMs.toFixed(1)}ms exceeds ${String(BUDGET_MS)}ms`);
  }
} finally {
  await browser?.close();
  await serve?.stop();
  removeCorpus(corpus);
}
