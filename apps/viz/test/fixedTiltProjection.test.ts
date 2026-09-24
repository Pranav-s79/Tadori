import { describe, expect, it } from "vitest";
import { ISOMETRIC_TILT_RADIANS, applyFixedTilt } from "../src/render/fixedTiltProjection.ts";

describe("applyFixedTilt", () => {
  it("fixes the tilt at the isometric angle, atan(1/sqrt(2))", () => {
    expect(ISOMETRIC_TILT_RADIANS).toBe(Math.atan(1 / Math.sqrt(2)));
    expect(ISOMETRIC_TILT_RADIANS * 180 / Math.PI).toBeCloseTo(35.264, 3);
  });

  it("passes x through untouched", () => {
    for (const x of [-12.5, 0, 3, 1e6]) {
      expect(applyFixedTilt(x, 7, 40).screenX).toBe(x);
    }
  });

  it("foreshortens y by cos(tilt) on the ground plane", () => {
    expect(applyFixedTilt(0, 100, 0).screenY).toBeCloseTo(100 * Math.cos(ISOMETRIC_TILT_RADIANS), 10);
    expect(applyFixedTilt(0, 0, 0).screenY).toBe(0);
  });

  it("lifts a deeper node up the screen by depth * sin(tilt)", () => {
    const ground = applyFixedTilt(4, 10, 0).screenY;
    const lifted = applyFixedTilt(4, 10, 40).screenY;
    expect(ground - lifted).toBeCloseTo(40 * Math.sin(ISOMETRIC_TILT_RADIANS), 10);
  });

  it("is monotonic in depth: more depth is always higher on screen", () => {
    const ys = [0, 1, 2].map((level) => applyFixedTilt(0, 50, level * 40).screenY);
    expect(ys[1]!).toBeLessThan(ys[0]!);
    expect(ys[2]!).toBeLessThan(ys[1]!);
  });

  it("is the identity on y when the tilt is zero", () => {
    expect(applyFixedTilt(1, 9, 40, 0)).toEqual({ screenX: 1, screenY: 9 });
  });
});
