import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectWs } from "../src/api/ws.ts";

/**
 * Minimal fake WebSocket compatible with `new WebSocket(url)` +
 * on{open,message,close,error} assignment (the only surface src/api/ws.ts
 * uses). Each instance is tracked on FakeWebSocket.instances so the test
 * can drive open/close from outside.
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  triggerOpen(): void {
    this.onopen?.();
  }

  triggerClose(): void {
    this.closed = true;
    this.onclose?.();
  }

  close(): void {
    this.closed = true;
  }
}

describe("connectWs reconnection backoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules reconnect delays of 500, 1000, 2000, 4000, 5000, 5000", () => {
    const onServerEvent = vi.fn();
    const onReconnected = vi.fn();
    const handle = connectWs("ws://localhost/api/v1/events", onServerEvent, onReconnected);

    const observedDelays: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    // Initial socket connects, then drops repeatedly without ever
    // succeeding again, so we observe pure backoff scheduling.
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.triggerClose();

    for (let i = 0; i < 6; i++) {
      const call = setTimeoutSpy.mock.calls.at(-1);
      expect(call).toBeDefined();
      observedDelays.push(call![1] as number);
      vi.advanceTimersByTime(call![1] as number);
      // Each fired timer opens a new socket; close it immediately to
      // trigger the next scheduled reconnect.
      const latest = FakeWebSocket.instances.at(-1)!;
      latest.triggerClose();
    }

    expect(observedDelays).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
    handle.close();
    setTimeoutSpy.mockRestore();
  });

  it("fires onReconnected when a dropped socket reconnects, not on the first connect", () => {
    const onServerEvent = vi.fn();
    const onReconnected = vi.fn();
    const handle = connectWs("ws://localhost/api/v1/events", onServerEvent, onReconnected);

    FakeWebSocket.instances[0]!.triggerOpen();
    expect(onReconnected).not.toHaveBeenCalled();

    FakeWebSocket.instances[0]!.triggerClose();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.triggerOpen();

    expect(onReconnected).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it("resets backoff to 500ms after a successful reconnect", () => {
    const handle = connectWs("ws://localhost/api/v1/events", vi.fn(), vi.fn());
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    FakeWebSocket.instances[0]!.triggerClose();
    vi.advanceTimersByTime(500);
    FakeWebSocket.instances[1]!.triggerOpen(); // successful reconnect -> attempt resets to 0

    FakeWebSocket.instances[1]!.triggerClose();
    const call = setTimeoutSpy.mock.calls.at(-1);
    expect(call![1]).toBe(500);

    handle.close();
    setTimeoutSpy.mockRestore();
  });

  it("close() stops further reconnect attempts", () => {
    const handle = connectWs("ws://localhost/api/v1/events", vi.fn(), vi.fn());
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    FakeWebSocket.instances[0]!.triggerClose();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    handle.close();
    vi.advanceTimersByTime(60_000);

    // No new sockets and no new timers after close().
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    setTimeoutSpy.mockRestore();
  });

  it("delivers parsed JSON messages via onServerEvent", () => {
    const onServerEvent = vi.fn();
    const handle = connectWs("ws://localhost/api/v1/events", onServerEvent, vi.fn());

    FakeWebSocket.instances[0]!.onmessage?.({ data: JSON.stringify({ phase: "refreshing" }) });
    expect(onServerEvent).toHaveBeenCalledWith({ phase: "refreshing" });

    handle.close();
  });
});
