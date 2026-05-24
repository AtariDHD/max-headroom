import * as THREE from "three";

const BOUNDS = {
  rx: { min: -17, max: 15 },
  ry: { min: -20, max: 16 },
  rz: { min: -5, max: 40 },
  scale: { min: 0.3, max: 2.25 },
};

const DURATION = {
  fast: { min: 1800, max: 4200 },
  slow: { min: 6500, max: 14000 },
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randIn({ min, max }) {
  return rand(min, max);
}

function readState(cube) {
  const r = cube.rotation;
  return {
    rx: THREE.MathUtils.radToDeg(r.x),
    ry: THREE.MathUtils.radToDeg(r.y),
    rz: THREE.MathUtils.radToDeg(r.z),
    scale: cube.scale.x,
  };
}

function applyState(cube, { rx, ry, rz, scale }) {
  cube.rotation.order = "YXZ";
  cube.rotation.x = THREE.MathUtils.degToRad(rx);
  cube.rotation.y = THREE.MathUtils.degToRad(ry);
  cube.rotation.z = THREE.MathUtils.degToRad(rz);
  cube.scale.setScalar(scale);
}

/**
 * Smoothly drifts cube corner rotation + scale between random targets.
 */
export class CubeCornerAnimator {
  /** @param {() => import("three").Group | null} getCube */
  constructor(getCube) {
    this.getCube = getCube;
    this._from = null;
    this._to = null;
    this._startMs = 0;
    this._durationMs = 4000;
    this._active = false;
  }

  start() {
    const cube = this.getCube();
    if (!cube) return;

    this._from = readState(cube);
    this._to = this._randomTarget(this._from);
    this._durationMs = this._randomDuration();
    this._startMs = performance.now();
    this._active = true;
  }

  update(_timeMs) {
    if (!this._active) return;
    const cube = this.getCube();
    if (!cube || !this._from || !this._to) return;

    const elapsed = performance.now() - this._startMs;
    const raw = Math.min(1, elapsed / this._durationMs);
    const t = easeInOutCubic(raw);

    applyState(cube, {
      rx: lerp(this._from.rx, this._to.rx, t),
      ry: lerp(this._from.ry, this._to.ry, t),
      rz: lerp(this._from.rz, this._to.rz, t),
      scale: lerp(this._from.scale, this._to.scale, t),
    });

    if (raw >= 1) {
      this._from = readState(cube);
      this._to = this._randomTarget(this._from);
      this._durationMs = this._randomDuration();
      this._startMs = performance.now();
    }
  }

  /** Pick a target away from current so motion stays visible. */
  _randomTarget(current) {
    const pick = (key) => {
      const { min, max } = BOUNDS[key];
      const span = max - min;
      let value;
      let attempts = 0;
      do {
        value = randIn(BOUNDS[key]);
        attempts++;
      } while (attempts < 8 && Math.abs(value - current[key]) < span * 0.18);
      return value;
    };

    return {
      rx: pick("rx"),
      ry: pick("ry"),
      rz: pick("rz"),
      scale: pick("scale"),
    };
  }

  _randomDuration() {
    const bucket = Math.random() < 0.45 ? DURATION.fast : DURATION.slow;
    return rand(bucket.min, bucket.max);
  }
}
