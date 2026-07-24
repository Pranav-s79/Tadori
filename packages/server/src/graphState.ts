import type { RepoStateKind } from "@tadori/core";
import type { RefreshPhase } from "@tadori/indexer";
import type { Database } from "@tadori/store";
import type { ConcurrentRefreshController } from "@tadori/mcp";
import { EventLog, GraphService, TadoriTools } from "@tadori/mcp";
import type { ObservationEvent } from "./types.js";

/**
 * Mirrors `ConcurrentRefreshController.state()`'s return shape
 * (`@tadori/mcp`'s `refreshProtocol.ts` `SerializedRefreshState`, not
 * re-exported from the mcp package's barrel). `RefreshPhase` is imported
 * from `@tadori/indexer` (its origin) to avoid duplicating that union.
 */
export interface SerializedRefreshState {
  phase: RefreshPhase;
  generation: number;
  dirtyPaths: string[];
  affectedPaths: string[];
  snapshotId: number | null;
  activationId: number | null;
  lastError: { name: string; message: string } | null;
}

export interface GraphStateOptions {
  db: Database;
  repoRoot: string;
  refresh: ConcurrentRefreshController;
  /** When set, serve this snapshot for the lifetime of the process. */
  snapshotId?: number;
  /** Poll interval (ms) for detecting refresh-state changes. ASSUMPTION: the
   * frozen ConcurrentRefreshController exposes no change event, only a
   * `state()` getter (verified: `worker` is `private readonly`, no public
   * emitter) — see 07-01 builder report for the recorded ASSUMPTION. */
  pollIntervalMs?: number;
}

export interface GraphStateChange {
  state: SerializedRefreshState;
  /** True when this change carries a new activated snapshot (generation +
   * snapshotId advanced) — the WS layer emits `snapshot_replaced` for this. */
  rotated: boolean;
  /** Populated when `lastError` transitioned from null to non-null on this
   * change — the WS layer emits `watcher_error` for this (§17). */
  newError: { name: string; message: string } | null;
}

export type GraphStateChangeListener = (change: GraphStateChange) => void;

const DEFAULT_POLL_INTERVAL_MS = 250;
const PREFERRED_KIND: RepoStateKind = "working_tree";

function sameState(a: SerializedRefreshState, b: SerializedRefreshState): boolean {
  return (
    a.phase === b.phase &&
    a.generation === b.generation &&
    a.snapshotId === b.snapshotId &&
    a.lastError?.message === b.lastError?.message
  );
}

/**
 * Owns the current GraphService instance, the caller-provided
 * ConcurrentRefreshController, the current EventLog, and the WS
 * broadcast hook. One instance per server process (AD-002/AD-011).
 */
export class GraphState {
  private readonly db: Database;
  private readonly repoRoot: string;
  private readonly refresh: ConcurrentRefreshController;
  private readonly pinnedSnapshotId: number | null;
  private service: GraphService;
  private eventLog: EventLog;
  private lastKnownState: SerializedRefreshState;
  private readonly listeners = new Set<GraphStateChangeListener>();
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(options: GraphStateOptions) {
    this.db = options.db;
    this.repoRoot = options.repoRoot;
    this.refresh = options.refresh;
    this.pinnedSnapshotId = options.snapshotId ?? null;
    this.service =
      this.pinnedSnapshotId === null
        ? GraphService.open(this.db, this.repoRoot, this.refresh, PREFERRED_KIND)
        : GraphService.openSnapshot(this.db, this.repoRoot, this.pinnedSnapshotId, this.refresh);
    this.eventLog = new EventLog(this.db, this.service, "tadori-serve", "tadori serve HTTP session");
    this.lastKnownState = this.refresh.state();
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollHandle = setInterval(() => this.pollForChanges(), pollIntervalMs);
    this.pollHandle.unref?.();
  }

  current(): GraphService {
    return this.service;
  }

  /**
   * A TadoriTools bound to the CURRENT service + eventLog. Routes that must be
   * byte-for-byte identical to the MCP tool output (e.g. /path parity, 08-07)
   * call the tool method through this rather than re-implementing the algorithm.
   * A fresh instance per call is fine — TadoriTools holds no per-call state.
   */
  tools(): TadoriTools {
    return new TadoriTools(this.service, this.eventLog);
  }

  /** The underlying store handle, for routes that need direct snapshot-list/pin queries. */
  currentDb(): Database {
    return this.db;
  }

  refreshState(): SerializedRefreshState {
    return this.refresh.state();
  }

  onChange(listener: GraphStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recordObservation(event: {
    type: ObservationEvent["type"];
    source: "claude_hook";
    detail?: string;
    resolvedTargets: Array<{ kind: "file" | "node"; entityId: number }>;
  }): void {
    this.eventLog.recordAgentEvent(
      event.type,
      event.source,
      event.detail === undefined ? null : { detail: event.detail },
      event.resolvedTargets
    );
  }

  /**
   * §17: an uncaught exception inside a `setInterval` callback kills the
   * Node process. `GraphService.open`/`new EventLog` can both throw during
   * the rotation race (e.g. no valid active snapshot yet, or the just-ended
   * task's snapshot no longer active) — the whole poll body is guarded so a
   * transient failure retains the old service/eventLog and retries next
   * tick instead of crashing the server.
   */
  private pollForChanges(): void {
    if (this.closed) {
      return;
    }
    try {
      const nextState = this.refresh.state();
      if (sameState(this.lastKnownState, nextState)) {
        return;
      }
      const previousState = this.lastKnownState;
      const rotated =
        this.pinnedSnapshotId === null &&
        nextState.snapshotId !== null &&
        nextState.snapshotId !== previousState.snapshotId;
      if (rotated) {
        // May throw (GraphService.open/new EventLog) during the rotation
        // race. Only commit lastKnownState AFTER a successful rotation, so a
        // failure here leaves lastKnownState at previousState and the next
        // tick's sameState() comparison still sees the pending delta and
        // retries — rather than silently adopting nextState and forgetting
        // the rotation was never applied.
        this.rotateSnapshot();
      }
      this.lastKnownState = nextState;
      const newError =
        nextState.lastError !== null && previousState.lastError === null ? nextState.lastError : null;
      const change: GraphStateChange = { state: nextState, rotated, newError };
      for (const listener of this.listeners) {
        listener(change);
      }
    } catch (error) {
      // Retain the old service/eventLog and the old lastKnownState; the next
      // tick retries. Nothing to report to WS clients here — `watcher_error`
      // is reserved for the refresh worker's own onError-observed lastError
      // transition, not this poll-loop's internal failure (which self-heals
      // on retry).
      void error;
    }
  }

  private rotateSnapshot(): void {
    try {
      this.eventLog.endTask("completed");
    } catch {
      // Idempotent-ish best-effort: if the old task is already unusable
      // (e.g. its snapshot was pruned), proceed to rebind regardless.
    }
    this.service = GraphService.open(this.db, this.repoRoot, this.refresh, PREFERRED_KIND);
    this.eventLog = new EventLog(this.db, this.service, "tadori-serve", "tadori serve HTTP session");
  }

  /** Ends the current task; stops polling. Does not close `db` or stop
   * `refresh` — those remain caller-owned (07-02's teardown order). */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    try {
      this.eventLog.endTask("aborted");
    } catch {
      // Task may already be ended; close() must remain idempotent-safe.
    }
    this.listeners.clear();
  }
}
