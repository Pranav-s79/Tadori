/**
 * The one fixed, orthographic isometric tilt (blueprint 10-01, decision C). It
 * matches `--tadori-tilt` in design/tokens.css and is not user-adjustable.
 */
export const ISOMETRIC_TILT_RADIANS = Math.atan(1 / Math.sqrt(2));

/**
 * Screen-space (y grows downward) affine tilt: the ground plane is foreshortened
 * by cos(tilt) and a node's depth lifts it up the screen by depth * sin(tilt).
 * x is untouched. Pure, so it is applied to the coordinates handed to the
 * renderer rather than as a CSS transform, which would break hit-testing.
 */
export function applyFixedTilt(
  x: number,
  y: number,
  depthOffset: number,
  tiltRadians: number = ISOMETRIC_TILT_RADIANS
): { screenX: number; screenY: number } {
  return {
    screenX: x,
    screenY: y * Math.cos(tiltRadians) - depthOffset * Math.sin(tiltRadians)
  };
}
