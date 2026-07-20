import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiEdge, ApiNode, LayoutPositionDto } from "../src/api/types.ts";
import { PackageMapCanvas, truncateLabel } from "../src/graph/PackageMapCanvas.tsx";

// jsdom has no WebGL implementation, and sigma's real constructor calls
// gl.blendFunc(...) unconditionally on the context it gets back from
// canvas.getContext("webgl2"/"webgl"/"experimental-webgl") — all of which
// are null in jsdom — so a real Sigma instance throws at construction time
// in this environment. Per the task's own note ("Sigma's WebGL renderer
// only needs mount/unmount to be jsdom-safe, not pixel output"), this
// smoke test mocks the sigma module so it can assert mount/unmount
// lifecycle wiring without needing a real WebGL context.
const killMock = vi.fn();
const sigmaConstructorMock = vi.fn();
vi.mock("sigma", () => ({
  default: class FakeSigma {
    constructor(...args: unknown[]) {
      sigmaConstructorMock(...args);
    }
    kill() {
      killMock();
    }
  }
}));

afterEach(() => {
  cleanup();
  killMock.mockClear();
  sigmaConstructorMock.mockClear();
});

const nodes: ApiNode[] = [
  { entityKey: "pkg:a", kind: "package", qualifiedName: "@tadori/a", displayName: "@tadori/a", file: null, exported: true, fanIn: 0 },
  { entityKey: "pkg:b", kind: "package", qualifiedName: "@tadori/b", displayName: "@tadori/b", file: null, exported: true, fanIn: 1 }
];
const edges: ApiEdge[] = [
  { entityKey: "e1", srcEntityKey: "pkg:a", relation: "imports", dstEntityKey: "pkg:b", origin: "compiler", confidence: "certain", resolution: "resolved" }
];
const positions: LayoutPositionDto[] = [
  { entityKey: "pkg:a", x: 0, y: 0, z: 0, pinned: false },
  { entityKey: "pkg:b", x: 10, y: 10, z: 0, pinned: false }
];

describe("PackageMapCanvas mount/unmount", () => {
  it("mounts a Sigma instance without throwing", () => {
    const { unmount } = render(<PackageMapCanvas nodes={nodes} edges={edges} positions={positions} />);
    expect(sigmaConstructorMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("kills the Sigma instance on unmount", () => {
    const { unmount } = render(<PackageMapCanvas nodes={nodes} edges={edges} positions={positions} />);
    unmount();
    expect(killMock).toHaveBeenCalledTimes(1);
  });

  it("handles an empty graph without throwing", () => {
    const { unmount } = render(<PackageMapCanvas nodes={[]} edges={[]} positions={[]} />);
    expect(sigmaConstructorMock).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("truncateLabel", () => {
  it("leaves labels of 24 chars or fewer unchanged", () => {
    expect(truncateLabel("a".repeat(24))).toBe("a".repeat(24));
    expect(truncateLabel("short")).toBe("short");
    expect(truncateLabel("")).toBe("");
  });

  it("truncates labels longer than 24 chars to exactly 24 chars + ellipsis", () => {
    const result = truncateLabel("a".repeat(25));
    expect(result).toBe(`${"a".repeat(24)}…`);
    expect(result.length).toBe(25); // 24 chars + 1 ellipsis char
  });

  it("truncates a realistic long package name", () => {
    const result = truncateLabel("@tadori/some-extremely-long-package-name");
    expect(result).toBe("@tadori/some-extremely-l…");
    expect(result.startsWith(result.slice(0, 24))).toBe(true);
    expect(result.slice(0, 24).length).toBe(24);
    expect(result.endsWith("…")).toBe(true);
  });
});
