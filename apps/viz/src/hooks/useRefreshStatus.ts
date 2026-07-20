import { useEffect, useRef, useState } from "react";
import { connectWs } from "../api/ws.ts";
import type { RefreshStatus } from "../api/types.ts";

function isRefreshStatus(evt: unknown): evt is RefreshStatus {
  return (
    evt !== null &&
    typeof evt === "object" &&
    typeof (evt as { phase?: unknown }).phase === "string"
  );
}

/**
 * Subscribes to the refresh-event WebSocket and tracks the latest
 * RefreshStatus. `onReconnected` is forwarded to the caller so it can
 * re-fetch snapshot/graph data after a dropped connection comes back
 * (the socket itself doesn't replay missed events).
 */
export function useRefreshStatus(wsUrl: string, onReconnected: () => void): RefreshStatus | null {
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const onReconnectedRef = useRef(onReconnected);
  onReconnectedRef.current = onReconnected;

  useEffect(() => {
    const handle = connectWs(
      wsUrl,
      (evt) => {
        if (isRefreshStatus(evt)) {
          setStatus(evt);
        }
      },
      () => onReconnectedRef.current()
    );
    return () => handle.close();
  }, [wsUrl]);

  return status;
}
