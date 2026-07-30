import type { NodeDisplayData, RenderParams } from "sigma/types";
import { NodeProgram, type ProgramInfo, type NodeProgramType } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { AtlasCapability, AtlasNodeShape } from "./atlasVisuals.ts";

const UNIFORMS = ["u_sizeRatio", "u_pixelRatio", "u_matrix"] as const;
type Uniform = (typeof UNIFORMS)[number];

function shapeTest(shape: AtlasNodeShape, point = "mark"): string {
  const x = `${point}.x`;
  const y = `${point}.y`;
  const ax = `abs(${x})`;
  const ay = `abs(${y})`;
  const tests: Readonly<Record<AtlasNodeShape, string>> = {
    foundation: `((${ax} <= 0.48 && ${ay} <= 0.30) || (${ax} <= 0.38 && ${ay} <= 0.42) || (${ax} <= 0.25 && ${ay} <= 0.49))`,
    slab: `(${ax} + ${ay} <= 0.52)`,
    pillar: `((${ax} <= 0.16 && ${ay} <= 0.39) || (${ax} <= 0.31 && ${ay} >= 0.32 && ${ay} <= 0.47))`,
    stele: `((${ax} <= 0.28 && ${y} >= -0.30 && ${y} <= 0.45) || (length(vec2(${x}, ${y} + 0.30)) <= 0.28))`,
    colonnade: `((${ay} <= 0.42 && ${ax} <= 0.46 && ${y} >= -0.20) || (${y} < -0.20 && ${y} >= -0.46 && ${ax} <= (0.50 + ${y}) * 1.75))`,
    gateway: `(${ax} <= 0.44 && ${ay} <= 0.48 && !((${y} > -0.02 && ${ax} < 0.16) || (length(vec2(${x}, ${y} + 0.02)) < 0.16 && ${y} <= -0.02)))`,
    seal: `(${ax} <= 0.43 && ${ay} <= 0.49 && ${ax} + ${ay} * 0.55 <= 0.55)`,
    gatehouse: `((${ax} >= 0.19 && ${ax} <= 0.46 && ${ay} <= 0.46) || (${ay} >= 0.25 && ${ay} <= 0.46 && ${ax} <= 0.46) || (${y} <= -0.18 && ${y} >= -0.34 && ${ax} <= 0.25))`,
    tablet: `(length(vec2(${x}, max(${ay} - 0.33, 0.0))) <= 0.37)`,
    scaffold: `((${ax} <= 0.09 && ${ay} <= 0.46) || (${ay} <= 0.09 && ${ax} <= 0.46) || (${ax} >= 0.37 && ${ay} <= 0.42) || (${ay} >= 0.37 && ${ax} <= 0.42))`,
    outpost: `((${y} >= -0.44 && ${y} <= 0.34 && ${ax} <= (${y} + 0.50) * 0.55) || (${y} >= 0.30 && ${y} <= 0.45 && ${ax} <= 0.46))`,
    terminus: `(abs((${ax} + ${ay}) - 0.35) <= 0.095 && !(${x} > 0.08 && ${y} < -0.08))`
  };
  return tests[shape];
}

const SHAPE_CARVING: Readonly<Record<AtlasNodeShape, string>> = {
  foundation: "abs(mark.y) < 0.035 || (abs(mark.x) < 0.035 && abs(mark.y) < 0.30)",
  slab: "abs(mark.x + mark.y) < 0.035 || abs(mark.x - mark.y) < 0.035",
  pillar: "abs(mark.x) < 0.035 || abs(abs(mark.y) - 0.33) < 0.035",
  stele: "abs(mark.x) < 0.035 || (mark.y > 0.05 && abs(mark.y - 0.22) < 0.035)",
  colonnade: "mark.y > -0.16 && (abs(mark.x - 0.25) < 0.04 || abs(mark.x) < 0.04 || abs(mark.x + 0.25) < 0.04)",
  gateway: "abs(abs(mark.x) - 0.29) < 0.04 || abs(mark.y + 0.31) < 0.035",
  seal: "length(mark) < 0.11 || abs(mark.x) < 0.025 || abs(mark.y) < 0.025",
  gatehouse: "abs(mark.y) < 0.035 || abs(abs(mark.x) - 0.32) < 0.035",
  tablet: "(mark.y > -0.18 && mark.y < 0.27 && mod((mark.y + 0.18) * 18.0, 2.0) < 0.55 && abs(mark.x) < 0.22)",
  scaffold: "abs(abs(mark.x) - abs(mark.y)) < 0.035",
  outpost: "abs(mark.x) < 0.035 || abs(mark.y - 0.32) < 0.035",
  terminus: "abs(mark.x - mark.y) < 0.04"
};

