import * as THREE from "three";

function createLineFace(points, color, opacity = 0.85) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
  });
  return new THREE.LineSegments(geometry, material);
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

function createCornerEdges(x0, y0, z0, x1, y1, z1) {
  const points = [
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x1, y0, z0),
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x0, y1, z0),
    new THREE.Vector3(x0, y0, z0),
    new THREE.Vector3(x0, y0, z1),
  ];
  return createLineFace(points, 0x39ff14, 0.95);
}

/**
 * Wireframe cube corner — geometry built from local origin (the corner vertex).
 */
export function createCubeCorner(options = {}) {
  const size = options.size ?? 4.5;
  const divisions = options.divisions ?? 36;
  const group = new THREE.Group();

  const x0 = 0;
  const y0 = 0;
  const z0 = 0;
  const x1 = size;
  const y1 = size;
  const z1 = -size;

  const floor = createLineFace(
    floorVerticalLines(y0, x0, x1, z1, z0, divisions),
    0x39ff14
  );
  const leftWall = createLineFace(
    wallHorizontalLinesYZ(x0, y0, y1, z1, z0, divisions),
    0xffdd00
  );
  const backWall = createLineFace(
    wallHorizontalLinesXY(z1, x0, x1, y0, y1, divisions),
    0xff2bd6
  );
  const edges = createCornerEdges(x0, y0, z0, x1, y1, z1);

  group.add(floor, leftWall, backWall, edges);
  return group;
}
