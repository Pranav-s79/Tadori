import { describe, expect, it, vi } from "vitest";
import { probeWebglSupport } from "../src/render/webglCapability.ts";

function fakeCanvas(contexts: Record<string, unknown>): HTMLCanvasElement {
  return { getContext: (kind: string) => contexts[kind] ?? null } as unknown as HTMLCanvasElement;
}

function fakeContext() {
  const loseContext = vi.fn();
  return { loseContext, context: { getExtension: () => ({ loseContext }) } };
}

describe("probeWebglSupport", () => {
  it("prefers WebGL2 and releases the probe's context", () => {
    const { loseContext, context } = fakeContext();
    expect(probeWebglSupport(fakeCanvas({ webgl2: context, webgl: context }))).toBe("webgl2");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("falls back to WebGL1", () => {
    const { context } = fakeContext();
    expect(probeWebglSupport(fakeCanvas({ webgl: context }))).toBe("webgl");
  });

  it("reports null when no WebGL context is available", () => {
    expect(probeWebglSupport(fakeCanvas({}))).toBeNull();
  });

  it("treats a throwing getContext as unavailable rather than crashing", () => {
    const canvas = { getContext: () => { throw new Error("blocked"); } } as unknown as HTMLCanvasElement;
    expect(probeWebglSupport(canvas)).toBeNull();
  });
});
