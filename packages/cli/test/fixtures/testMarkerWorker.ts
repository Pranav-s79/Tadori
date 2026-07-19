import { writeFileSync } from "node:fs";
import { runServe } from "../../src/serve.js";

/**
 * Test-only spawn target for `orphan-supervision.test.ts` (blueprint §9).
 * NOT imported by any production code and excluded from the published
 * `@tadori/cli` surface (`main`/`types` point at `src/index.ts` only).
 *
 * Invocation: `tsx testMarkerWorker.ts <repoRoot> <markerFile>`.
 * - Writes `<markerFile>` containing "ready\n" once the HTTP server is
 *   listening (i.e. the refresh worker thread has started), so the test can
 *   wait for a fully-started process before applying its exit trigger.
 * - Appends "exit\n" to `<markerFile>` when `runServe` resolves through the
 *   clean SIGINT/SIGTERM teardown path (graceful cases only; an ungraceful
 *   SIGKILL of this process runs no code, by design).
 * - Prints "READY <pid>\n" to stdout so the parent test can capture this
 *   process's PID for the OS-level `tasklist`/`ps` orphan assertion.
 */
async function main(): Promise<void> {
  const repoRoot = process.argv[2];
  const markerFile = process.argv[3];
  if (repoRoot === undefined || markerFile === undefined) {
    process.stderr.write("Usage: testMarkerWorker <repoRoot> <markerFile>\n");
    process.exitCode = 64;
    return;
  }

  let readyAnnounced = false;
  const onStdout = (text: string): void => {
    process.stdout.write(text);
    if (!readyAnnounced && text.includes("URL:")) {
      readyAnnounced = true;
      writeFileSync(markerFile, "ready\n");
      process.stdout.write(`READY ${process.pid}\n`);
    }
  };

  const exitCode = await runServe([repoRoot, "--port", "0", "--no-open"], {
    openBrowser: async () => undefined,
    stdout: onStdout,
    stderr: (text) => process.stderr.write(text)
  });

  writeFileSync(markerFile, "ready\nexit\n");
  process.exitCode = exitCode;
}

await main();
