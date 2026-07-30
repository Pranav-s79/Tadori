/** Machine-variance benchmark; CI-excluded. */
import { create150kCorpus, loadPackageMapInBrowser, removeCorpus, startServe } from "./lib/serveBenchmark.mts";

const BUDGET_BYTES = 500 * 1024 * 1024;
const corpus = create150kCorpus("tadori-serve-memory-");
let serve: Awaited<ReturnType<typeof startServe>> | null = null;
let browser: Awaited<ReturnType<typeof loadPackageMapInBrowser>> | null = null;
try {
  serve = await startServe(corpus.root);
  browser = await loadPackageMapInBrowser(serve.url);
  const result = { level: "package", approximateLoc: corpus.approximateLoc, heapBytes: browser.heapBytes };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (browser.heapBytes >= BUDGET_BYTES) {
    throw new Error(`Package browser heap ${String(browser.heapBytes)} bytes exceeds ${String(BUDGET_BYTES)} bytes`);
  }
} finally {
  await browser?.close();
  await serve?.stop();
  removeCorpus(corpus);
}
