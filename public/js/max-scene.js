import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { MaxHead, MOVEMENTS } from "./max-head.js";
import { createCubeCorner, updateCubeCornerResolution } from "./cube-corner.js";
import { CubeCornerAnimator } from "./cube-corner-anim.js";

const ScanlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    glitchAmount: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float glitchAmount;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      float scan = sin((uv.y + time * 0.15) * 800.0) * 0.02;
      float line = step(0.5, fract(uv.y * 280.0 + time * 2.0)) * 0.03;

      float g = glitchAmount;
      if (g > 0.01) {
        float slice = floor(uv.y * 12.0 + time * 20.0);
        float offset = (fract(sin(slice * 12.9898) * 43758.5453) - 0.5) * 0.03 * g;
        uv.x += offset;
      }

      vec4 col;
      if (g > 0.2) {
        float r = texture2D(tDiffuse, uv + vec2(0.012 * g, 0.0)).r;
        float gb = texture2D(tDiffuse, uv - vec2(0.008 * g, 0.0)).g;
        float b = texture2D(tDiffuse, uv).b;
        col = vec4(r, gb, b, 1.0);
      } else {
        col = texture2D(tDiffuse, uv);
      }

      //col.rgb -= scan + line;
      col.rgb += vec3(0.02, 0.06, 0.08) * g;
      gl_FragColor = col;
    }
  `,
};

export class MaxScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.head = new MaxHead();
    this.speaking = false;
    this._glitchDecay = 0;
    this.modelReady = false;

    this._initRenderer();
    this._initScene();
    this._initComposer();
    this._onResize();
    this._observeResize();

    this.ready = this.head.loading
      .then(() => {
        this._fitCameraToHead();
        this.modelReady = true;
        this._hideLoading();
      })
      .catch((err) => {
        console.error("Failed to load Max model:", err);
        this._showLoadError();
        throw err;
      });
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x030308);
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.27;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x030308, 0.08);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    this.camera.position.set(0, 1.0, 0.75);

    const hemi = new THREE.HemisphereLight(0xd0d8ec, 0x383848, 1.06);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0x687080, 0.82);
    this.scene.add(ambient);

    const faceFillL = new THREE.DirectionalLight(0xfff4ee, 0.62);
    faceFillL.position.set(-1.0, 0.45, 1.6);
    this.scene.add(faceFillL);

    const faceFillR = new THREE.DirectionalLight(0xfff4ee, 0.62);
    faceFillR.position.set(1.0, 0.45, 1.6);
    this.scene.add(faceFillR);

    // Weak right-front accent
    const rightFront = new THREE.DirectionalLight(0xfff6f2, 1.88);
    rightFront.position.set(1.5, 0.35, 1.25);
    this.scene.add(rightFront);

    const faceKey = new THREE.DirectionalLight(0xfff8f0, 0.86);
    faceKey.position.set(0, 0.35, 1.9);
    this.scene.add(faceKey);

    const bodyFill = new THREE.DirectionalLight(0xffffff, 0.46);
    bodyFill.position.set(0, 0.1, 1.5);
    this.scene.add(bodyFill);

    const key = new THREE.DirectionalLight(0xffffff, 0.22);
    key.position.set(0, 2.8, 0.5);
    this.scene.add(key);

    const cyanRim = new THREE.DirectionalLight(0x7df9ff, 0.19);
    cyanRim.position.set(-2.5, 1.0, -1.8);
    this.scene.add(cyanRim);

    const magentaFill = new THREE.DirectionalLight(0xff2bd6, 0.07);
    magentaFill.position.set(1, -0.5, -2);
    this.scene.add(magentaFill);

    this.scene.add(this.head.group);
    this._showLoading();

    this.cubeCorner = createCubeCorner({ size: 20, divisions: 72 });
    this._cubeDivisions = 72;
    this._cubeSize = 18;
    this.scene.add(this.cubeCorner);
  }

  getCubeCornerConfig() {
    if (!this.cubeCorner) {
      return { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, scale: 1, size: 18 };
    }
    const r = this.cubeCorner.rotation;
    return {
      px: +this.cubeCorner.position.x.toFixed(3),
      py: +this.cubeCorner.position.y.toFixed(3),
      pz: +this.cubeCorner.position.z.toFixed(3),
      rx: +THREE.MathUtils.radToDeg(r.x).toFixed(2),
      ry: +THREE.MathUtils.radToDeg(r.y).toFixed(2),
      rz: +THREE.MathUtils.radToDeg(r.z).toFixed(2),
      scale: +this.cubeCorner.scale.x.toFixed(3),
      size: this._cubeSize,
    };
  }

  applyCubeCorner({ px, py, pz, rx, ry, rz, scale, size }) {
    if (!this.cubeCorner) return;

    if (Number.isFinite(size) && size > 0 && size !== this._cubeSize) {
      this._rebuildCubeCorner(size);
    }

    if (Number.isFinite(px)) this.cubeCorner.position.x = px;
    if (Number.isFinite(py)) this.cubeCorner.position.y = py;
    if (Number.isFinite(pz)) this.cubeCorner.position.z = pz;

    if (Number.isFinite(rx) || Number.isFinite(ry) || Number.isFinite(rz)) {
      this.cubeCorner.rotation.order = "YXZ";
      if (Number.isFinite(rx)) this.cubeCorner.rotation.x = THREE.MathUtils.degToRad(rx);
      if (Number.isFinite(ry)) this.cubeCorner.rotation.y = THREE.MathUtils.degToRad(ry);
      if (Number.isFinite(rz)) this.cubeCorner.rotation.z = THREE.MathUtils.degToRad(rz);
    }

    if (Number.isFinite(scale) && scale > 0) {
      this.cubeCorner.scale.setScalar(scale);
    }
  }

  _rebuildCubeCorner(size) {
    const pos = this.cubeCorner.position.clone();
    const rot = this.cubeCorner.rotation.clone();
    const scale = this.cubeCorner.scale.clone();

    this.scene.remove(this.cubeCorner);
    this._cubeSize = size;
    this.cubeCorner = createCubeCorner({
      size,
      divisions: this._cubeDivisions,
    });
    this.cubeCorner.position.copy(pos);
    this.cubeCorner.rotation.copy(rot);
    this.cubeCorner.scale.copy(scale);
    this.scene.add(this.cubeCorner);

    const parent = this.canvas.parentElement;
    updateCubeCornerResolution(
      this.cubeCorner,
      parent?.clientWidth ?? 800,
      parent?.clientHeight ?? 500
    );
  }

  _fitCameraToHead() {
    const target = this.head.getHeadTarget();

    this.camera.position.set(0, target.y + 0.02, 0.57);
    this.camera.lookAt(0, target.y - 0.12, 0);

    this.head.shiftInView(-0.176);

    // Cube corner vertex near top of head, behind Max
    if (this.cubeCorner) {
      this.cubeCorner.position.set(-2.75, target.y - 3, -1.42);
      this.cubeCorner.rotation.order = "YXZ";
      this.cubeCorner.rotation.y = THREE.MathUtils.degToRad(6.5);
      this.cubeCorner.rotation.x = THREE.MathUtils.degToRad(0.3);
      this.cubeCorner.rotation.z = THREE.MathUtils.degToRad(10);
      this.cubeCorner.scale.setScalar(2.25);
      if (!this._cubeAnimator) {
        this._cubeAnimator = new CubeCornerAnimator(() => this.cubeCorner);
        this._cubeAnimator.start();
      }
    }

    // Local key on head + jacket/tie
    if (!this._bodyLight) {
      this._bodyLight = new THREE.PointLight(0xfff4ea, 0.66, 5, 1.4);
      this.scene.add(this._bodyLight);
    }
    this._bodyLight.position.set(0, target.y - 0.22, 0.62);
  }

  _showLoading() {
    const stage = this.canvas.parentElement;
    if (!stage || stage.querySelector(".model-loading")) return;
    const el = document.createElement("div");
    el.className = "model-loading";
    el.textContent = "Loading Max…";
    stage.appendChild(el);
    this._loadingEl = el;
  }

  _hideLoading() {
    this._loadingEl?.remove();
    this._loadingEl = null;
  }

  _showLoadError() {
    if (this._loadingEl) {
      this._loadingEl.textContent = "Model failed to load — check console";
      this._loadingEl.classList.add("error");
    }
  }

  _initComposer() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.18,
      0.4,
      0.98
    );
    this.composer.addPass(this.bloomPass);

    this.scanPass = new ShaderPass(ScanlineShader);
    this.composer.addPass(this.scanPass);
  }

  /**
   * Watch the stage element directly so we resync on ANY size change —
   * window resize, the chat panel growing, etc. A plain window "resize"
   * listener misses layout-driven changes and lets the canvas buffer get
   * stretched, distorting Max's aspect ratio.
   */
  _observeResize() {
    const parent = this.canvas.parentElement;
    if (typeof ResizeObserver !== "undefined" && parent) {
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(parent);
    } else {
      window.addEventListener("resize", () => this._onResize());
    }
  }

  _onResize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
    if (this.cubeCorner) updateCubeCornerResolution(this.cubeCorner, w, h);
  }

  setSpeaking(value) {
    this.speaking = value;
  }

  setMouthLevel(mouth) {
    this.head.setMouthOpen(mouth);
  }

  /** @returns {typeof MOVEMENTS} */
  getMovements() {
    return MOVEMENTS;
  }

  playMovement(id, { onGlitch } = {}) {
    const result = this.head.playMovement(id);
    if (result.handled) return true;

    const movement = result.movement;
    if (!movement) return false;

    if (movement.type === "external") {
      onGlitch?.(1);
      return true;
    }
    if (movement.type === "external-face") {
      this.head.applyGlitch(1);
      return true;
    }
    return false;
  }

  triggerGlitch(strength = 1) {
    this._glitchDecay = Math.max(this._glitchDecay, strength);
    this.head.applyGlitch(strength);
    setTimeout(() => this.head.resetGeometry(), 80 + Math.random() * 60);
  }

  tick(time) {
    this.head.update(time, this.speaking || this.head.isTestSpeaking());
    this._cubeAnimator?.update(time);

    if (this._glitchDecay > 0) {
      this._glitchDecay = Math.max(0, this._glitchDecay - 0.02);
    }
    this.scanPass.uniforms.time.value = time * 0.001;
    this.scanPass.uniforms.glitchAmount.value = this._glitchDecay;

    this.composer.render();
  }
}
