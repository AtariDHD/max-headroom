import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const MODEL_URL = "/assets/MaxHeadRoom.vrm";
// three-vrm maps VRM0 presets to VRM1 names (aa/ih/ou/ee/oh)
const VISEMES = ["aa", "ih", "ou", "ee", "oh"];
const HEAD_TILT_BACK = (5 * Math.PI) / 180;

const lerp = (a, b, t) => a + (b - a) * t;

/** All movements exposed for the debug panel (VRM1 expression names). */
export const MOVEMENTS = [
  { id: "viseme-aa", label: "Viseme: aa (wide open)", group: "Mouth", type: "expression", name: "aa" },
  { id: "viseme-ih", label: "Viseme: ih (narrow)", group: "Mouth", type: "expression", name: "ih" },
  { id: "viseme-ou", label: "Viseme: ou (rounded)", group: "Mouth", type: "expression", name: "ou" },
  { id: "viseme-ee", label: "Viseme: ee (smile)", group: "Mouth", type: "expression", name: "ee" },
  { id: "viseme-oh", label: "Viseme: oh (O-shape)", group: "Mouth", type: "expression", name: "oh" },
  { id: "mouth-blend-full", label: "Mouth: blended open", group: "Mouth", type: "mouth-blend", level: 0.85 },
  { id: "mouth-blend-low", label: "Mouth: low band (oh/ou)", group: "Mouth", type: "mouth-blend", mouth: { level: 0.75, low: 1, mid: 0.15, high: 0 } },
  { id: "mouth-blend-mid", label: "Mouth: mid band (aa/ee)", group: "Mouth", type: "mouth-blend", mouth: { level: 0.75, low: 0.1, mid: 1, high: 0.15 } },
  { id: "mouth-blend-high", label: "Mouth: high band (ih)", group: "Mouth", type: "mouth-blend", mouth: { level: 0.75, low: 0, mid: 0.15, high: 1 } },
  { id: "expr-blink", label: "Blink (both eyes)", group: "Face", type: "blink", both: true },
  { id: "expr-blink-left", label: "Blink left", group: "Face", type: "expression", name: "blinkLeft", duration: 180 },
  { id: "expr-blink-right", label: "Blink right", group: "Face", type: "expression", name: "blinkRight", duration: 180 },
  { id: "expr-happy", label: "Happy (joy)", group: "Face", type: "expression", name: "happy" },
  { id: "expr-angry", label: "Angry", group: "Face", type: "expression", name: "angry" },
  { id: "expr-sad", label: "Sad (sorrow)", group: "Face", type: "expression", name: "sad" },
  { id: "expr-relaxed", label: "Relaxed (fun)", group: "Face", type: "expression", name: "relaxed" },
  { id: "look-up", label: "Look up", group: "Face", type: "expression", name: "lookUp" },
  { id: "look-down", label: "Look down", group: "Face", type: "expression", name: "lookDown" },
  { id: "look-left", label: "Look left", group: "Face", type: "expression", name: "lookLeft" },
  { id: "look-right", label: "Look right", group: "Face", type: "expression", name: "lookRight" },
  { id: "expr-neutral", label: "Neutral (reset face)", group: "Face", type: "expression", name: "neutral", duration: 400 },
  { id: "head-stutter", label: "Head: stutter nod", group: "Head", type: "head-stutter", intensity: 2.5 },
  { id: "head-speaking", label: "Head: speaking sway", group: "Head", type: "head-speaking", duration: 2200 },
  { id: "head-idle", label: "Head: idle drift", group: "Head", type: "head-idle", duration: 3000 },
  { id: "head-turn-left", label: "Head: turn left", group: "Head", type: "head-turn", yaw: 0.6, duration: 2000 },
  { id: "head-turn-right", label: "Head: turn right", group: "Head", type: "head-turn", yaw: -0.6, duration: 2000 },
  { id: "head-tilt-up", label: "Head: tilt up", group: "Head", type: "head-turn", pitch: 0.32, duration: 2000 },
  { id: "head-tilt-down", label: "Head: tilt down", group: "Head", type: "head-turn", pitch: -0.36, duration: 2000 },
  { id: "torso-left", label: "Torso: turn left", group: "Body", type: "torso-turn", yaw: 0.45, duration: 2200 },
  { id: "torso-right", label: "Torso: turn right", group: "Body", type: "torso-turn", yaw: -0.45, duration: 2200 },
  { id: "torso-center", label: "Torso: re-center", group: "Body", type: "torso-turn", yaw: 0, duration: 1200 },
  { id: "torso-head-counter", label: "Torso turn + head to camera", group: "Body", type: "torso-head-counter", yaw: 0.45, duration: 2200 },
  { id: "glitch-full", label: "Glitch: full (screen + face)", group: "Effects", type: "external" },
  { id: "glitch-face", label: "Glitch: face expression", group: "Effects", type: "external-face" },
];

