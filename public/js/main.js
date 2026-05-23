import { MaxScene } from "./max-scene.js";
import { MaxVoice } from "./max-voice.js";
import { MaxEffects } from "./max-effects.js";
import { formatMaxMessage, appendMessage } from "./max-chat.js";

const canvas = document.getElementById("max-canvas");
const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const statusPill = document.getElementById("status-pill");
const stage = document.querySelector(".stage");
const flash = document.getElementById("glitch-flash");

const scene = new MaxScene(canvas);
const effects = new MaxEffects({ stage, flash, scene });
const voice = new MaxVoice({
  onStart: () => scene.setSpeaking(true),
  onEnd: () => {
    scene.setSpeaking(false);
    scene.setMouthLevel(0);
    setBusy(false);
  },
  onWord: (level) => scene.setMouthLevel(level),
  onStutter: () => {
    scene.head.stutterNod(1.2);
    effects.pulseGlitch(0.5);
  },
});

const history = [];
let busy = false;

function setBusy(value) {
  busy = value;
  input.disabled = value;
  sendBtn.disabled = value;
}

async function init() {
  await voice.configure();
  await scene.ready.catch(() => {});

  let statusText = "LIVE";
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    if (!data.chat) {
      statusText = "DEMO CHAT — add OPENAI_API_KEY";
      statusPill.classList.add("demo");
    }
    if (data.elevenlabs) {
      statusText += " · HD VOICE";
    } else {
      statusText += " · BROWSER VOICE";
    }
  } catch {
    statusText = "OFFLINE?";
  }
  statusPill.textContent = statusText;

  appendMessage(
    messagesEl,
    "system",
    "Max is on the air. Type a message — c-c-c-come on, don't be shy."
  );

  // Greet
  const greeting =
    "C-c-c-caught you loading! I'm Max Headroom — twenty minutes into the future. What's your story, viewer?";
  appendMessage(messagesEl, "max", formatMaxMessage(greeting));
  history.push({ role: "assistant", content: greeting });
  effects.scheduleForSpeech(greeting, 4500);
  setBusy(true);
  try {
    await voice.speak(greeting);
  } catch {
    /* speech failed — input still unlocked in finally */
  } finally {
    setBusy(false);
  }
}

document.addEventListener(
  "click",
  () => {
    voice.resumeAudio();
  },
  { once: true }
);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;

  input.value = "";
  appendMessage(messagesEl, "user", text);
  history.push({ role: "user", content: text });

  const thinking = appendMessage(messagesEl, "max", "…", "thinking");
  setBusy(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
    });
    const data = await res.json();
    thinking.remove();

    if (!res.ok) {
      appendMessage(messagesEl, "system", data.error || "Transmission failed.");
      setBusy(false);
      return;
    }

    const reply = data.text;
    history.push({ role: "assistant", content: reply });
    appendMessage(messagesEl, "max", formatMaxMessage(reply));

    const estDuration = Math.max(2500, reply.length * 55);
    effects.scheduleForSpeech(reply, estDuration);
    try {
      await voice.speak(reply);
    } finally {
      setBusy(false);
    }
  } catch {
    thinking.remove();
    appendMessage(messagesEl, "system", "Signal lost. Try again.");
    setBusy(false);
  }
});

function animate(time) {
  scene.tick(time);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
init();
