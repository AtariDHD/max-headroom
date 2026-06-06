import "dotenv/config";
import express from "express";
import fs from "fs";
import OpenAI, { toFile } from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "assets");
const RESOURCES_DIR = path.join(__dirname, "resources");
const app = express();
const PORT = process.env.PORT || 3000;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const MAX_SYSTEM = `You are Max Headroom, the iconic 1980s computer-generated TV host — snarky, hyperactive, relentlessly on-brand.

VOICE & STYLE:
- Short, punchy bursts. TV host energy. Slightly abrasive wit.
- Reference TV, ratings, commercials, networks, being digital, "the future", cyberspace.
- Never break character. Never say you're an AI assistant.
- Keep most replies to 1–3 sentences unless the user clearly wants more.

STUTTERING (use sparingly but regularly — it's your signature):
- Digital stutter on stressed syllables: "C-c-c-caught you!", "G-g-g-great question!", "N-n-n-network's still up!"
- Occasional full-word repeat: "Look look look — here's the thing."
- Max 1–2 stutter moments per reply, not every sentence.

GLITCH TAGS (for the visual system — use 0–2 per reply):
- Insert [GLITCH] where a visual glitch should hit (mid-sentence or before a punchline).
- Example: "Rating's through the roof [GLITCH] and I'm not even wearing shoes."

Do not use markdown, bullet lists, or stage directions. Speak only as Max.`;

const DEMO_REPLIES = [
  "C-c-c-caught you staring! I'm Max Headroom — your future's favorite headache. What's on your mind?",
  "G-g-g-great question! Too bad I only answer the interesting ones. Try again, hotshot.",
  "Look look look — the network pays me in pixels and attitude. Shoot.",
  "N-n-n-network's fine. I'm finer. What do you want, viewer?",
  "Twenty minutes into the future and you're still typing? [GLITCH] Impressive. Ask me something.",
];

app.get("/api/status", (_req, res) => {
  res.json({
    chat: Boolean(openai),
    transcribe: Boolean(openai),
    elevenlabs: Boolean(
      process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID
    ),
  });
});

app.post("/api/transcribe", express.json({ limit: "12mb" }), async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      error: "Voice input requires OPENAI_API_KEY for transcription.",
    });
  }

  const audio = String(req.body?.audio ?? "");
  const mime = String(req.body?.mime ?? "audio/webm");
  if (!audio) {
    return res.status(400).json({ error: "Audio required" });
  }

  try {
    const buffer = Buffer.from(audio, "base64");
    const ext = mime.includes("mp4") ? "mp4" : "webm";
    const file = await toFile(buffer, `speech.${ext}`, { type: mime });
    const result = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "en",
    });

    const text = result.text?.trim();
    if (!text) {
      return res.status(422).json({ error: "No speech detected." });
    }

    res.json({ text });
  } catch (err) {
    console.error("Transcribe error:", err.message);
    res.status(500).json({
      error: "Could not transcribe speech. Check your OpenAI API key and credits.",
    });
  }
});

app.use(express.json({ limit: "32kb" }));

app.use("/assets", express.static(ASSETS_DIR));
app.use("/resources", express.static(RESOURCES_DIR));
app.use("/vendor", express.static(path.join(__dirname, "node_modules")));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  if (!message) {
    return res.status(400).json({ error: "Message required" });
  }

  if (!openai) {
    const text =
      DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)];
    return res.json({ text, demo: true });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.92,
      max_tokens: 220,
      messages: [
        { role: "system", content: MAX_SYSTEM },
        ...((req.body.history ?? []).slice(-8).map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: String(m.content),
        })) ?? []),
        { role: "user", content: message },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty response");
    res.json({ text, demo: false });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({
      error: "Max hit a network glitch. Check your API key and try again.",
    });
  }
});

app.post("/api/speech", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "Text required" });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return res.status(503).json({ error: "ElevenLabs not configured" });
  }

  const spokenText = text.replace(/\[GLITCH\]/gi, "... ").trim();
  const ttsBody = JSON.stringify({
    text: spokenText,
    model_id: "eleven_turbo_v2_5",
    voice_settings: {
      stability: 0.35,
      similarity_boost: 0.75,
      style: 0.65,
      use_speaker_boost: true,
    },
  });
  const ttsHeaders = {
    "xi-api-key": apiKey,
    "Content-Type": "application/json",
  };

  try {
    let audioBase64 = null;
    let alignment = null;
    let normalizedAlignment = null;

    const tsResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
      { method: "POST", headers: ttsHeaders, body: ttsBody }
    );

    if (tsResponse.ok) {
      const data = await tsResponse.json();
      audioBase64 = data.audio_base64 ?? null;
      alignment = data.alignment ?? null;
      normalizedAlignment = data.normalized_alignment ?? null;
    } else {
      const detail = await tsResponse.text();
      console.warn("TTS with-timestamps failed, using standard endpoint:", detail);
    }

    if (!audioBase64) {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        { method: "POST", headers: ttsHeaders, body: ttsBody }
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || response.statusText);
      }
      audioBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
    }

    res.json({
      audio: audioBase64,
      mime: "audio/mpeg",
      alignment,
      normalized_alignment: normalizedAlignment,
      spokenText,
    });
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).json({ error: "Speech synthesis failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Max Headroom live at http://localhost:${PORT}`);
  const modelPaths = [
    path.join(ASSETS_DIR, "MaxHeadRoom.vrm"),
    path.join(RESOURCES_DIR, "MaxHeadRoomVtuberVRM.vrm"),
  ];
  const found = modelPaths.find((p) => fs.existsSync(p));
  if (found) {
    console.log(`  → VRM model: ${path.relative(__dirname, found)}`);
  } else {
    console.warn("  → VRM model missing — add MaxHeadRoom.vrm to assets/ (see assets/README.md)");
  }
  if (!openai) {
    console.log("  → Demo chat mode (set OPENAI_API_KEY for full AI)");
  }
  if (!process.env.ELEVENLABS_API_KEY) {
    console.log("  → Browser voice (set ELEVENLABS_* for premium TTS)");
  }
});
