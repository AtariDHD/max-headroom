# 3D model assets (local only)

This folder is **gitignored** except for this README. Add your purchased Max Headroom files here after cloning the repo.

## Where to buy the model

**[Max Headroom VTuber Ready Full Rigged 3D Model — TurboSquid](https://www.turbosquid.com/3d-models/max-headroom-vtuber-ready-full-rigged-3d-1959807)**

The download includes VRM, FBX, and Blend formats. Copy the VRM into this folder.

## Required

- **`MaxHeadRoom.vrm`** — VRM export used by the app (default path in `public/js/max-head.js`)

If your file has a different name, either rename it or update `MODEL_URL` in `public/js/max-head.js`:

```javascript
const MODEL_URL = "/assets/YourFileName.vrm";
```

## Optional

- `textures/` — only if your VRM references external textures (many VRMs embed textures)
- `.fbx`, `.blend` — source files; not loaded by the web app

## Notes

- Do not commit purchased models to a public GitHub repo unless your license allows it
- The app serves this folder at `http://localhost:3000/assets/`
