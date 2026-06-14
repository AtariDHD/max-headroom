/** Temporary lighting tuning panel — hover the lower-right of the scene. */

const LIGHTS = [
  { key: "hemi", label: "Hemisphere", kind: "hemi" },
  { key: "ambient", label: "Ambient", kind: "ambient" },
  { key: "faceFillL", label: "Face fill L", kind: "dir" },
  { key: "faceFillR", label: "Face fill R", kind: "dir" },
  { key: "rightFront", label: "Right-front accent", kind: "dir" },
  { key: "faceKey", label: "Face key", kind: "dir" },
  { key: "bodyFill", label: "Body fill", kind: "dir" },
  { key: "key", label: "Top key", kind: "dir" },
  { key: "cyanRim", label: "Cyan rim", kind: "dir" },
  { key: "magentaFill", label: "Magenta fill", kind: "dir" },
];

const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

function sliderRow(label, min, max, step, value, onInput) {
  const wrap = document.createElement("label");
  wrap.className = "lighting-debug__row";

  const top = document.createElement("span");
  top.className = "lighting-debug__rowtop";
  const name = document.createElement("span");
  name.className = "lighting-debug__name";
  name.textContent = label;
  const out = document.createElement("span");
  out.className = "lighting-debug__val";
  out.textContent = fmt(value);
  top.append(name, out);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = Number.parseFloat(input.value);
    out.textContent = fmt(v);
    onInput(v);
  });

  wrap.append(top, input);
  return wrap;
}

function colorRow(label, value, onInput) {
  const wrap = document.createElement("label");
  wrap.className = "lighting-debug__row lighting-debug__row--color";
  const name = document.createElement("span");
  name.className = "lighting-debug__name";
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  wrap.append(name, input);
  return wrap;
}

function applyConfig(scene, cfg) {
  for (const [key, entry] of Object.entries(cfg.lights)) {
    const light = scene.lights[key];
    if (!light) continue;
    light.intensity = entry.intensity;
    light.color.set(entry.color);
    if (entry.ground && light.groundColor) light.groundColor.set(entry.ground);
    if (light.isDirectionalLight) light.position.set(entry.x, entry.y, entry.z);
  }
  scene.renderer.toneMappingExposure = cfg.exposure;
  scene.bloomPass.strength = cfg.bloomStrength;
  scene.bloomPass.radius = cfg.bloomRadius;
  scene.bloomPass.threshold = cfg.bloomThreshold;
  if (scene.scene.fog) scene.scene.fog.density = cfg.fog;
}

function buildSnippet(cfg) {
  const lines = ["// --- Lighting (paste over the values in _initScene) ---"];
  for (const [key, e] of Object.entries(cfg.lights)) {
    lines.push(`this.lights.${key}.intensity = ${e.intensity};`);
    lines.push(`this.lights.${key}.color.set("${e.color}");`);
    if (e.ground) lines.push(`this.lights.${key}.groundColor.set("${e.ground}");`);
    if (e.x !== undefined) {
      lines.push(`this.lights.${key}.position.set(${e.x}, ${e.y}, ${e.z});`);
    }
  }
  lines.push(`this.renderer.toneMappingExposure = ${cfg.exposure};`);
  lines.push(`this.bloomPass.strength = ${cfg.bloomStrength};`);
  lines.push(`this.bloomPass.radius = ${cfg.bloomRadius};`);
  lines.push(`this.bloomPass.threshold = ${cfg.bloomThreshold};`);
  lines.push(`this.scene.fog.density = ${cfg.fog};`);
  return lines.join("\n");
}

export function initLightingDebug(scene) {
  const container = document.getElementById("lighting-fields");
  if (!container || !scene.lights) return;

  const defaults = scene.getLightingConfig();

  const build = () => {
    container.replaceChildren();

    for (const def of LIGHTS) {
      const light = scene.lights[def.key];
      if (!light) continue;

      const group = document.createElement("div");
      group.className = "lighting-debug__group";
      const title = document.createElement("div");
      title.className = "lighting-debug__title";
      title.textContent = def.label;
      group.append(title);

      group.append(
        sliderRow("intensity", 0, 4, 0.01, light.intensity, (v) => {
          light.intensity = v;
        })
      );
      group.append(
        colorRow("color", "#" + light.color.getHexString(), (hex) =>
          light.color.set(hex)
        )
      );
      if (def.kind === "hemi" && light.groundColor) {
        group.append(
          colorRow("ground", "#" + light.groundColor.getHexString(), (hex) =>
            light.groundColor.set(hex)
          )
        );
      }
      if (def.kind === "dir") {
        group.append(
          sliderRow("pos X", -5, 5, 0.05, light.position.x, (v) => {
            light.position.x = v;
          })
        );
        group.append(
          sliderRow("pos Y", -5, 5, 0.05, light.position.y, (v) => {
            light.position.y = v;
          })
        );
        group.append(
          sliderRow("pos Z", -5, 5, 0.05, light.position.z, (v) => {
            light.position.z = v;
          })
        );
      }
      container.append(group);
    }

    const globals = document.createElement("div");
    globals.className = "lighting-debug__group";
    const gtitle = document.createElement("div");
    gtitle.className = "lighting-debug__title";
    gtitle.textContent = "Global / post-processing";
    globals.append(gtitle);
    globals.append(
      sliderRow("exposure", 0, 3, 0.01, scene.renderer.toneMappingExposure, (v) => {
        scene.renderer.toneMappingExposure = v;
      })
    );
    globals.append(
      sliderRow("bloom strength", 0, 2, 0.01, scene.bloomPass.strength, (v) => {
        scene.bloomPass.strength = v;
      })
    );
    globals.append(
      sliderRow("bloom radius", 0, 1.5, 0.01, scene.bloomPass.radius, (v) => {
        scene.bloomPass.radius = v;
      })
    );
    globals.append(
      sliderRow("bloom threshold", 0, 1, 0.01, scene.bloomPass.threshold, (v) => {
        scene.bloomPass.threshold = v;
      })
    );
    if (scene.scene.fog) {
      globals.append(
        sliderRow("fog density", 0, 0.3, 0.005, scene.scene.fog.density, (v) => {
          scene.scene.fog.density = v;
        })
      );
    }
    container.append(globals);
  };

  build();

  document.getElementById("lighting-reset-btn")?.addEventListener("click", () => {
    applyConfig(scene, defaults);
    build();
  });

  document.getElementById("lighting-log-btn")?.addEventListener("click", () => {
    console.log(JSON.stringify(scene.getLightingConfig(), null, 2));
    console.log(buildSnippet(scene.getLightingConfig()));
  });
}
