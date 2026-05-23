import fs from "fs";

const buf = fs.readFileSync(
  new URL("../assets/MaxHeadRoom.vrm", import.meta.url)
);
const jsonStart = buf.indexOf(Buffer.from('{"'));
let depth = 0,
  end = jsonStart;
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

console.log("materials:");
gltf.materials?.forEach((m, i) => {
  console.log(i, m.name, {
    emissiveFactor: m.emissiveFactor,
    emissiveTexture: m.emissiveTexture,
    baseColor: m.pbrMetallicRoughness?.baseColorFactor,
  });
});

console.log("\nmesh -> material:");
gltf.meshes?.forEach((mesh, i) => {
  console.log(mesh.name, "mat", mesh.primitives?.[0]?.material);
});
