import type { FastifyInstance } from "fastify";
import type { ClientEvent, ServerEvent } from "./types.js";
import type { GraphStateChange } from "./graphState.js";

/**
 * Minimal structural shape this module needs from `ws`'s `WebSocket`. `ws` is
 * a transitive dependency (via `@fastify/websocket`, the allowlisted
 * companion package), not declared directly in this package's manifest per
 * §9's dependency list — so its types are referenced structurally here
 * rather than imported by module specifier.
 */
interface MinimalWebSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "close", listener: () => void): void;
}

type Channel = ClientEvent["channels"][number];
const KNOWN_CHANNELS: ReadonlySet<string> = new Set<Channel>(["refresh", "observation"]);

/**
 * Blueprint §10/§12/§17: this module owns every ServerEvent variant except
 * `observation` (08-09). `snapshot_replaced` fires when GraphState detects a
 * rotation (new activated snapshotId); `watcher_error` fires when the
 * refresh controller's `lastError` transitions from null to non-null;
 * `refresh_pending`/`refresh_settled` reflect the ordinary phase machine.
 */
function toServerEvents(app: FastifyInstance, change: GraphStateChange): ServerEvent[] {
  const { state, rotated, newError } = change;
  const events: ServerEvent[] = [];
  if (rotated) {
    const service = app.graphState.current();
    events.push({
      type: "snapshot_replaced",
      snapshotId: service.snapshot.id,
      snapshotKind: service.snapshot.kind,
      generation: state.generation,
      workspaceHash: service.snapshot.workspace_hash
    });
  }
  if (newError !== null) {
    events.push({ type: "watcher_error", message: newError.message });
  }
  if (state.phase === "dirty" || state.phase === "refreshing") {
    events.push({
      type: "refresh_pending",
      phase: state.phase,
      dirtyPaths: state.dirtyPaths,
      generation: state.generation
    });
  } else if (state.phase === "idle" || state.phase === "failed") {
    events.push({
      type: "refresh_settled",
      phase: state.phase,
      snapshotId: state.snapshotId,
      lastError: state.lastError?.message ?? null,
      generation: state.generation
    });
  }
  return events;
}

/**
 * `/api/v1/ws`: change-signal only (AD-010). No per-client replay buffer; on
 * reconnect the client re-fetches `/snapshot` + `/refresh`. Subscribes to
 * `GraphState.onChange`, filters by the client's declared `channels`.
 */
export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  app.get("/ws", { websocket: true }, (socket: MinimalWebSocket) => {
    let subscribedChannels = new Set<Channel>();

    const send = (event: ServerEvent): void => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    };

    const unsubscribe = app.graphState.onChange((change) => {
      if (!subscribedChannels.has("refresh")) {
        return;
      }
      for (const event of toServerEvents(app, change)) {
        send(event);
      }
    });

    socket.on("message", (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString("utf8"));
      } catch {
        return; // Malformed frame: ignore, never crash the connection.
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as { type?: unknown }).type !== "subscribe" ||
        !Array.isArray((parsed as { channels?: unknown }).channels)
      ) {
        return;
      }
      const channels = (parsed as ClientEvent).channels.filter((channel) =>
        KNOWN_CHANNELS.has(channel)
      );
      subscribedChannels = new Set(channels);
    });

    socket.on("close", () => {
      unsubscribe();
    });
  });
}
