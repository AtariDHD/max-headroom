import "dotenv/config";
import express from "express";
import fs from "fs";
import OpenAI from "openai";
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

app.use(express.json({ limit: "32kb" }));
app.use("/assets", express.static(ASSETS_DIR));
app.use("/resources", express.static(RESOURCES_DIR));
app.use("/vendor", express.static(path.join(__dirname, "node_modules")));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (_req, res) => {
  res.json({
    chat: Boolean(openai),
    elevenlabs: Boolean(
      process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID
    ),
  });
});

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

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: text.replace(/\[GLITCH\]/gi, "... "),
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.75,
            style: 0.65,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || response.statusText);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.send(buffer);
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
