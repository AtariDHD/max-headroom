import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

const DEFAULT_LINE_WIDTH = 2;

function createLineFace(points, color, { opacity = 0.85, lineWidth = DEFAULT_LINE_WIDTH } = {}) {
  const positions = [];
  for (const point of points) {
    positions.push(point.x, point.y, point.z);
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color,
    linewidth: lineWidth,
    transparent: true,
    opacity,
    depthWrite: false,
  });

  const lines = new LineSegments2(geometry, material);
  lines.computeLineDistances();
  return lines;
}

/** Floor (XZ) — vertical lines parallel to Z. */
function floorVerticalLines(y, x0, x1, z0, z1, divisions) {
  const points = [];
  const dx = (x1 - x0) / divisions;
  for (let i = 0; i <= divisions; i++) {
    const x = x0 + i * dx;
    points.push(new THREE.Vector3(x, y, z0), new THREE.Vector3(x, y, z1));
  }
  return points;
}

/** Side wall (YZ) — horizontal lines parallel to Z. */
function wallHorizontalLinesYZ(x, y0, y1, z0, z1, divisions) {
  const points = [];
  const dy = (y1 - y0) / divisions;
  for (let i = 0; i <= divisions; i++) {
    const y = y0 + i * dy;
    points.push(new THREE.Vector3(x, y, z0), new THREE.Vector3(x, y, z1));
  }
  return points;
}

/** Back wall (XY) — horizontal lines parallel to X. */
function wallHorizontalLinesXY(z, x0, x1, y0, y1, divisions) {
  const points = [];
  const dy = (y1 - y0) / divisions;
  for (let i = 0; i <= divisions; i++) {
    const y = y0 + i * dy;
    points.push(new THREE.Vector3(x0, y, z), new THREE.Vector3(x1, y, z));
  }
  return points;
}

function createCornerEdges(x0, y0, z0, x1, y1, z1, lineWidth) {
  const points = [
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x1, y0, z0),
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x0, y1, z0),
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x0, y0, z1),
  ];
  return createLineFace(points, 0x39ff14, { opacity: 0.95, lineWidth });
}

/** LineMaterial needs canvas resolution for correct pixel width. */
export function updateCubeCornerResolution(group, width, height) {
  group?.traverse((obj) => {
    if (obj.material?.isLineMaterial) {
      obj.material.resolution.set(width, height);
    }
  });
}

/**
 * Wireframe cube corner — geometry built from local origin (the corner vertex).
 */
export function createCubeCorner(options = {}) {
  const size = options.size ?? 20;
  const divisions = options.divisions ?? 36;
  const lineWidth = options.lineWidth ?? DEFAULT_LINE_WIDTH;
  const group = new THREE.Group();

  const x0 = 0;
  const y0 = 0;
  const z0 = 0;
  const x1 = size;
  const y1 = size;
  const z1 = -size;

  const floor = createLineFace(
    floorVerticalLines(y0, x0, x1, z1, z0, divisions),
    0x39ff14,
    { lineWidth }
  );
  const leftWall = createLineFace(
    wallHorizontalLinesYZ(x0, y0, y1, z1, z0, divisions),
    0xfffd00,
    { lineWidth }
  );
  const backWall = createLineFace(
    wallHorizontalLinesXY(z1, x0, x1, y0, y1, divisions),
    0xff2bd6,
    { lineWidth }
  );
  const edges = createCornerEdges(x0, y0, z0, x1, y1, z1, lineWidth);

  group.add(floor, leftWall, backWall, edges);
  return group;
}
