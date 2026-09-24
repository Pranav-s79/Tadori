export type WebglSupport = "webgl2" | "webgl" | null;

/**
 * Whether this browser can give the tilted Atlas a WebGL context. Probed once,
 * before tilting, so the map either tilts whole or stays flat; it never
 * half-renders a tilt (blueprint 10-01, decision F).
 */
export function probeWebglSupport(
  canvas: HTMLCanvasElement = document.createElement("canvas")
): WebglSupport {
  if (granted(() => canvas.getContext("webgl2"))) return "webgl2";
  if (granted(() => canvas.getContext("webgl"))) return "webgl";
  return null;
}

function granted(request: () => WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  let context: WebGLRenderingContext | WebGL2RenderingContext | null;
  try {
    context = request();
  } catch {
    return false;
  }
  if (context === null) return false;
  // A page gets only a handful of live WebGL contexts and the browser evicts the
  // oldest first, which would be the map's own. Give the probe's back at once.
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}
