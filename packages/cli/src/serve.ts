import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import open from "open";
import {
  findDanglingEndpoints,
  foreignKeyCheck,
  getSnapshot,
  openDatabase,
  runMigrations,
  type Database
} from "@tadori/store";
import { IncrementalRepositoryIndexer, indexRepositoryIntoStore } from "@tadori/indexer";
import { ConcurrentRefreshController } from "@tadori/mcp";
import { createServerApp } from "@tadori/server";
import { parseServeFlags, type ServeFlags } from "./flags.js";
import { resolveRepoRoot } from "./repoResolve.js";
import { loadServeConfig } from "./config.js";
import { renderStatusPage } from "./statusPage.js";

type ServerApp = Awaited<ReturnType<typeof createServerApp>>;

export interface StartupFacts {
  repoRoot: string;
  dbPath: string;
  snapshotId: number;
  indexState: "fresh" | "refreshed" | "rebuilt" | "stale";
  mode: "2d";
  port: number;
  url: string;
}

/** Exit codes per blueprint 07-02 §10/§17. */
export const EXIT_CLEAN = 0;
export const EXIT_UNEXPECTED_ERROR = 1;
export const EXIT_UNSUPPORTED_REPOSITORY = 2;
export const EXIT_INVALID_SNAPSHOT = 3;
export const EXIT_PORT_UNAVAILABLE = 4;

export interface RunServeDeps {
  /** Dependency-injected browser opener; tests stub this (no real browser in CI). */
  openBrowser?(url: string): Promise<unknown>;
  /** Test hook: signals to await instead of real OS signals. */
  signal?: AbortSignal;
  stdout?(text: string): void;
  stderr?(text: string): void;
}

function modeNotImplementedError(mode: ServeFlags["mode"]): string | null {
  if (mode === "2.5d") {
    return "Mode '2.5d' is not implemented until Phase 10 (10-01). Use --mode 2d.";
  }
  if (mode === "3d-experiment") {
    return "Mode '3d-experiment' is not implemented until Phase 10 (10-02). Use --mode 2d.";
  }
  return null;
}

/**
 * §8/§10: for an explicit `--port N`, verify the port is bindable on
 * 127.0.0.1 before building the server. Returns true if free, false on
 * EADDRINUSE (the only conflict we hard-fail on). Any other bind error is
 * rethrown to flow through the normal outer catch. The default `port 0`
 * case skips this entirely — the OS assigns an unused ephemeral port, so no
 * conflict is possible by construction (no port scanning; §8 rejected that).
 * Note: The TOCTOU gap between the probe and real listen is acceptable for a
 * single-user localhost dev tool; the listen-site catch below is the backstop.
 */
function probePortFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
      } else {
        reject(error);
      }
    });
    probe.listen({ host: "127.0.0.1", port }, () => {
      probe.close(() => resolve(true));
    });
  });
}

function portInUseMessage(port: number): string {
  return (
    `Port ${port} is already in use. Choose a different port with --port, ` +
    "or omit --port to let the OS pick one.\n"
  );
}

function printStartupFacts(facts: StartupFacts, write: (text: string) => void): void {
  write(
    `Tadori serving ${facts.repoRoot}\n` +
      `  Snapshot:  #${facts.snapshotId} (${facts.indexState})\n` +
      `  Mode:      ${facts.mode}\n` +
      `  URL:       ${facts.url}\n` +
      "Press Ctrl+C to stop.\n"
  );
}

/**
 * Implements the full 9-step `tadori serve <path>` lifecycle
 * (docs/CLI_CONTRACT.md). Returns the process exit code; the caller sets
 * `process.exitCode`.
 */
