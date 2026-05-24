/** Temporary cube corner tuning panel — remove when done experimenting. */

const FIELDS = [
  { id: "cube-px", key: "px", label: "pos X", step: "0.01" },
  { id: "cube-py", key: "py", label: "pos Y", step: "0.01" },
  { id: "cube-pz", key: "pz", label: "pos Z", step: "0.01" },
  { id: "cube-rx", key: "rx", label: "rot X°", step: "0.1" },
  { id: "cube-ry", key: "ry", label: "rot Y°", step: "0.1" },
  { id: "cube-rz", key: "rz", label: "rot Z°", step: "0.1" },
  { id: "cube-scale", key: "scale", label: "scale", step: "0.01" },
  { id: "cube-size", key: "size", label: "length", step: "0.1" },
];

function readForm() {
  /** @type {Record<string, number>} */
  const values = {};
  for (const field of FIELDS) {
    const el = document.getElementById(field.id);
    values[field.key] = Number.parseFloat(el?.value ?? "");
  }
  return values;
}

function writeForm(config) {
  for (const field of FIELDS) {
    const el = document.getElementById(field.id);
    if (el && config[field.key] != null) {
      el.value = String(config[field.key]);
    }
  }
}

export function initCubeDebug(scene) {
  const logBtn = document.getElementById("cube-log-btn");
  if (!document.getElementById("cube-px")) return;

  const apply = () => {
    const values = readForm();
    if (Object.values(values).some((v) => Number.isNaN(v))) return;
    scene.applyCubeCorner(values);
  };

  for (const field of FIELDS) {
    document.getElementById(field.id)?.addEventListener("input", apply);
  }

  logBtn?.addEventListener("click", () => {
    const config = scene.getCubeCornerConfig();
    const snippet = `// cube corner
this.cubeCorner.position.set(${config.px}, ${config.py}, ${config.pz});
this.cubeCorner.rotation.order = "YXZ";
this.cubeCorner.rotation.set(
  THREE.MathUtils.degToRad(${config.rx}),
  THREE.MathUtils.degToRad(${config.ry}),
  THREE.MathUtils.degToRad(${config.rz})
);
this.cubeCorner.scale.setScalar(${config.scale});
// createCubeCorner({ size: ${config.size}, divisions: 36 })`;
    console.log(JSON.stringify(config, null, 2));
    console.log(snippet);
  });

  scene.ready
    .then(() => writeForm(scene.getCubeCornerConfig()))
    .catch(() => {});
}
