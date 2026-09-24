import type { NodeLabelDrawingFunction } from "sigma/rendering";

export interface LabelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A label Sigma asked to draw, in viewport pixels. */
export interface LabelRequest {
  key: string;
  /** Node centre and rendered radius. */
  x: number;
  y: number;
  radius: number;
  textWidth: number;
  labelSize: number;
  /** The selected/focused node: always drawn, and placed before anything else. */
  forced: boolean;
}

/** A drawn node's glyph, which no other node's label may cover. */
export interface LabelObstacle {
  key: string;
  box: LabelBox;
}

export type LabelSlot = "right" | "left" | "below" | "above";

export interface PlacedLabel {
  key: string;
  slot: LabelSlot;
  /** Left edge and alphabetic baseline to draw the text at. */
  textX: number;
  baselineY: number;
}

/** Gap kept around every label, in CSS pixels, so neighbours never touch. */
const LABEL_GAP_PX = 2;
/** Share of the font size above the alphabetic baseline. */
const ASCENT = 0.8;
const SLOTS: readonly LabelSlot[] = ["right", "left", "below", "above"];

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function slotAnchor(request: LabelRequest, slot: LabelSlot): { textX: number; baselineY: number } {
  const { x, y, radius, textWidth, labelSize } = request;
  switch (slot) {
    // Sigma's own position (drawDiscNodeLabel), so an uncrowded map is unchanged.
    case "right": return { textX: x + radius + 3, baselineY: y + (labelSize / 3) };
    case "left": return { textX: x - radius - 3 - textWidth, baselineY: y + (labelSize / 3) };
    case "below": return { textX: x - (textWidth / 2), baselineY: y + radius + 3 + (labelSize * ASCENT) };
    case "above": return { textX: x - (textWidth / 2), baselineY: y - radius - 3 - (labelSize * (1 - ASCENT)) };
  }
}

function textBox(request: LabelRequest, anchor: { textX: number; baselineY: number }): LabelBox {
  return {
    x: anchor.textX - LABEL_GAP_PX,
    y: anchor.baselineY - (request.labelSize * ASCENT) - LABEL_GAP_PX,
    width: request.textWidth + (2 * LABEL_GAP_PX),
    height: request.labelSize + (2 * LABEL_GAP_PX)
  };
}

/**
 * Where each label can go without printing over another label or another
 * node's glyph. Priority is the forced label first, then Sigma's own grid
 * order (larger node, then key), so a given view always draws the same labels.
 * Each label tries the four cartographic slots in order and is dropped when
 * none is clear; a forced label is always kept, in its first clear slot or
 * Sigma's default one, and everything placed after it yields to it.
 *
 * ponytail: every candidate is checked against every kept label and glyph,
 * O(labels x (labels + nodes)); fine under the 200-label cap and LOD node
 * budgets. Bucket boxes in a grid if the budgets ever grow.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  obstacles: readonly LabelObstacle[] = []
): PlacedLabel[] {
  const ordered = [...requests].sort((a, b) =>
    Number(b.forced) - Number(a.forced)
    || b.radius - a.radius
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const taken: LabelBox[] = [];
  const placed: PlacedLabel[] = [];
  for (const request of ordered) {
    const clear = SLOTS.find((slot) => {
      const box = textBox(request, slotAnchor(request, slot));
      return !taken.some((other) => overlaps(other, box))
        && !obstacles.some((glyph) => glyph.key !== request.key && overlaps(glyph.box, box));
    });
    const slot = clear ?? (request.forced ? "right" : null);
    if (slot === null) continue;
    const anchor = slotAnchor(request, slot);
    taken.push(textBox(request, anchor));
    placed.push({ key: request.key, slot, ...anchor });
  }
  return placed;
}

type DrawArgs = Parameters<NodeLabelDrawingFunction>;

/**
 * Sigma's label grid only thins labels per grid cell, and a zoomed-in camera
 * lets every label in a cell through, so file names printed over their
 * neighbours' glyphs. This defers each label Sigma would draw to the end of
 * the frame, then draws a placed, collision-free set with a halo in the ground
 * colour so a label that crosses an edge stays legible.
 *
 * Wire `draw` as `defaultDrawNodeLabel`, `reset` to `beforeRender` and `flush`
 * to `afterRender`: Sigma clears the label canvas before drawing, and emits
 * `afterRender` once the frame's labels have been requested.
 */
export function createCollisionCulledLabels(options: {
  obstacles?: () => readonly LabelObstacle[];
  haloColor?: string;
} = {}): {
  draw: NodeLabelDrawingFunction;
  reset: () => void;
  flush: () => void;
} {
  let pending: DrawArgs[] = [];
  return {
    draw: (...args) => {
      pending.push(args);
    },
    reset: () => {
      pending = [];
    },
    flush: () => {
      const frame = pending;
      pending = [];
      if (frame.length === 0) return;
      const byKey = new Map<string, DrawArgs>();
      const requests: LabelRequest[] = [];
      frame.forEach((args, index) => {
        const [context, data, settings] = args;
        if (typeof data.label !== "string" || data.label.length === 0) return;
        const key = (data as { key?: string }).key ?? `#${String(index)}`;
        context.font = `${settings.labelWeight} ${String(settings.labelSize)}px ${settings.labelFont}`;
        byKey.set(key, args);
        requests.push({
          key,
          x: data.x,
          y: data.y,
          radius: data.size,
          textWidth: context.measureText(data.label).width,
          labelSize: settings.labelSize,
          forced: data.forceLabel === true
        });
      });
      for (const label of placeLabels(requests, options.obstacles?.() ?? [])) {
        const args = byKey.get(label.key);
        if (args === undefined) continue;
        const [context, data, settings] = args;
        context.font = `${settings.labelWeight} ${String(settings.labelSize)}px ${settings.labelFont}`;
        if (options.haloColor !== undefined) {
          context.lineJoin = "round";
          context.lineWidth = 3;
          context.strokeStyle = options.haloColor;
          context.strokeText(data.label as string, label.textX, label.baselineY);
        }
        context.fillStyle = settings.labelColor.attribute
          ? String((data as Record<string, unknown>)[settings.labelColor.attribute] ?? settings.labelColor.color ?? "#000")
          : settings.labelColor.color ?? "#000";
        context.fillText(data.label as string, label.textX, label.baselineY);
      }
    }
  };
}