export async function runServe(argv: readonly string[], deps: RunServeDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
  const openBrowser = deps.openBrowser ?? ((url: string) => open(url));

  // Step 1: resolve repository.
  const inputPath = argv[0];
  if (inputPath === undefined) {
    stderr("Usage: tadori serve <repository> [options]\n");
    return EXIT_UNSUPPORTED_REPOSITORY;
  }
  const flagsResult = parseServeFlags(argv.slice(1));
  if (!flagsResult.ok) {
    stderr(`${flagsResult.error}\n`);
    return EXIT_UNEXPECTED_ERROR;
  }
  const flags = flagsResult.flags;

  const resolved = resolveRepoRoot(inputPath);
  if (!resolved.ok) {
    stderr(`${resolved.error}\n`);
    return EXIT_UNSUPPORTED_REPOSITORY;
  }
  const root = resolved.root;

  // Mode runtime rejection: fail fast, before any server starts (§11 step 8).
  const modeError = modeNotImplementedError(flags.mode);
  if (modeError !== null) {
    stderr(`${modeError}\n`);
    return EXIT_UNEXPECTED_ERROR;
  }

  // Step 2: load configuration.
  try {
    loadServeConfig(root);
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_UNEXPECTED_ERROR;
  }

  const dbPath = path.join(root, ".tadori", "tadori.sqlite");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db: Database = openDatabase(dbPath);
  runMigrations(db);

  let indexer: IncrementalRepositoryIndexer | null = null;
  let refresh: ConcurrentRefreshController | null = null;
  let app: ServerApp | null = null;
  let pinnedSnapshotId: number | null = null;

  interface CleanupFailure {
    stage: "server" | "refresh" | "indexer" | "database";
    error: unknown;
  }
  const cleanupResources = async (): Promise<CleanupFailure[]> => {
    const failures: CleanupFailure[] = [];
    const currentApp = app;
    app = null;
    if (currentApp) {
      try {
        await currentApp.close();
      } catch (error) {
        failures.push({ stage: "server", error });
        try {
          await currentApp.graphState.close();
          currentApp.server.closeAllConnections?.();
          if (currentApp.server.listening) {
            await new Promise<void>((resolve, reject) => {
              currentApp.server.close((closeError) =>
                closeError === undefined ? resolve() : reject(closeError)
              );
            });
          }
        } catch (fallbackError) {
          failures.push({ stage: "server", error: fallbackError });
        }
      }
    }
    try {
      await refresh?.stop();
    } catch (error) {
      failures.push({ stage: "refresh", error });
    } finally {
      refresh = null;
    }
    try {
      await indexer?.stop();
    } catch (error) {
      failures.push({ stage: "indexer", error });
    } finally {
      indexer = null;
    }
    try {
      db.close();
    } catch (error) {
      failures.push({ stage: "database", error });
    }
    return failures;
  };
  const closeAndExit = async (code: number): Promise<number> => {
    const failures = await cleanupResources();
    for (const failure of failures) {
      const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
      stderr(`Cleanup failed (${failure.stage}): ${message}\n`);
    }
    return failures.length === 0 ? code : EXIT_UNEXPECTED_ERROR;
  };

  try {
    let snapshotId: number;
    let indexState: StartupFacts["indexState"];

    if (flags.snapshotId !== null) {
      // Pinned --snapshot: validate instead of the working-tree reuse/refresh flow.
      const snapshot = getSnapshot(db, flags.snapshotId);
      const normalizedRoot = root.split(path.sep).join("/");
      const repository = db
        .prepare("SELECT id FROM repositories WHERE root_path = ?")
        .get(normalizedRoot) as { id: number } | undefined;
      if (
        !snapshot ||
        !repository ||
        snapshot.repo_id !== repository.id ||
        snapshot.status !== "active"
      ) {
        stderr(`Snapshot #${flags.snapshotId} does not exist.\n`);
        return await closeAndExit(EXIT_INVALID_SNAPSHOT);
      }
      const foreignKeys = foreignKeyCheck(db);
      if (foreignKeys.length > 0) {
        stderr(
          `Snapshot #${flags.snapshotId} failed validation: ` +
            `${foreignKeys.length} foreign-key violation(s).\n`
        );
        return await closeAndExit(EXIT_INVALID_SNAPSHOT);
      }
      const dangling = findDanglingEndpoints(db, snapshot.id);
      if (dangling.length > 0) {
        stderr(
          `Snapshot #${flags.snapshotId} failed validation: ` +
            `${dangling.length} dangling endpoint(s).\n`
        );
        return await closeAndExit(EXIT_INVALID_SNAPSHOT);
      }
      snapshotId = snapshot.id;
      pinnedSnapshotId = snapshot.id;
      indexState = "stale";
    } else {
      // Step 3: reuse/refresh/rebuild.
      indexer = new IncrementalRepositoryIndexer(db, root, { kind: "working_tree" });
      const initialHead = await indexer.initialize();
      if (flags.reindex) {
        await indexer.stop();
        indexer = null;
        const full = indexRepositoryIntoStore(db, root, {
          kind: "working_tree",
          extractCoChange: true
        });
        if (full.activationId === null) {
          stderr("Full reindex completed without a valid activation.\n");
          return await closeAndExit(EXIT_INVALID_SNAPSHOT);
        }
        snapshotId = full.snapshotId;
        indexState = "rebuilt";
        indexer = new IncrementalRepositoryIndexer(db, root, { kind: "working_tree" });
        await indexer.initialize();
      } else {
        snapshotId = initialHead.snapshot.id;
        // initialize() enqueues a rescan (phase "dirty") when restart
        // reconciliation found the workspace changed since the served head;
        // otherwise the served snapshot is fresh as-is. ASSUMPTION: this is
        // the cheapest honest signal available without blocking startup on
        // waitForIdle() (indexer.state() is a synchronous, already-public
        // read of internal reconciliation state set during initialize()).
        indexState = indexer.state().phase === "dirty" ? "refreshed" : "fresh";
      }

      // Step 4: validate.
      const violations = foreignKeyCheck(db);
      const dangling = findDanglingEndpoints(db, snapshotId);
      if (violations.length > 0 || dangling.length > 0) {
        stderr(
          "Snapshot validation failed " +
            `(${violations.length} foreign-key violation(s), ${dangling.length} dangling endpoint(s)); ` +
            "no prior valid snapshot to fall back to.\n"
        );
        return await closeAndExit(EXIT_INVALID_SNAPSHOT);
      }
    }

    // §8/§10: an explicit occupied `--port` fails hard (exit 4) BEFORE any
    // server routes or refresh worker are started (no partial startup). The
    // default (port 0) case is skipped — the OS always assigns a free port.
    if (flags.port !== null && !(await probePortFree(flags.port))) {
      stderr(portInUseMessage(flags.port));
      return await closeAndExit(EXIT_PORT_UNAVAILABLE);
    }

    // Step 5/6/7: start local API + status route + listen + open browser.
    // onError logs to stderr for the operator; the WS `watcher_error` frame is
    // emitted independently by GraphState's poll loop off refresh.state()'s
    // lastError transition (no CLI-side broadcast wiring needed — see §21).
    refresh = await ConcurrentRefreshController.start(db, root, {
      onError: (error) => stderr(`Tadori refresh worker failed: ${error.message}\n`)
    });
    app = await createServerApp({
      db,
      repoRoot: root,
      refresh,
      ...(pinnedSnapshotId === null ? {} : { snapshotId: pinnedSnapshotId })
    });
    app.get("/", async (_request, reply) => {
      return reply.type("text/html").send(
        renderStatusPage({ repoRoot: root, snapshotId, indexState, mode: "2d" })
      );
    });
    // §11 step 1 carve-out: the listen call gets its own try/catch for the
    // exit-4 path (backstop for the probe's TOCTOU gap). Every other startup
    // error still flows through the outer catch unchanged.
    try {
      await app.listen({ host: "127.0.0.1", port: flags.port ?? 0 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE" && flags.port !== null) {
        stderr(portInUseMessage(flags.port));
        return await closeAndExit(EXIT_PORT_UNAVAILABLE);
      }
      throw error;
    }
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an AddressInfo from app.server.address()");
    }
    const port = address.port;
    const url = `http://127.0.0.1:${port}/`;

    if (flags.open) {
      try {
        await openBrowser(url);
      } catch {
        stderr(`Could not open a browser automatically. Open ${url} manually.\n`);
      }
    }

    const facts: StartupFacts = { repoRoot: root, dbPath, snapshotId, indexState, mode: "2d", port, url };
    printStartupFacts(facts, stdout);

    // Step 9: teardown on SIGINT/SIGTERM, exact order (§12).
    return await new Promise<number>((resolve) => {
      let shuttingDown = false;
      const teardown = async (): Promise<void> => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        // app.close() drains HTTP/WS, followed by refresh/indexer shutdown and
        // database close. Each stage is attempted even when an earlier stage
        // fails, so a close error cannot orphan the worker or hang shutdown.
        resolve(await closeAndExit(EXIT_CLEAN));
      };
      if (deps.signal) {
        if (deps.signal.aborted) {
          void teardown();
        } else {
          deps.signal.addEventListener("abort", () => void teardown(), { once: true });
        }
      } else {
        process.once("SIGINT", () => void teardown());
        process.once("SIGTERM", () => void teardown());
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isPortError =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EADDRINUSE";
    if (isPortError) {
      // Explicit-port conflicts are handled at the probe/listen carve-out
      // above with §10's exact message; this branch is the residual backstop
      // (e.g. a surprising EADDRINUSE from a non-listen call). Reuse the same
      // §10 string when a port was pinned, else a generic port message.
      stderr(flags.port !== null ? portInUseMessage(flags.port) : `Port unavailable: ${message}\n`);
      return await closeAndExit(EXIT_PORT_UNAVAILABLE);
    }
    stderr(`${message}\n`);
    return await closeAndExit(EXIT_UNEXPECTED_ERROR);
  }
}
