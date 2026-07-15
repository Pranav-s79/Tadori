import type { IncrementalIndexerState, RefreshPhase } from "@tadori/indexer";

export interface RefreshWorkerData {
  dbPath: string;
  repoRoot: string;
}

export interface SerializedRefreshState {
  phase: RefreshPhase;
  generation: number;
  dirtyPaths: string[];
  affectedPaths: string[];
  snapshotId: number | null;
  activationId: number | null;
  lastError: { name: string; message: string } | null;
}

export type RefreshWorkerMessage =
  | { type: "state"; state: SerializedRefreshState }
  | { type: "ready"; state: SerializedRefreshState }
  | { type: "stopped" }
  | { type: "fatal"; error: { name: string; message: string } };

export type RefreshHostMessage = { type: "stop" };

export function serializeRefreshState(state: IncrementalIndexerState): SerializedRefreshState {
  return {
    phase: state.phase,
    generation: state.generation,
    dirtyPaths: [...state.dirtyPaths],
    affectedPaths: [...state.affectedPaths],
    snapshotId: state.snapshotId,
    activationId: state.activationId,
    lastError: state.lastError
      ? { name: state.lastError.name, message: state.lastError.message }
      : null
  };
}
