import { parentPort, workerData } from "node:worker_threads";
import { IncrementalRepositoryIndexer } from "@tadori/indexer";
import { openDatabase, runMigrations } from "@tadori/store";
import {
  serializeRefreshState,
  type RefreshHostMessage,
  type RefreshWorkerData,
  type RefreshWorkerMessage
} from "./refreshProtocol.js";

if (!parentPort) {
  throw new Error("The refresh worker requires a parent message port");
}

const port = parentPort;
const data = workerData as RefreshWorkerData;
const db = openDatabase(data.dbPath);
runMigrations(db);
const indexer = new IncrementalRepositoryIndexer(db, data.repoRoot, {
  onStateChange: (state) => {
    port.postMessage({ type: "state", state: serializeRefreshState(state) } satisfies RefreshWorkerMessage);
  }
});
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  try {
    await indexer.stop();
  } finally {
    db.close();
  }
  port.postMessage({ type: "stopped" } satisfies RefreshWorkerMessage);
  port.close();
}

port.on("message", (message: RefreshHostMessage) => {
  if (message.type === "stop") {
    void stop().catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      port.postMessage({
        type: "fatal",
        error: { name: normalized.name, message: normalized.message }
      } satisfies RefreshWorkerMessage);
    });
  }
});

void indexer.startWatching().then(
  () => {
    port.postMessage({
      type: "ready",
      state: serializeRefreshState(indexer.state())
    } satisfies RefreshWorkerMessage);
  },
  (error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    port.postMessage({
      type: "fatal",
      error: { name: normalized.name, message: normalized.message }
    } satisfies RefreshWorkerMessage);
    db.close();
    port.close();
  }
);
