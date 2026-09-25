import { describe, expect, it, vi } from "vitest";
import {
  createCollisionCulledLabels,
  placeLabels,
  type LabelObstacle,
  type LabelRequest
} from "../src/lod/labelCollisions.ts";
import { visibleLabelEntityKeys } from "../src/lod/budgets.ts";

function request(key: string, x: number, y: number, overrides: Partial<LabelRequest> = {}): LabelRequest {
  return { key, x, y, radius: 6, textWidth: 80, labelSize: 14, forced: false, ...overrides };
}

function glyph(key: string, x: number, y: number, radius = 6): LabelObstacle {
  return { key, box: { x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius } };
}

const slots = (placed: ReturnType<typeof placeLabels>) => Object.fromEntries(placed.map((label) => [label.key, label.slot]));

describe("label placement", () => {
  it("keeps Sigma's right-hand slot when nothing is in the way", () => {
    const placed = placeLabels([request("db.ts", 100, 100)], [glyph("db.ts", 100, 100)]);
    expect(placed).toEqual([{ key: "db.ts", slot: "right", textX: 109, baselineY: 100 + (14 / 3) }]);
  });

  it("moves a label off a neighbouring node's glyph instead of printing over it", () => {
    // container.ts sits just left of the package node; its right-hand label
    // would run straight across it (the audited defect).
    const placed = placeLabels(
      [request("container.ts", 100, 100)],
      [glyph("container.ts", 100, 100), glyph("package", 140, 100, 10)]
    );
    expect(slots(placed)).toEqual({ "container.ts": "left" });
  });

  it("gives the larger node the contested slot and drops a label with no clear slot", () => {
    const crowd = [glyph("hub", 100, 100), glyph("a", 100, 70), glyph("b", 100, 130), glyph("c", 60, 100), glyph("d", 140, 100)];
    const placed = placeLabels(
      [request("hub", 100, 100, { radius: 4 }), request("big", 300, 300, { radius: 12 })],
      crowd
    );
    expect(slots(placed)).toEqual({ big: "right" });
  });

  it("always places the selected label, and its neighbours yield to it", () => {
    const crowd = [glyph("selected", 100, 100), glyph("a", 100, 70), glyph("b", 100, 130), glyph("c", 60, 100), glyph("d", 140, 100)];
    const placed = placeLabels(
      [request("rival", 100, 112, { radius: 20 }), request("selected", 100, 100, { forced: true, radius: 2 })],
      crowd
    );
    // Forced through a full crowd, in Sigma's slot; the larger rival, whose
    // right-hand slot overlaps it, moves instead.
    expect(placed[0]).toMatchObject({ key: "selected", slot: "right" });
    expect(slots(placed).rival).not.toBe("right");
  });

  it("breaks ties by key, so the same view always draws the same labels", () => {
    const a = request("a.ts", 0, 0);
    const b = request("b.ts", 0, 0);
    expect(placeLabels([b, a]).map((label) => label.key)).toEqual(placeLabels([a, b]).map((label) => label.key));
    expect(placeLabels([b, a])[0]?.key).toBe("a.ts");
  });
});

describe("collision-culled Sigma label drawer", () => {
  it("draws only the placed set of what Sigma asked for, once per frame, with a halo", () => {
    const fillText = vi.fn();
    const strokeText = vi.fn();
    const context = {
      font: "",
      fillStyle: "",
      fillText,
      strokeText,
      measureText: (text: string) => ({ width: text.length * 7 })
    } as unknown as CanvasRenderingContext2D;
    const settings = { labelSize: 14, labelFont: "Arial", labelWeight: "normal", labelColor: { color: "#000" } } as never;
    const labels = createCollisionCulledLabels({
      haloColor: "#f4efe4",
      obstacles: () => [glyph("pkg", 150, 100, 12)]
    });
    labels.reset();
    labels.draw(context, { key: "container.ts", x: 100, y: 100, size: 6, label: "container.ts", color: "#000" } as never, settings);
    labels.draw(context, { key: "db.ts", x: 100, y: 300, size: 6, label: "db.ts", color: "#000" } as never, settings);
    expect(fillText).not.toHaveBeenCalled();
    labels.flush();
    expect(fillText.mock.calls.map((call) => call[0]).sort()).toEqual(["container.ts", "db.ts"]);
    // container.ts would have run over the package glyph, so it moved left.
    const container = fillText.mock.calls.find((call) => call[0] === "container.ts");
    expect(Number(container?.[1])).toBeLessThan(100);
    expect(strokeText).toHaveBeenCalledTimes(2);
    labels.flush();
    expect(fillText).toHaveBeenCalledTimes(2);
  });
});

describe("label budget with a selection", () => {
  it("gives the selected node a slot inside the 200-label cap, whatever its size", () => {
    const candidates = Array.from({ length: 300 }, (_, index) => ({
      entityKey: `node-${String(index).padStart(3, "0")}`,
      radiusPx: 10,
      pinned: false
    }));
    candidates.push({ entityKey: "tiny-selected", radiusPx: 1, pinned: true });
    const visible = visibleLabelEntityKeys(candidates);
    expect(visible).toHaveLength(200);
    expect(visible[0]).toBe("tiny-selected");
  });
});
