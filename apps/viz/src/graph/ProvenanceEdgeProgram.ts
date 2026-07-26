import type { EdgeDisplayData, NodeDisplayData, RenderParams } from "sigma/types";
import { EdgeProgram, type EdgeProgramType, type ProgramInfo } from "sigma/rendering";
import { floatColor } from "sigma/utils";
import type { AtlasEdgePattern } from "./atlasVisuals.ts";

const UNIFORMS = ["u_matrix", "u_sizeRatio", "u_correctionRatio", "u_viewport"] as const;
type Uniform = (typeof UNIFORMS)[number];

const VERTEX_SHADER = `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform vec2 u_viewport;
varying vec4 v_color;
varying float v_distance;
const float bias = 255.0 / 254.0;
void main() {
  vec2 normal = a_normal * a_normalCoef;
  float normalLength = length(normal);
  vec2 unitNormal = normalLength > 0.0 ? normal / normalLength : vec2(0.0);
  float webGLThickness = normalLength * u_correctionRatio / u_sizeRatio;
  vec2 position = mix(a_positionStart, a_positionEnd, a_positionCoef);
  vec2 clipStart = (u_matrix * vec3(a_positionStart, 1)).xy;
  vec2 clipEnd = (u_matrix * vec3(a_positionEnd, 1)).xy;
  v_distance = a_positionCoef * length((clipEnd - clipStart) * u_viewport * 0.5);
  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy, 0, 1);
  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}`;

function fragmentShader(pattern: AtlasEdgePattern): string {
  const discard = pattern === "solid"
    ? ""
    : pattern === "dashed"
      ? "if (mod(v_distance, 6.0) > 4.0) discard;"
      : "if (mod(v_distance, 3.0) > 1.0) discard;";
  return `
precision mediump float;
varying vec4 v_color;
varying float v_distance;
void main() {
  #ifndef PICKING_MODE
  ${discard}
  #endif
  gl_FragColor = v_color;
}`;
}

export function provenanceEdgeProgramDefinition(pattern: AtlasEdgePattern) {
  return {
    VERTICES: 6,
    VERTEX_SHADER_SOURCE: VERTEX_SHADER,
    FRAGMENT_SHADER_SOURCE: fragmentShader(pattern),
    METHOD: WebGLRenderingContext.TRIANGLES,
    UNIFORMS,
    ATTRIBUTES: [
      { name: "a_positionStart", size: 2, type: WebGLRenderingContext.FLOAT },
      { name: "a_positionEnd", size: 2, type: WebGLRenderingContext.FLOAT },
      { name: "a_normal", size: 2, type: WebGLRenderingContext.FLOAT },
      { name: "a_color", size: 4, type: WebGLRenderingContext.UNSIGNED_BYTE, normalized: true },
      { name: "a_id", size: 4, type: WebGLRenderingContext.UNSIGNED_BYTE, normalized: true }
    ],
    CONSTANT_ATTRIBUTES: [
      { name: "a_positionCoef", size: 1, type: WebGLRenderingContext.FLOAT },
      { name: "a_normalCoef", size: 1, type: WebGLRenderingContext.FLOAT }
    ],
    CONSTANT_DATA: [
      [0, 1],
      [0, -1],
      [1, 1],
      [1, 1],
      [0, -1],
      [1, -1]
    ]
  };
}

export function createProvenanceEdgeProgram(pattern: AtlasEdgePattern): EdgeProgramType {
  return class ProvenanceEdgeProgram extends EdgeProgram<Uniform> {
    getDefinition() {
      return provenanceEdgeProgramDefinition(pattern);
    }

    processVisibleItem(
      edgeIndex: number,
      startIndex: number,
      sourceData: NodeDisplayData,
      targetData: NodeDisplayData,
      data: EdgeDisplayData
    ): void {
      const thickness = data.size || 1;
      const dx = targetData.x - sourceData.x;
      const dy = targetData.y - sourceData.y;
      const length = Math.hypot(dx, dy);
      const normalX = length === 0 ? 0 : (-dy / length) * thickness;
      const normalY = length === 0 ? 0 : (dx / length) * thickness;
      this.array[startIndex++] = sourceData.x;
      this.array[startIndex++] = sourceData.y;
      this.array[startIndex++] = targetData.x;
      this.array[startIndex++] = targetData.y;
      this.array[startIndex++] = normalX;
      this.array[startIndex++] = normalY;
      this.array[startIndex++] = floatColor(data.color);
      this.array[startIndex] = edgeIndex;
    }

    setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo<Uniform>): void {
      gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
      gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
      gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
      gl.uniform2f(uniformLocations.u_viewport, params.width, params.height);
    }
  };
}

export const ATLAS_EDGE_PROGRAMS: Readonly<Record<AtlasEdgePattern, EdgeProgramType>> = {
  solid: createProvenanceEdgeProgram("solid"),
  dashed: createProvenanceEdgeProgram("dashed"),
  dotted: createProvenanceEdgeProgram("dotted")
};
