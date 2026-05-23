# Max Headroom

Chat with an animated 3D Max Headroom — the snarky 1980s TV host with digital stutters, glitch effects, wireframe set, and cloned voice support.

Built by [AtariDHD](https://github.com/AtariDHD).

![Stack](https://img.shields.io/badge/Three.js-3D-7df9ff) ![Node](https://img.shields.io/badge/Node-Express-7df9ff) ![VRM](https://img.shields.io/badge/VRM-Lip%20Sync-7df9ff)

## Features

- **3D VRM avatar** — rigged Max Headroom model with viseme lip sync (`aa`, `ih`, `ou`, `ee`, `oh`)
- **Wireframe cube set** — green / yellow / pink grid corner background (classic TV look)
- **Chat** — OpenAI-powered Max personality with stutters and `[GLITCH]` markers
- **Voice output** — ElevenLabs instant voice clone when configured; browser TTS fallback
- **Voice input** — mic button on the chat bar; records your speech and transcribes via OpenAI Whisper (falls back to browser speech recognition without an API key)
- **Mannerisms** — head tilt, stutter jerks, scanlines, bloom, chromatic glitch bursts
- **Movement test panel** — hover the top-right of the 3D view to pick a viseme, expression, head motion, or glitch and hit **PLAY**
- **Demo mode** — works without API keys (canned replies + browser voice)

## Quick start

```bash
git clone https://github.com/AtariDHD/max-headroom.git
cd max-headroom
npm install
cp .env.example .env
```

1. Add your **VRM model** to `assets/` (see [assets/README.md](assets/README.md))
2. Edit `.env` with your API keys (optional but recommended)
3. Run:

```bash
npm start
```

Open **http://localhost:3000**

> **Note:** Restart the server after changing `.env`. Hard-refresh the browser (Ctrl+Shift+R) after updates.

## Configuration

Copy `.env.example` to `.env`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | For AI chat + voice input | Powers Max's personality (GPT-4o-mini) and speech-to-text (Whisper) |
| `ELEVENLABS_API_KEY` | For HD voice | ElevenLabs TTS API key |
| `ELEVENLABS_VOICE_ID` | For HD voice | Voice ID from your ElevenLabs library or clone |
| `PORT` | No | Server port (default `3000`) |

### OpenAI

1. Create an API key at [platform.openai.com](https://platform.openai.com/api-keys)
2. Add billing / credits — free ChatGPT accounts do **not** include unlimited API quota
3. If you see *"Max hit a network glitch"*, check the server console; `429 insufficient_quota` means you need API credits

### Voice input (mic button)

With `OPENAI_API_KEY` set, the mic records locally and sends audio to **`/api/transcribe`** (Whisper). This avoids Chrome's built-in speech recognition, which sends audio to Google and often fails with a `network` error.

1. Click the **mic** in the chat input (allow microphone permission when prompted)
2. Speak — recording stops after a brief pause, or click the mic again to stop early
3. Your words are transcribed and sent to Max automatically

Without an OpenAI key, the app falls back to the browser Web Speech API (Chrome/Edge only; requires connectivity to Google's speech service).

### ElevenLabs (recommended voice)

1. Create an account at [ElevenLabs](https://elevenlabs.io)
2. Use **Instant Voice Clone** or pick a fast, sharp male voice
3. Copy the **Voice ID** into `ELEVENLABS_VOICE_ID`
4. Click once on the page if greeting audio is silent (browser autoplay policy)

Status pill meanings:

- `DEMO CHAT` — no OpenAI key loaded
- `HD VOICE` — ElevenLabs configured
- `BROWSER VOICE` — using browser speech synthesis

## 3D model setup

The Max Headroom VRM is **not included** in this repo (licensing). Purchase the model from TurboSquid, then place your files in `assets/`:

**[Max Headroom VTuber Ready Full Rigged 3D Model on TurboSquid](https://www.turbosquid.com/3d-models/max-headroom-vtuber-ready-full-rigged-3d-1959807)**

```
assets/
  MaxHeadRoom.vrm    ← required (rename or update path in max-head.js)
  textures/          ← optional if embedded in VRM
```

The download includes VRM, FBX, and Blend formats. The app loads the **VRM** file. A copy in `resources/` is also served if you keep files there during development.

See [assets/README.md](assets/README.md) for details.

## Movement test controls

Hover the **top-right corner** of the 3D viewport to reveal a hidden debug panel. Choose a movement from the dropdown and click **PLAY** to preview:

| Group | Examples |
|-------|----------|
| **Mouth** | Individual visemes, blended open, frequency-band emphasis |
| **Face** | Blink, happy, angry, sad, relaxed, look directions, neutral reset |
| **Head** | Stutter nod, speaking sway, idle drift |
| **Effects** | Full screen glitch, face-only glitch |

Useful for tuning lip sync, expressions, and mannerisms without sending chat messages.

## How it works

```mermaid
flowchart LR
  User[You type or speak] --> STT["/api/transcribe → Whisper"]
  STT --> API["/api/chat"]
  User --> API
  API --> LLM[OpenAI + Max system prompt]
  LLM --> Text[Reply with stutters + GLITCH tags]
  Text --> UI[Chat + 3D effects]
  Text --> TTS["/api/speech → ElevenLabs"]
  TTS --> LipSync[VRM visemes + glitches]
```

## Project layout

```
assets/              3D model files (local only, not in git)
public/
  brand.png          Header logo image
  js/max-head.js     VRM loader, visemes, movement test API
  js/max-scene.js    Three.js scene, lighting, post-processing
  js/cube-corner.js  Wireframe grid corner background
  js/max-voice.js    Speech playback + mouth analysis
  js/max-speech-input.js  Mic button + Whisper / browser STT
  js/max-effects.js  Glitch coordination
  js/main.js         App wiring
scripts/             Dev utilities (VRM inspection)
server.js            Express API (chat, transcribe, TTS)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server on port 3000 |
| `npm run dev` | Start with auto-reload (`node --watch`) |

## Legal note

“Max Headroom” is a trademarked character. This project is a fan-style homage for personal use. Do not use commercially or imply official affiliation. You are responsible for licenses on any 3D models, voice clones, or audio samples you add locally.

## License

MIT — see project files. Third-party assets (VRM model, ElevenLabs voices) are not redistributed by this repository.
