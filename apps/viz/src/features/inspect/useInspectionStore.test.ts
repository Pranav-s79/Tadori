import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useInspectionStore } from "./useInspectionStore.ts";

const A = { entityKey: "a", entityType: "node" as const };
const B = { entityKey: "b", entityType: "node" as const };
const C = { entityKey: "c", entityType: "edge" as const };

describe("useInspectionStore", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useInspectionStore());
    expect(result.current.current).toBeNull();
    expect(result.current.previous).toBeNull();
  });

  it("opening B after A sets previous to A", () => {
    const { result } = renderHook(() => useInspectionStore());
    act(() => result.current.openEntity(A));
    act(() => result.current.openEntity(B));
    expect(result.current.current).toEqual(B);
    expect(result.current.previous).toEqual(A);
  });

  it("goBack swaps current and previous", () => {
    const { result } = renderHook(() => useInspectionStore());
    act(() => result.current.openEntity(A));
    act(() => result.current.openEntity(B));
    act(() => result.current.goBack());
    expect(result.current.current).toEqual(A);
    expect(result.current.previous).toBeNull();
  });

  it("remembers only one level: opening C after B (A previous) drops A", () => {
    const { result } = renderHook(() => useInspectionStore());
    act(() => result.current.openEntity(A));
    act(() => result.current.openEntity(B));
    act(() => result.current.openEntity(C));
    expect(result.current.current).toEqual(C);
    // previous is B, NOT A — only one level is kept.
    expect(result.current.previous).toEqual(B);
  });

  it("opening the current entity again is a no-op (does not self-loop back)", () => {
    const { result } = renderHook(() => useInspectionStore());
    act(() => result.current.openEntity(A));
    act(() => result.current.openEntity(B));
    act(() => result.current.openEntity(B));
    expect(result.current.current).toEqual(B);
    expect(result.current.previous).toEqual(A);
  });

  it("close clears both current and previous", () => {
    const { result } = renderHook(() => useInspectionStore());
    act(() => result.current.openEntity(A));
    act(() => result.current.openEntity(B));
    act(() => result.current.close());
    expect(result.current.current).toBeNull();
    expect(result.current.previous).toBeNull();
  });

  it("goBack with no previous is a no-op", () => {
    const { result } = renderHook(() => useInspectionStore());
    act(() => result.current.openEntity(A));
    act(() => result.current.goBack());
    expect(result.current.current).toEqual(A);
  });
});
