export type WsCloseReason = "clean" | "error" | "server_restart";

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 5000;

/** 500, 1000, 2000, 4000, 5000, 5000, ... (double each attempt, capped). */
function backoffDelay(attempt: number): number {
  const doubled = BASE_DELAY_MS * 2 ** attempt;
  return Math.min(doubled, MAX_DELAY_MS);
}

/**
 * Opens a WebSocket to `url` and keeps it alive with exponential backoff
 * reconnection (capped at 5000ms). `onServerEvent` fires for every parsed
 * message; `onReconnected` fires once per successful reconnect (NOT on the
 * initial connect) so callers can re-fetch snapshot/graph state that may
 * have changed while disconnected.
 *
 * `close()` performs a clean shutdown: it tears down the live socket and
 * sets a flag that stops any pending or future reconnect attempt.
 */
export function connectWs(
  url: string,
  onServerEvent: (evt: unknown) => void,
  onReconnected: () => void
): { close(): void } {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let hasConnectedBefore = false;

  function scheduleReconnect(): void {
    if (closed) {
      return;
    }
    const delay = backoffDelay(attempt);
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function open(): void {
    if (closed) {
      return;
    }
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
      if (closed) {
        return;
      }
      if (hasConnectedBefore) {
        onReconnected();
      }
      hasConnectedBefore = true;
      attempt = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (closed) {
        return;
      }
      try {
        onServerEvent(JSON.parse(event.data as string));
      } catch {
        onServerEvent(event.data);
      }
    };

    ws.onclose = () => {
      if (closed) {
        return;
      }
      scheduleReconnect();
    };

    ws.onerror = () => {
      // The browser follows an error with a close event, which drives
      // reconnection; nothing to do here beyond letting onclose fire.
    };
  }

  open();

  return {
    close(): void {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket !== null) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
        socket = null;
      }
    }
  };
}