const EXPRESSION_NAMES = [
  "neutral",
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "blink",
  "blinkLeft",
  "blinkRight",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "lookUp",
  "lookDown",
  "lookLeft",
  "lookRight",
];

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

    this._updateTalkAccent(
      (speaking || this.isTestSpeaking()) && !this._comboActive
    );

    if (this._stutterUntil && performance.now() < this._stutterUntil) {
      const k = this._stutterIntensity ?? 1;
      tilt.x = HEAD_TILT_BACK + (Math.random() - 0.5) * 0.12 * k;
      tilt.y = (Math.random() - 0.5) * 0.1 * k;
    } else if (speaking || this.isTestSpeaking()) {
      // Organic talking motion — layered, incommensurate sines so it never
      // settles into a single back-and-forth rhythm. Yaw/pitch/roll combine
      // into gentle turns, nods, and tilts like a real person speaking.
      tilt.y =
        Math.sin(t * 0.9 + 0.6) * 0.055 +
        Math.sin(t * 2.3 + 1.7) * 0.022 +
        Math.sin(t * 4.6 + 0.3) * 0.008;
      tilt.x =
        HEAD_TILT_BACK +
        Math.sin(t * 1.3 + 2.1) * 0.03 +
        Math.sin(t * 0.6 + 0.4) * 0.022 +
        Math.sin(t * 3.7 + 1.1) * 0.01;
      tilt.z =
        Math.sin(t * 1.1 + 0.8) * 0.025 +
        Math.sin(t * 2.7 + 2.3) * 0.01;
      tilt.y += this._accentYaw ?? 0;
      tilt.x += this._accentPitch ?? 0;
    } else if (this.isTestIdle()) {
      tilt.x = HEAD_TILT_BACK + Math.sin(t * 0.55) * 0.012;
      tilt.y = Math.sin(t * 0.4) * 0.014;
    } else {
      tilt.x = HEAD_TILT_BACK + Math.sin(t * 0.55) * 0.006;
      tilt.y = Math.sin(t * 0.4) * 0.008;
    }

    // Held head turn (independent of the torso) — eases in, then back.
    if (this._headTurnUntil && performance.now() > this._headTurnUntil) {
      this._headTargetYaw = 0;
      this._headTargetPitch = 0;
    }
    this._headYaw = lerp(this._headYaw ?? 0, this._headTargetYaw ?? 0, 0.12);
    this._headPitch = lerp(this._headPitch ?? 0, this._headTargetPitch ?? 0, 0.12);
    tilt.y += this._headYaw;
    tilt.x += this._headPitch;

    head.quaternion.multiply(new THREE.Quaternion().setFromEuler(tilt));
  }

  // --- Torso (spine) rotation, independent of the head ---------------------

  _spineBone() {
    const h = this.vrm?.humanoid;
    return (
      h?.getNormalizedBoneNode("spine") ??
      h?.getNormalizedBoneNode("chest") ??
      h?.getNormalizedBoneNode("upperChest") ??
      null
    );
  }

  _captureSpineRest() {
    const spine = this._spineBone();
    if (spine && !this._spineRest) {
      this._spineRest = spine.quaternion.clone();
    }
  }

  _applyTorsoMotion() {
    const spine = this._spineBone();
    if (!spine || !this._spineRest) return;

    if (this._torsoTurnUntil && performance.now() > this._torsoTurnUntil) {
      this._torsoTargetYaw = 0;
    }
    this._torsoYaw = lerp(this._torsoYaw ?? 0, this._torsoTargetYaw ?? 0, 0.1);

    spine.quaternion.copy(this._spineRest);
    if (Math.abs(this._torsoYaw) > 0.0008) {
      const e = new THREE.Euler(0, this._torsoYaw, 0, "XYZ");
      spine.quaternion.multiply(new THREE.Quaternion().setFromEuler(e));
    }
  }

  /** Turn the head only (torso stays put). */
  turnHead(yaw = 0, pitch = 0, durationMs = 2000) {
    this._headTargetYaw = yaw;
    this._headTargetPitch = pitch;
    this._headTurnUntil = performance.now() + durationMs;
  }

  /** Turn the torso (head rides along, as in a real body). */
  turnTorso(yaw = 0, durationMs = 2000) {
    this._torsoTargetYaw = yaw;
    this._torsoTurnUntil = performance.now() + durationMs;
  }

  /**
   * Called when Max starts/stops talking. While speaking, a fresh torso+head
   * pose is chosen at each sentence start (see nextSpeakingPose); on stop the
   * pose eases back to center.
   */
  setSpeaking(value) {
    if (value === this._speakingActive) return;
    this._speakingActive = value;
    if (value) this._comboActive = true;
    else this._endSpeakingGesture();
  }

  /**
   * Pick a fresh torso+head combo pose — called at the start of each sentence.
   * The torso turns a random direction; the head usually counter-turns to face
   * the camera, with variety: chin up while turned, glancing away, head leading
   * further, or a dramatic look-away that snaps back to camera a beat later.
   */
  nextSpeakingPose() {
    if (!this._speakingActive) return;
    clearTimeout(this._comboPhaseTimer);
    this._comboActive = true;

    const dir = Math.random() < 0.5 ? 1 : -1;
    const torso = dir * (0.28 + Math.random() * 0.2); // ~16–27°
    this._torsoTargetYaw = torso;
    this._torsoTurnUntil = 0; // held; released on speech end

    const faceCam = -torso + (Math.random() - 0.5) * 0.08; // head ~faces camera
    const r = Math.random();

    if (r < 0.32) {
      // Turned, facing camera, roughly level.
      this._headTargetYaw = faceCam;
      this._headTargetPitch = (Math.random() - 0.5) * 0.05;
    } else if (r < 0.58) {
      // Turned, facing camera, chin up a little.
      this._headTargetYaw = faceCam;
      this._headTargetPitch = 0.12 + Math.random() * 0.12;
    } else if (r < 0.76) {
      // Turned, glancing away from the camera while looking up.
      this._headTargetYaw = -torso * 0.35;
      this._headTargetPitch = 0.1 + Math.random() * 0.12;
    } else if (r < 0.9) {
      // Turned, head leading further the same way, slight downward.
      this._headTargetYaw = -torso * 0.7;
      this._headTargetPitch = -0.05 - Math.random() * 0.06;
    } else {
      // Dramatic: look away with the torso, then snap to camera a beat later.
      this._headTargetYaw = 0;
      this._headTargetPitch = 0.06 + Math.random() * 0.08;
      this._comboPhaseTimer = setTimeout(() => {
        if (!this._speakingActive) return;
        this._headTargetYaw = faceCam;
        this._headTargetPitch = (Math.random() - 0.5) * 0.05;
      }, 600 + Math.random() * 400);
    }
    this._headTurnUntil = 0;
  }

  _endSpeakingGesture() {
    clearTimeout(this._comboPhaseTimer);
    this._comboActive = false;
    this._torsoTargetYaw = 0;
    this._headTargetYaw = 0;
    this._headTargetPitch = 0;
  }

  /**
   * Occasional larger head turns layered over the talking micro-motion, so
   * Max sometimes glances/turns more noticeably mid-sentence. Disabled while
   * the torso+head combo is running (that pose is deliberate).
   */
  _updateTalkAccent(active) {
    const now = performance.now();
    if (!active) {
      this._accentTargetYaw = 0;
      this._accentTargetPitch = 0;
    } else if (!this._nextAccentAt || now > this._nextAccentAt) {
      if (Math.random() < 0.6) {
        const sign = Math.random() < 0.5 ? 1 : -1;
        this._accentTargetYaw = sign * (0.12 + Math.random() * 0.13);
        this._accentTargetPitch = (Math.random() - 0.5) * 0.12;
      } else {
        this._accentTargetYaw = 0;
        this._accentTargetPitch = 0;
      }
      this._nextAccentAt = now + 1700 + Math.random() * 2300;
    }
    this._accentYaw = lerp(this._accentYaw ?? 0, this._accentTargetYaw ?? 0, 0.045);
    this._accentPitch = lerp(this._accentPitch ?? 0, this._accentTargetPitch ?? 0, 0.045);
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
    this._captureSpineRest();
    this._applyTorsoMotion();
    this._applyHeadMotion(time, speaking);

    const testing = this._testUntil && performance.now() < this._testUntil;
    if (
      !testing &&
      performance.now() > this._glitchUntil &&
      performance.now() > this._blinkAt
    ) {
      this._blink();
    }
  }

  /** @returns {typeof MOVEMENTS[number] | undefined} */
  getMovement(id) {
    return MOVEMENTS.find((m) => m.id === id);
  }

  /**
   * Play a debug movement. Returns false if delegated externally (glitch).
   * @returns {{ handled: boolean, movement?: typeof MOVEMENTS[number] }}
   */
  playMovement(id) {
    const movement = this.getMovement(id);
    if (!movement || !this.loaded) return { handled: false };

    if (movement.type === "external" || movement.type === "external-face") {
      return { handled: false, movement };
    }

    clearTimeout(this._testResetTimer);

    switch (movement.type) {
      case "expression":
        this._playExpression(movement.name, movement.duration ?? 700, movement.name === "neutral" ? 1 : 1);
        break;
      case "mouth-blend":
        if (movement.mouth) this.setMouthOpen(movement.mouth);
        else this.setMouthOpen(movement.level ?? 0.85);
        this._testUntil = performance.now() + (movement.duration ?? 700);
        this._testResetTimer = setTimeout(() => this._resetTestFace(), movement.duration ?? 700);
        break;
      case "blink":
        this._playBlink();
        break;
      case "head-stutter":
        this.stutterNod(movement.intensity ?? 1);
        break;
      case "head-speaking":
        this._testSpeakingUntil = performance.now() + (movement.duration ?? 2200);
        break;
      case "head-idle":
        this._testSpeakingUntil = 0;
        this._testIdleUntil = performance.now() + (movement.duration ?? 3000);
        break;
      case "head-turn":
        this.turnHead(movement.yaw ?? 0, movement.pitch ?? 0, movement.duration ?? 2000);
        break;
      case "torso-turn":
        this.turnTorso(movement.yaw ?? 0, movement.duration ?? 2000);
        break;
      case "torso-head-counter": {
        // Torso turns one way; head counter-turns the same angle so the
        // net head orientation stays facing the camera.
        const yaw = movement.yaw ?? 0;
        const duration = movement.duration ?? 2200;
        this.turnTorso(yaw, duration);
        this.turnHead(-yaw, 0, duration);
        break;
      }
      default:
        return { handled: false };
    }

    return { handled: true, movement };
  }

  isTestSpeaking() {
    return !!(this._testSpeakingUntil && performance.now() < this._testSpeakingUntil);
  }

  isTestIdle() {
    return !!(this._testIdleUntil && performance.now() < this._testIdleUntil);
  }

  _playExpression(name, duration, value) {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    this._testUntil = performance.now() + duration;
    for (const n of EXPRESSION_NAMES) em.setValue(n, 0);
    em.setValue(name, value);
    em.update();

    this._testResetTimer = setTimeout(() => this._resetTestFace(), duration);
  }

  _playBlink() {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    this._testUntil = performance.now() + 180;
    em.setValue("blink", 1);
    em.update();
    this._testResetTimer = setTimeout(() => {
      em.setValue("blink", 0);
      em.update();
      this._testUntil = 0;
    }, 120);
  }

  _resetTestFace() {
    this._testUntil = 0;
    this._mouth = { level: 0, low: 0, mid: 0, high: 0 };
    const em = this.vrm?.expressionManager;
    if (!em) return;
    for (const n of EXPRESSION_NAMES) em.setValue(n, 0);
    em.setValue("neutral", 1);
    em.update();
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
