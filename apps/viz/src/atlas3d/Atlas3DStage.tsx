import type Graph from "graphology";
import { useEffect, useImperativeHandle, useRef, type PointerEventHandler, type Ref } from "react";
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Fog,
  GridHelper,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  Shape,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { plural } from "../features/overview/overviewModel.ts";
import type { AtlasEdgePattern } from "../graph/atlasVisuals.ts";
import type { ViewportPosition } from "../graph/PackageMapCanvas.tsx";
import { placeLabels, type LabelObstacle, type LabelRequest, type LabelSlot } from "../lod/labelCollisions.ts";
import { PLATE_THICKNESS, buildAtlasScene, type AtlasSceneModel, type SceneNode, type Vec3 } from "./sceneModel.ts";

/** What the map around the stage can ask of its camera. */
export interface Atlas3DHandle {
  focus(key: string): void;
  /** Back to the fitted isometric three-quarter view. */
  reset(): void;
  /** Multiplies the camera's distance; below 1 moves closer. */
  zoom(factor: number): void;
  /** Where a node sits on screen, for arrow-key navigation. */
  screenPosition(key: string): ViewportPosition | undefined;
}

export interface Atlas3DStageProps {
  /** The live graph Plan draws; the stage follows its mutation events. */
  graph: Graph;
  /** False while the map is hidden behind another mode: the loop pauses. */
  active: boolean;
  handleRef: Ref<Atlas3DHandle | null>;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onViewportPositionsChange?(positions: ReadonlyMap<string, ViewportPosition>): void;
  onError(error: Error): void;
}

type Callbacks = Pick<Atlas3DStageProps, "onSelect" | "onActivate" | "onViewportPositionsChange" | "onError">;

interface World {
  /** Follow this graph's mutations; the renderer and camera carry over. */
  setGraph(graph: Graph): () => void;
  setActive(active: boolean): void;
  handle: Atlas3DHandle;
  dispose(): void;
}

/** atan(1/sqrt(2)): the isometric elevation, the same as --tadori-tilt. */
const ISOMETRIC_ELEVATION = Math.atan(1 / Math.SQRT2);
const ISOMETRIC_AZIMUTH = Math.PI / 4;
const FIELD_OF_VIEW = 30;
const FLIGHT_MS = 420;
const EDGE_SEGMENTS = 12;
/** A file or symbol is named once its block is at least this big on screen. */
const LABEL_MIN_RADIUS_PX = 9;
const LABEL_SIZE_PX = 12;
const CLICK_SLOP_PX = 5;
const UP = new Vector3(0, 1, 0);
/** Tablets and blocks turn to face the default camera. */
const FACING = new Quaternion().setFromAxisAngle(UP, ISOMETRIC_AZIMUTH);

const SLOT_CENTRE: Readonly<Record<LabelSlot, readonly [number, number]>> = {
  right: [0, 0.5],
  left: [1, 0.5],
  below: [0.5, 0],
  above: [0.5, 1]
};

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function describeScene(model: AtlasSceneModel): string {
  const count = (level: SceneNode["level"]) => model.nodes.filter((node) => node.level === level).length;
  return `3D repository map: ${plural(count("package"), "package", "packages")}, ${plural(count("file"), "file", "files")}, `
    + `${plural(count("symbol"), "symbol", "symbols")} and ${plural(model.edges.length, "relation", "relations")}. `
    + "Packages lie on the ground as slabs; files stand one level above and symbols two levels above.";
}

/** The camera direction of the default view: isometric, three-quarter. */
function isometricDirection(): Vector3 {
  return new Vector3(
    Math.sin(ISOMETRIC_AZIMUTH) * Math.cos(ISOMETRIC_ELEVATION),
    Math.sin(ISOMETRIC_ELEVATION),
    Math.cos(ISOMETRIC_AZIMUTH) * Math.cos(ISOMETRIC_ELEVATION)
  );
}

