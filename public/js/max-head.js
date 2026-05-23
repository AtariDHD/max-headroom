import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const MODEL_URL = "/assets/MaxHeadRoom.vrm";
// three-vrm maps VRM0 presets to VRM1 names (aa/ih/ou/ee/oh)
const VISEMES = ["aa", "ih", "ou", "ee", "oh"];
const HEAD_TILT_BACK = (5 * Math.PI) / 180;

/**
 * Purchased Max Headroom VRM — lip sync via VRM0 viseme expressions.
 */
export class MaxHead {
  constructor() {
    this.group = new THREE.Group();
    this.vrm = null;
    this.loaded = false;
    this._mouth = { level: 0, low: 0, mid: 0, high: 0 };
    this._blinkAt = performance.now() + 2500;
    this._glitchUntil = 0;
    this.loading = this._load();
  }

  _load() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(
        MODEL_URL,
        (gltf) => {
          const vrm = gltf.userData.vrm;
          if (!vrm) {
            reject(new Error("No VRM data in model file"));
            return;
          }

          VRMUtils.rotateVRM0(vrm);
          this.vrm = vrm;
          this.group.add(vrm.scene);

          vrm.scene.traverse((obj) => {
            if (obj.isMesh) {
              obj.frustumCulled = false;
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });

          this._tuneMaterials();
          this._frameModel();
          this._setExpression("neutral", 1);
          this.vrm.update(0);
          this._captureHeadRest();
          this.loaded = true;
          resolve(vrm);
        },
        undefined,
        reject
      );
    });
  }

  _frameModel() {
    const head = this.vrm?.humanoid?.getNormalizedBoneNode("head");
    if (!head) return;

    this.vrm.scene.updateMatrixWorld(true);
    const headPos = new THREE.Vector3();
    head.getWorldPosition(headPos);

    // Base placement — fine-tuned by scene camera framing
    this.group.position.y = -headPos.y + 0.88;
    this._baseGroupY = this.group.position.y;
  }

  /** Move model down in the viewport (camera stays fixed). */
  shiftInView(deltaY) {
    this.group.position.y = this._baseGroupY + deltaY;
  }

  _tuneMaterials() {
    this.vrm.scene.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        const name = (mat.name ?? "").toLowerCase();
        mat.toneMapped = true;

        if (mat.color) {
          mat.color.multiplyScalar(name.includes("head") ? 1.05 : 1.08);
        }

        if (name.includes("head")) {
          mat.roughness = THREE.MathUtils.clamp(mat.roughness ?? 0.5, 0.78, 0.96);
          mat.metalness = 0;
        } else {
          mat.roughness = THREE.MathUtils.clamp(mat.roughness ?? 0.5, 0.62, 0.85);
          mat.metalness = 0;
          if (mat.emissiveMap || (mat.emissiveIntensity ?? 0) > 0) {
            mat.emissive?.set(0, 0, 0);
            mat.emissiveIntensity = 0;
            mat.emissiveMap = null;
          }
        }
      }
    });
  }

  /** Head world position for camera framing */
  getHeadTarget() {
    const head = this.vrm?.humanoid?.getNormalizedBoneNode("head");
    const target = new THREE.Vector3(0, 1.0, 0);
    if (!head) return target;
    head.getWorldPosition(target);
    return target;
  }

  _setExpression(name, value) {
    const em = this.vrm?.expressionManager;
    if (!em) return;
    em.setValue(name, value);
    em.update();
  }

  /** @param {number|{level:number,low?:number,mid?:number,high?:number}} input */
  setMouthOpen(input) {
    if (typeof input === "number") {
      const level = input;
      this._mouth = {
        level,
        low: level * 0.45,
        mid: level * 0.35,
        high: level * 0.2,
      };
    } else {
      this._mouth = { ...this._mouth, ...input };
    }
    this._applyVisemes();
  }

  _applyVisemes() {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    const { level, low, mid, high } = this._mouth;
    const open = THREE.MathUtils.clamp(level, 0, 1);

    for (const v of VISEMES) em.setValue(v, 0);

    if (open < 0.04) {
      em.setValue("neutral", 1);
      em.update();
      return;
    }

    em.setValue("neutral", 0);
    const sum = low + mid + high + 0.001;
    em.setValue("oh", (low / sum) * open * 0.9);
    em.setValue("ou", (low / sum) * open * 0.45);
    em.setValue("aa", (mid / sum) * open * 0.95);
    em.setValue("ee", (mid / sum) * open * 0.5);
    em.setValue("ih", (high / sum) * open * 0.85);
    em.update();
  }

  stutterNod(intensity = 1) {
    this._stutterUntil = performance.now() + 120;
    this._stutterIntensity = intensity;
  }

  _headBone() {
    return this.vrm?.humanoid?.getNormalizedBoneNode("head") ?? null;
  }

  _captureHeadRest() {
    const head = this._headBone();
    if (head && !this._headRest) {
      this._headRest = head.quaternion.clone();
    }
  }

  _applyHeadMotion(time, speaking) {
    const head = this._headBone();
    if (!head || !this._headRest) return;

    head.quaternion.copy(this._headRest);

    const t = time * 0.001;
    const tilt = new THREE.Euler(0, 0, 0, "XYZ");

    if (this._stutterUntil && performance.now() < this._stutterUntil) {
      const k = this._stutterIntensity ?? 1;
      tilt.x = HEAD_TILT_BACK + (Math.random() - 0.5) * 0.12 * k;
      tilt.y = (Math.random() - 0.5) * 0.1 * k;
    } else if (speaking) {
      tilt.x = HEAD_TILT_BACK + Math.sin(t * 10) * 0.018;
      tilt.y = Math.sin(t * 6.5) * 0.01;
    } else {
      tilt.x = HEAD_TILT_BACK + Math.sin(t * 0.55) * 0.006;
      tilt.y = Math.sin(t * 0.4) * 0.008;
    }

    head.quaternion.multiply(new THREE.Quaternion().setFromEuler(tilt));
  }

  update(time, speaking = false) {
    if (!this.loaded) return;

    // Keep the full body anchored — no group sway
    this.group.position.x = 0;
    this.group.rotation.set(0, 0, 0);

    if (this.vrm) {
      this.vrm.update(0.016);
    }

    this._captureHeadRest();
    this._applyHeadMotion(time, speaking);

    if (performance.now() > this._glitchUntil && performance.now() > this._blinkAt) {
      this._blink();
    }
  }

  _blink() {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    em.setValue("blink", 1);
    em.update();
    setTimeout(() => {
      em.setValue("blink", 0);
      em.update();
    }, 90);

    this._blinkAt = performance.now() + 2200 + Math.random() * 3200;
  }

  applyGlitch(strength = 1) {
    this._glitchUntil = performance.now() + 150;
    const em = this.vrm?.expressionManager;
    if (em) {
      em.setValue("relaxed", strength * 0.35);
      em.update();
      setTimeout(() => {
        em.setValue("relaxed", 0);
        em.update();
      }, 90);
    }
  }

  resetGeometry() {
    /* Skinned VRM mesh — glitch is expression/ transform based */
  }
}