const CAPABILITY_INLAY: Readonly<Record<AtlasCapability, string | null>> = {
  semantic: null,
  structural: "abs(fract((mark.x + mark.y) * 5.0) - 0.5) < 0.10",
  repository: "length(fract((mark + vec2(0.5)) * 4.0) - vec2(0.5)) < 0.12",
  mixed: "abs(fract((mark.x + mark.y) * 5.0) - 0.5) < 0.10 || abs(fract((mark.x - mark.y) * 5.0) - 0.5) < 0.10",
  unknown: "mark.y > 0.30"
};

const VERTEX_SHADER = `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform mat3 u_matrix;
varying vec4 v_color;
const float bias = 255.0 / 254.0;
void main() {
  gl_Position = vec4((u_matrix * vec3(a_position, 1)).xy, 0, 1);
  gl_PointSize = a_size / u_sizeRatio * u_pixelRatio * 2.0;
  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}`;

function fragmentShader(shape: AtlasNodeShape, capability: AtlasCapability): string {
  const capabilityInlay = CAPABILITY_INLAY[capability];
  return `
precision mediump float;
varying vec4 v_color;
void main() {
  vec2 mark = gl_PointCoord - vec2(0.5);
  if (!(${shapeTest(shape)})) discard;
  #ifndef PICKING_MODE
  vec3 stone = v_color.rgb;
  vec2 innerMark = mark * 1.18;
  if (!(${shapeTest(shape, "innerMark")})) stone *= 0.70;
  stone *= 0.94 + (0.16 * clamp(0.5 - mark.y - mark.x * 0.35, 0.0, 1.0));
  if (${SHAPE_CARVING[shape]}) stone = mix(stone, vec3(0.22, 0.17, 0.12), 0.48);
  ${capabilityInlay === null ? "" : `if (${capabilityInlay}) stone = mix(stone, vec3(0.91, 0.69, 0.34), 0.38);`}
  gl_FragColor = vec4(stone, v_color.a);
  #else
  gl_FragColor = v_color;
  #endif
}`;
}

export function atlasNodeProgramDefinition(shape: AtlasNodeShape, capability: AtlasCapability) {
  return {
    VERTICES: 1,
    VERTEX_SHADER_SOURCE: VERTEX_SHADER,
    FRAGMENT_SHADER_SOURCE: fragmentShader(shape, capability),
    METHOD: WebGLRenderingContext.POINTS,
    UNIFORMS,
    ATTRIBUTES: [
      { name: "a_position", size: 2, type: WebGLRenderingContext.FLOAT },
      { name: "a_size", size: 1, type: WebGLRenderingContext.FLOAT },
      { name: "a_color", size: 4, type: WebGLRenderingContext.UNSIGNED_BYTE, normalized: true },
      { name: "a_id", size: 4, type: WebGLRenderingContext.UNSIGNED_BYTE, normalized: true }
    ]
  };
}

export function createAtlasNodeProgram(
  shape: AtlasNodeShape,
  capability: AtlasCapability
): NodeProgramType {
  return class AtlasNodeProgram extends NodeProgram<Uniform> {
    getDefinition() {
      return atlasNodeProgramDefinition(shape, capability);
    }

    processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData): void {
      this.array[startIndex++] = data.x;
      this.array[startIndex++] = data.y;
      this.array[startIndex++] = data.size;
      this.array[startIndex++] = floatColor(data.color);
      this.array[startIndex] = nodeIndex;
    }

    setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo<Uniform>): void {
      gl.uniform1f(uniformLocations.u_pixelRatio, params.pixelRatio);
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
    }
  };
}

const SHAPES: readonly AtlasNodeShape[] = [
  "foundation", "slab", "pillar", "stele", "colonnade", "gateway", "seal",
  "gatehouse", "tablet", "scaffold", "outpost", "terminus"
];
const CAPABILITIES: readonly AtlasCapability[] = ["semantic", "structural", "repository", "mixed", "unknown"];

export const ATLAS_NODE_PROGRAMS: Readonly<Record<string, NodeProgramType>> = Object.fromEntries(
  SHAPES.flatMap((shape) => CAPABILITIES.map((capability) => [
    `atlas-${shape}-${capability}`,
    createAtlasNodeProgram(shape, capability)
  ]))
);
