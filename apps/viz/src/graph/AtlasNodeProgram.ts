import type { NodeDisplayData, RenderParams } from "sigma/types";
import { NodeProgram, type ProgramInfo, type NodeProgramType } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { AtlasCapability, AtlasNodeShape } from "./atlasVisuals.ts";

const UNIFORMS = ["u_sizeRatio", "u_pixelRatio", "u_matrix"] as const;
type Uniform = (typeof UNIFORMS)[number];

const SHAPE_TEST: Readonly<Record<AtlasNodeShape, string>> = {
  foundation: "max(abs(mark.x), abs(mark.y)) <= 0.48",
  tile: "abs(mark.x) + abs(mark.y) <= 0.52",
  marker: "length(mark) <= 0.48",
  tablet: "abs(mark.x) <= 0.34 && abs(mark.y) <= 0.48",
  scaffold: "(abs(mark.x) <= 0.11 || abs(mark.y) <= 0.11 || (abs(mark.x) >= 0.38 && abs(mark.y) <= 0.44) || (abs(mark.y) >= 0.38 && abs(mark.x) <= 0.44))",
  terminus: "abs((abs(mark.x) + abs(mark.y)) - 0.35) <= 0.10"
};

const CAPABILITY_TEST: Readonly<Record<AtlasCapability, string | null>> = {
  semantic: null,
  structural: "mod((gl_PointCoord.x + gl_PointCoord.y) * 28.0, 6.0) <= 3.4",
  repository: "length(fract(gl_PointCoord * 5.0) - vec2(0.5)) <= 0.22",
  mixed: "mod((gl_PointCoord.x + gl_PointCoord.y) * 28.0, 6.0) <= 3.4 || mod((gl_PointCoord.x - gl_PointCoord.y + 1.0) * 28.0, 6.0) <= 3.4",
  unknown: "gl_PointCoord.y >= 0.34"
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
  const capabilityTest = CAPABILITY_TEST[capability];
  return `
precision mediump float;
varying vec4 v_color;
void main() {
  vec2 mark = gl_PointCoord - vec2(0.5);
  if (!(${SHAPE_TEST[shape]})) discard;
  #ifndef PICKING_MODE
  ${capabilityTest === null ? "" : `if (!(${capabilityTest})) discard;`}
  #endif
  gl_FragColor = v_color;
}`;
}

export function createAtlasNodeProgram(
  shape: AtlasNodeShape,
  capability: AtlasCapability
): NodeProgramType {
  return class AtlasNodeProgram extends NodeProgram<Uniform> {
    getDefinition() {
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

const SHAPES: readonly AtlasNodeShape[] = ["foundation", "tile", "marker", "tablet", "scaffold", "terminus"];
const CAPABILITIES: readonly AtlasCapability[] = ["semantic", "structural", "repository", "mixed", "unknown"];

export const ATLAS_NODE_PROGRAMS: Readonly<Record<string, NodeProgramType>> = Object.fromEntries(
  SHAPES.flatMap((shape) => CAPABILITIES.map((capability) => [
    `atlas-${shape}-${capability}`,
    createAtlasNodeProgram(shape, capability)
  ]))
);