function arcPoints(from: Vec3, to: Vec3): Vector3[] {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  // Edges arch over the map so they do not lie flat through other blocks.
  const lift = Math.min(14, 0.22 * Math.hypot(b.x - a.x, b.z - a.z));
  return Array.from({ length: EDGE_SEGMENTS + 1 }, (_, step) => {
    const t = step / EDGE_SEGMENTS;
    return a.clone().lerp(b, t).addScaledVector(UP, lift * 4 * t * (1 - t));
  });
}

function createWorld(host: HTMLElement, callbacks: { current: Callbacks }): World {
  const reducedMotion = prefersReducedMotion();
  const styles = getComputedStyle(host);
  const token = (name: string, fallback: string): Color =>
    new Color(styles.getPropertyValue(name).trim() || fallback);
  const colours = {
    ground: token("--tadori-ground", "#d8cfbc"),
    panel: token("--tadori-panel", "#f4efe4"),
    plateEdge: token("--tadori-plate-edge", "#b3a78f"),
    copper: token("--tadori-copper", "#9b5d2b"),
    ink: token("--tadori-ink", "#292a28"),
    focus: token("--tadori-focus", "#315f8c")
  };

  // Throws without WebGL; the caller falls back to Plan.
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(colours.ground);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "atlas3d-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "3D repository map");
  host.append(canvas);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "atlas3d-labels";
  labelRenderer.domElement.setAttribute("aria-hidden", "true");
  host.append(labelRenderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.5, 5000);
  camera.position.copy(isometricDirection().multiplyScalar(160));
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;

  // Soft: a strong ambient fill keeps shaded faces readable, and the one sun
  // gives every block a lit top and a shadow on the ground.
  scene.add(new AmbientLight(0xffffff, 2));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 4;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const groundMaterial = new MeshLambertMaterial({ color: colours.ground });
  const ground = new Mesh(new PlaneGeometry(1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  let grid: GridHelper | null = null;

  // Fog fades only the ground and its grid into the distance; the map itself
  // stays at full strength however far away it is.
  const blockGeometry = new BoxGeometry(1, 1, 1);
  const fileMaterial = new MeshLambertMaterial({ fog: false });
  const symbolMaterial = new MeshLambertMaterial({ fog: false });
  const stemMaterial = new LineBasicMaterial({ color: colours.ink, transparent: true, opacity: 0.32, fog: false });
  const rimMaterial = new LineBasicMaterial({ color: colours.copper, transparent: true, opacity: 0.75, fog: false });
  const markerMaterial = new MeshLambertMaterial({ color: colours.focus, transparent: true, opacity: 0.85, fog: false });
  const edgeMaterials: Record<AtlasEdgePattern, LineBasicMaterial> = {
    solid: new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false }),
    dashed: new LineDashedMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false, dashSize: 1.1, gapSize: 0.55 }),
    dotted: new LineDashedMaterial({ vertexColors: true, transparent: true, opacity: 0.9, fog: false, dashSize: 0.22, gapSize: 0.5 })
  };

  const content = new Group();
  const labelLayer = new Group();
  scene.add(content, labelLayer);

  let model: AtlasSceneModel = { nodes: [], plates: [], edges: [] };
  let nodeByKey = new Map<string, SceneNode>();
  let pickables: Object3D[] = [];
  /** Where each node's colour lives, so hover can restyle one instance. */
  let paint = new Map<string, { apply(color: Color): void; base: Color }>();
  const labels = new Map<string, CSS2DObject>();
  const textWidths = new Map<string, number>();
  const measure = document.createElement("canvas").getContext("2d");
  const labelFont = styles.getPropertyValue("--tadori-font-label").trim() || "sans-serif";
  const uiFont = styles.getPropertyValue("--tadori-font-ui").trim() || "sans-serif";

  let hovered: string | null = null;
  let pointer: Vector2 | null = null;
  let graph: Graph | null = null;
  let modelDirty = true;
  /** The node set the camera was last fitted to; a new set refits. */
  let fittedNodes: string | null = null;
  let viewDirty = true;
  let flight: { fromPosition: Vector3; toPosition: Vector3; fromTarget: Vector3; toTarget: Vector3; start: number } | null = null;
  const raycaster = new Raycaster();
  const scratch = new Vector3();

  const disposeContent = (): void => {
    content.traverse((object) => {
      if (object instanceof InstancedMesh) object.dispose();
      if (object instanceof Mesh || object instanceof LineSegments || object instanceof LineLoop) {
        if (object.geometry !== blockGeometry) object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material !== fileMaterial && material !== symbolMaterial && material !== stemMaterial
            && material !== rimMaterial && material !== markerMaterial
            && !Object.values(edgeMaterials).includes(material as LineBasicMaterial)) material.dispose();
        }
      }
    });
    content.clear();
  };

  // Blocks are pale stone carrying Plan's material hue; the selection keeps
  // Plan's full focus colour so it stands out from every stone.
  const colourOf = (node: SceneNode): Color => node.selected
    ? new Color(node.color)
    : colours.panel.clone().lerp(new Color(node.color), 0.62);

  const buildPlates = (): void => {
    for (const plate of model.plates) {
      const shape = new Shape(plate.outline.map((point) => new Vector2(point.x, -point.y)));
      const geometry = new ExtrudeGeometry(shape, { depth: PLATE_THICKNESS, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      const tint = new Color(plate.color);
      const cap = new MeshLambertMaterial({ color: colours.panel.clone().lerp(tint, plate.selected ? 0.6 : 0.3), fog: false });
      const side = new MeshLambertMaterial({ color: colours.plateEdge.clone().lerp(tint, 0.35), fog: false });
      const slab = new Mesh(geometry, [cap, side]);
      slab.castShadow = true;
      slab.receiveShadow = true;
      slab.userData.key = plate.key;
      content.add(slab);
      pickables.push(slab);
      const base = cap.color.clone();
      paint.set(plate.key, { base, apply: (color) => cap.color.copy(color) });
      const rim = new LineLoop(
        new BufferGeometry().setFromPoints(plate.outline.map((point) => new Vector3(point.x, PLATE_THICKNESS + 0.04, point.y))),
        rimMaterial
      );
      content.add(rim);
    }
  };

  const buildBlocks = (level: "file" | "symbol"): void => {
    const nodes = model.nodes.filter((node) => node.level === level);
    if (nodes.length === 0) return;
    const mesh = new InstancedMesh(blockGeometry, level === "file" ? fileMaterial : symbolMaterial, nodes.length);
    const matrix = new Matrix4();
    nodes.forEach((node, index) => {
      matrix.compose(
        new Vector3(node.base[0], node.base[1] + (node.size[1] / 2), node.base[2]),
        FACING,
        new Vector3(...node.size)
      );
      mesh.setMatrixAt(index, matrix);
      const base = colourOf(node);
      mesh.setColorAt(index, base);
      paint.set(node.key, {
        base,
        apply: (color) => {
          mesh.setColorAt(index, color);
          if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
        }
      });
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.keys = nodes.map((node) => node.key);
    content.add(mesh);
    pickables.push(mesh);
  };

  const buildLines = (): void => {
    const stems: number[] = [];
    for (const node of model.nodes) {
      if (node.level === "package") continue;
      stems.push(...node.ground, ...node.base);
    }
    if (stems.length > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(stems, 3));
      content.add(new LineSegments(geometry, stemMaterial));
    }

    const buckets: Record<AtlasEdgePattern, { positions: number[]; colors: number[] }> = {
      solid: { positions: [], colors: [] },
      dashed: { positions: [], colors: [] },
      dotted: { positions: [], colors: [] }
    };
    for (const edge of model.edges) {
      const bucket = buckets[edge.pattern];
      const color = new Color(edge.color);
      const points = arcPoints(edge.from, edge.to);
      for (let index = 0; index < points.length - 1; index += 1) {
        const a = points[index]!;
        const b = points[index + 1]!;
        bucket.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        bucket.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
    }
    for (const pattern of ["solid", "dashed", "dotted"] as const) {
      const { positions, colors } = buckets[pattern];
      if (positions.length === 0) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      const lines = new LineSegments(geometry, edgeMaterials[pattern]);
      if (pattern !== "solid") lines.computeLineDistances();
      content.add(lines);
    }

    const selected = model.nodes.find((node) => node.selected);
    if (selected !== undefined) {
      // A ring on the ground under the selection says where it stands.
      const radius = Math.max(selected.size[0], selected.size[2]) * 0.9 + 0.6;
      const marker = new Mesh(new RingGeometry(radius, radius + 0.45, 40), markerMaterial);
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(selected.ground[0], selected.level === "package" ? PLATE_THICKNESS + 0.06 : 0.06, selected.ground[2]);
      content.add(marker);
    }
  };

  const syncLabels = (): void => {
    for (const [key, label] of labels) {
      if (nodeByKey.has(key)) continue;
      labelLayer.remove(label);
      labels.delete(key);
    }
    for (const node of model.nodes) {
      let label = labels.get(node.key);
      if (label === undefined) {
        const element = document.createElement("div");
        label = new CSS2DObject(element);
        labels.set(node.key, label);
        labelLayer.add(label);
      }
      const element = label.element;
      element.className = `atlas3d-label atlas3d-label-${node.level}`;
      element.textContent = node.label;
      element.dataset.selected = String(node.selected);
      label.position.set(...node.anchor);
    }
  };

  const textWidth = (node: SceneNode): number => {
    const cacheKey = `${node.level}\u0000${node.label}`;
    let width = textWidths.get(cacheKey);
    if (width === undefined) {
      if (measure !== null) {
        measure.font = node.level === "package"
          ? `600 ${String(LABEL_SIZE_PX)}px ${labelFont}`
          : `400 ${String(LABEL_SIZE_PX)}px ${uiFont}`;
      }
      // A package label is a small plaque: its padding is part of its box.
      width = (measure?.measureText(node.label).width ?? node.label.length * 6.5) + (node.level === "package" ? 14 : 0);
      textWidths.set(cacheKey, width);
    }
    return width;
  };

  const project = (point: Vec3): ViewportPosition | undefined => {
    scratch.set(...point).project(camera);
    if (scratch.z < -1 || scratch.z > 1) return undefined;
    return { x: ((scratch.x + 1) / 2) * host.clientWidth, y: ((1 - scratch.y) / 2) * host.clientHeight };
  };

  /**
   * Packages and the selected or hovered node are always named. Files and
   * symbols are named once they are near enough to be read, nearest first,
   * and only where their label clears every other label and block.
   */
  const placeVisibleLabels = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    const pixelsPerUnitAtOne = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const requests: LabelRequest[] = [];
    const obstacles: LabelObstacle[] = [];
    const radii = new Map<string, number>();
    for (const node of model.nodes) {
      const point = project(node.anchor);
      if (point === undefined || point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) continue;
      const distance = camera.position.distanceTo(scratch.set(...node.anchor));
      const radius = (Math.max(node.size[0], node.size[1]) / 2) * (pixelsPerUnitAtOne / Math.max(distance, 0.001));
      radii.set(node.key, radius);
      if (node.level !== "package") {
        obstacles.push({ key: node.key, box: { x: point.x - radius, y: point.y, width: 2 * radius, height: 2 * radius } });
      }
      const forced = node.level === "package" || node.selected || node.key === hovered;
      if (!forced && (node.dimmed || radius < LABEL_MIN_RADIUS_PX)) continue;
      requests.push({ key: node.key, x: point.x, y: point.y, radius, textWidth: textWidth(node), labelSize: LABEL_SIZE_PX, forced });
    }
    const placed = new Map(placeLabels(requests, obstacles).map((label) => [label.key, label.slot]));
    for (const [key, label] of labels) {
      const slot = placed.get(key);
      label.visible = slot !== undefined;
      if (slot === undefined) continue;
      const [cx, cy] = SLOT_CENTRE[slot];
      label.center.set(cx, cy);
      label.element.dataset.slot = slot;
      label.element.style.setProperty("--atlas3d-gap", `${String(Math.round((radii.get(key) ?? 0) + 3))}px`);
    }
  };

  const publishViewport = (): void => {
    const onChange = callbacks.current.onViewportPositionsChange;
    if (onChange === undefined) return;
    const positions = new Map<string, ViewportPosition>();
    for (const node of model.nodes) {
      if (positions.has(node.entityKey)) continue;
      const point = project(node.anchor);
      if (point !== undefined) positions.set(node.entityKey, point);
    }
    onChange(positions);
  };

  const flyTo = (target: Vector3, position: Vector3): void => {
    if (reducedMotion) {
      flight = null;
      controls.target.copy(target);
      camera.position.copy(position);
      controls.update();
      viewDirty = true;
      return;
    }
    flight = {
      fromPosition: camera.position.clone(),
      toPosition: position,
      fromTarget: controls.target.clone(),
      toTarget: target,
      start: performance.now()
    };
  };

  /** Every point the map draws: ground points, block tops and slab corners. */
  const extentPoints = (): Vector3[] => [
    ...model.nodes.flatMap((node) => [new Vector3(...node.ground), new Vector3(...node.anchor)]),
    ...model.plates.flatMap((plate) => plate.outline.map((point) => new Vector3(point.x, 0, point.y)))
  ];

  const bounds = (points: readonly Vector3[]): Sphere => {
    const box = new Box3().setFromPoints([...points]);
    const sphere = box.isEmpty() ? new Sphere(new Vector3(), 10) : box.getBoundingSphere(new Sphere());
    sphere.radius = Math.max(sphere.radius, 10);
    return sphere;
  };

  /** Ground, grid, fog, shadow and clipping sized to what is drawn. */
  const frameSurroundings = (sphere: Sphere, distance: number): void => {
    const { center, radius } = sphere;
    ground.scale.set(radius * 12, radius * 12, 1);
    ground.position.set(center.x, 0, center.z);
    if (grid !== null) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as LineBasicMaterial).dispose();
    }
    const cell = 10;
    const cells = Math.ceil((radius * 6) / cell);
    grid = new GridHelper(cells * cell, cells, colours.copper, colours.copper);
    const gridMaterial = grid.material as LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.16;
    gridMaterial.depthWrite = false;
    grid.position.set(Math.round(center.x / cell) * cell, 0.02, Math.round(center.z / cell) * cell);
    scene.add(grid);
    scene.fog = new Fog(colours.ground, distance * 1.1, distance * 3.2);
    camera.near = Math.max(0.1, distance / 200);
    camera.far = distance * 12;
    camera.updateProjectionMatrix();
    controls.minDistance = 2;
    controls.maxDistance = distance * 4;
    // Lit from the upper left of the default view, as every plate in the app is.
    sun.position.copy(center).add(new Vector3(-0.42, 1.6, 0.99).multiplyScalar(radius * 2));
    sun.target.position.copy(center);
    const shadow = sun.shadow.camera;
    shadow.left = -radius * 1.3;
    shadow.right = radius * 1.3;
    shadow.top = radius * 1.3;
    shadow.bottom = -radius * 1.3;
    shadow.near = 0.1;
    shadow.far = radius * 8;
    shadow.updateProjectionMatrix();
  };

  /**
   * The isometric three-quarter view, as close as it can be while every point
   * stays on screen. A bounding sphere alone leaves a long, diagonal map small
   * in the middle of the stage, so the sphere's view is refined against where
   * the points actually project: recentred, then scaled to the margin.
   */
  const reset = (): void => {
    const points = extentPoints();
    const sphere = bounds(points);
    const direction = isometricDirection();
    const vertical = (camera.fov * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    let distance = sphere.radius / Math.sin(Math.min(vertical, horizontal) / 2);
    const target = sphere.center.clone();
    const probe = camera.clone();
    const right = new Vector3();
    const up = new Vector3();
    for (let pass = 0; pass < 3 && points.length > 0; pass += 1) {
      probe.position.copy(target).addScaledVector(direction, distance);
      probe.lookAt(target);
      probe.updateMatrixWorld();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of points) {
        const ndc = scratch.copy(point).project(probe);
        minX = Math.min(minX, ndc.x);
        maxX = Math.max(maxX, ndc.x);
        minY = Math.min(minY, ndc.y);
        maxY = Math.max(maxY, ndc.y);
      }
      right.setFromMatrixColumn(probe.matrixWorld, 0);
      up.setFromMatrixColumn(probe.matrixWorld, 1);
      const halfHeight = distance * Math.tan(vertical / 2);
      target
        .addScaledVector(right, ((minX + maxX) / 2) * halfHeight * camera.aspect)
        .addScaledVector(up, ((minY + maxY) / 2) * halfHeight);
      const fill = Math.max((maxX - minX) / 2, (maxY - minY) / 2) / 0.86;
      distance *= Math.max(fill, 0.05);
    }
    frameSurroundings(sphere, distance);
    flyTo(target, target.clone().addScaledVector(direction, distance));
  };

  const rebuild = (): void => {
    disposeContent();
    model = graph === null ? { nodes: [], plates: [], edges: [] } : buildAtlasScene(graph);
    nodeByKey = new Map(model.nodes.map((node) => [node.key, node]));
    pickables = [];
    paint = new Map();
    buildPlates();
    buildBlocks("file");
    buildBlocks("symbol");
    buildLines();
    syncLabels();
    canvas.setAttribute("aria-label", describeScene(model));
    if (hovered !== null && !nodeByKey.has(hovered)) hovered = null;
    highlight(hovered);
  };

  const highlight = (key: string | null): void => {
    if (hovered !== null && hovered !== key) {
      const previous = paint.get(hovered);
      previous?.apply(previous.base);
    }
    hovered = key;
    const current = key === null ? undefined : paint.get(key);
    current?.apply(current.base.clone().lerp(colours.panel, 0.45));
    canvas.style.cursor = key === null ? "" : "pointer";
  };

  const pick = (clientX: number, clientY: number): string | null => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const [hit] = raycaster.intersectObjects(pickables, false);
    if (hit === undefined) return null;
    if (hit.object instanceof InstancedMesh && hit.instanceId !== undefined) {
      return (hit.object.userData.keys as string[])[hit.instanceId] ?? null;
    }
    return typeof hit.object.userData.key === "string" ? hit.object.userData.key : null;
  };

  const tick = (now: number): void => {
    if (modelDirty) {
      modelDirty = false;
      rebuild();
      // Frame the map when what it holds changes (landing, expansion,
      // collapse), not when a refetch or a selection restyles the same nodes.
      const nodes = model.nodes.map((node) => node.key).join("\n");
      if (nodes !== fittedNodes) {
        fittedNodes = nodes;
        reset();
      }
      viewDirty = true;
    }
    if (flight !== null) {
      const t = Math.min(1, (now - flight.start) / FLIGHT_MS);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
      camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
      if (t === 1) flight = null;
      viewDirty = true;
    }
    if (controls.update()) viewDirty = true;
    if (pointer !== null) {
      const key = pick(pointer.x, pointer.y);
      pointer = null;
      if (key !== hovered) {
        highlight(key);
        viewDirty = true;
      }
    }
    if (!viewDirty) return;
    viewDirty = false;
    renderer.render(scene, camera);
    placeVisibleLabels();
    labelRenderer.render(scene, camera);
    publishViewport();
  };

  const resize = (): void => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewDirty = true;
  };
  resize();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  observer?.observe(host);

  const markView = (): void => {
    viewDirty = true;
  };
  controls.addEventListener("change", markView);
  controls.addEventListener("start", () => {
    flight = null;
  });

  let down: { x: number; y: number } | null = null;
  const onPointerDown = (event: PointerEvent): void => {
    down = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (down === null) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    down = null;
    if (moved > CLICK_SLOP_PX) return;
    const key = pick(event.clientX, event.clientY);
    if (key !== null) callbacks.current.onSelect(key);
  };
  const onPointerMove = (event: PointerEvent): void => {
    pointer = new Vector2(event.clientX, event.clientY);
  };
  const onPointerLeave = (): void => {
    pointer = null;
    if (hovered !== null) {
      highlight(null);
      viewDirty = true;
    }
  };
  const onDoubleClick = (event: MouseEvent): void => {
    const key = pick(event.clientX, event.clientY);
    if (key !== null) callbacks.current.onActivate(key);
  };
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    callbacks.current.onError(new Error("The 3D map lost its WebGL context."));
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("dblclick", onDoubleClick);
  canvas.addEventListener("webglcontextlost", onContextLost);

  const handle: Atlas3DHandle = {
    focus(key) {
      const node = nodeByKey.get(key);
      if (node === undefined) return;
      const target = new Vector3(...node.anchor);
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.min(offset.length(), 45);
      flyTo(target, target.clone().add(offset.setLength(distance)));
    },
    reset,
    zoom(factor) {
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor));
      flyTo(controls.target.clone(), controls.target.clone().add(offset.setLength(distance)));
    },
    screenPosition(key) {
      const node = nodeByKey.get(key);
      return node === undefined ? undefined : project(node.anchor);
    }
  };

  return {
    setGraph(next) {
      graph = next;
      modelDirty = true;
      // Any mutation, structural or a restyle, redraws on the next frame; a
      // burst of attribute writes coalesces into one rebuild.
      const invalidate = (): void => {
        modelDirty = true;
      };
      for (const event of GRAPH_EVENTS) next.on(event, invalidate);
      return () => {
        for (const event of GRAPH_EVENTS) next.off(event, invalidate);
      };
    },
    setActive(active) {
      renderer.setAnimationLoop(active ? tick : null);
      if (active) {
        resize();
        viewDirty = true;
      }
    },
    handle,
    dispose() {
      renderer.setAnimationLoop(null);
      observer?.disconnect();
      controls.removeEventListener("change", markView);
      controls.dispose();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      disposeContent();
      for (const label of labels.values()) labelLayer.remove(label);
      labels.clear();
      if (grid !== null) {
        grid.geometry.dispose();
        (grid.material as LineBasicMaterial).dispose();
      }
      ground.geometry.dispose();
      for (const material of [groundMaterial, fileMaterial, symbolMaterial, stemMaterial, rimMaterial, markerMaterial, ...Object.values(edgeMaterials)]) {
        material.dispose();
      }
      blockGeometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      labelRenderer.domElement.remove();
    }
  };
}

