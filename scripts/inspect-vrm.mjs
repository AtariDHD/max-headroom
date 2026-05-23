import fs from "fs";

const buf = fs.readFileSync(
  new URL("../assets/MaxHeadRoom.vrm", import.meta.url)
);
const jsonStart = buf.indexOf(Buffer.from('{"'));
let depth = 0;
let end = jsonStart;
for (let i = jsonStart; i < buf.length; i++) {
  if (buf[i] === 0x7b) depth++;
  else if (buf[i] === 0x7d) {
    depth--;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
}
const gltf = JSON.parse(buf.slice(jsonStart, end).toString());

console.log("meshes:", gltf.meshes?.length);
gltf.meshes?.forEach((m, i) => {
  const names = m.extras?.targetNames;
  console.log(`mesh ${i}: ${m.name}`, names ? `targets: ${names.join(", ")}` : "");
});

const vrm0 = gltf.extensions?.VRM;
const vrm1 = gltf.extensions?.VRMC_vrm;
console.log("VRM0:", vrm0 ? "yes" : "no");
console.log("VRMC_vrm:", vrm1 ? "yes" : "no");

if (vrm0?.blendShapeMaster?.blendShapeGroups) {
  vrm0.blendShapeMaster.blendShapeGroups.forEach((g) => {
    console.log(
      `${g.name} preset=${g.presetName ?? "-"} binds=${g.binds?.length ?? 0}`
    );
  });
}
if (vrm1?.expressions) {
  const ex = vrm1.expressions;
  for (const [cat, val] of Object.entries(ex)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      console.log(`${cat}:`, Object.keys(val));
    }
  }
}

console.log(
  "images:",
  gltf.images?.map((img, i) => ({ i, uri: img.uri?.slice(0, 80) }))
);

console.log("nodes:", gltf.nodes?.map((n) => n.name));
const root = gltf.scenes?.[gltf.scene ?? 0];
console.log("scene nodes:", root?.nodes);