const GRAPH_EVENTS = [
  "nodeAdded",
  "nodeDropped",
  "edgeAdded",
  "edgeDropped",
  "cleared",
  "edgesCleared",
  "attributesUpdated",
  "nodeAttributesUpdated",
  "edgeAttributesUpdated",
  "eachNodeAttributesUpdated",
  "eachEdgeAttributesUpdated"
] as const;

/**
 * The 3D Atlas: a three.js scene over the same live graph Plan draws. Loaded
 * only when 3D is chosen, in its own chunk. Selection, expansion and keyboard
 * handling stay with the map that owns the graph; this stage only draws it and
 * reports what the pointer touched.
 */
export function Atlas3DStage({
  graph,
  active,
  handleRef,
  onSelect,
  onActivate,
  onPointerDown,
  onViewportPositionsChange,
  onError
}: Atlas3DStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World | null>(null);
  const callbacks = useRef<Callbacks>({ onSelect, onActivate, onViewportPositionsChange, onError });
  callbacks.current = { onSelect, onActivate, onViewportPositionsChange, onError };
  const activeRef = useRef(active);
  activeRef.current = active;

  // One WebGL world per mount. A refetched graph is swapped in below, so the
  // camera and the GPU context survive it.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let world: World;
    try {
      world = createWorld(host, callbacks);
    } catch (error) {
      callbacks.current.onError(asError(error));
      return;
    }
    worldRef.current = world;
    world.setActive(activeRef.current);
    return () => {
      world.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => worldRef.current?.setGraph(graph), [graph]);

  useEffect(() => {
    worldRef.current?.setActive(active);
  }, [active]);

  useImperativeHandle(handleRef, () => ({
    focus: (key) => worldRef.current?.handle.focus(key),
    reset: () => worldRef.current?.handle.reset(),
    zoom: (factor) => worldRef.current?.handle.zoom(factor),
    screenPosition: (key) => worldRef.current?.handle.screenPosition(key)
  }), []);

  return <div ref={hostRef} className="atlas3d-stage" onPointerDown={onPointerDown} />;
}
