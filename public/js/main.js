import { MaxScene } from "./max-scene.js";
import { MaxVoice } from "./max-voice.js";
import { MaxEffects } from "./max-effects.js";
import { MaxSpeechInput } from "./max-speech-input.js";
import { initCubeDebug } from "./cube-debug.js";
import { formatMaxMessage, appendMessage } from "./max-chat.js";

const canvas = document.getElementById("max-canvas");
const messagesEl = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const voiceBtn = document.getElementById("voice-btn");
const statusPill = document.getElementById("status-pill");
const stage = document.querySelector(".stage");
const flash = document.getElementById("glitch-flash");
const movementSelect = document.getElementById("movement-select");
const movementPlayBtn = document.getElementById("movement-play-btn");

const scene = new MaxScene(canvas);
initCubeDebug(scene);
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

const speechInput = new MaxSpeechInput({
  input,
  button: voiceBtn,
  onResult: (text) => sendMessage(text),
  onError: (message) => appendMessage(messagesEl, "system", message),
});

function setBusy(value) {
  busy = value;
  input.disabled = value;
  sendBtn.disabled = value;
  speechInput.setEnabled(!value);
}

async function sendMessage(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || busy) return;

  speechInput.stop();
  input.value = "";
  appendMessage(messagesEl, "user", trimmed);
  history.push({ role: "user", content: trimmed });

  const thinking = appendMessage(messagesEl, "max", "…", "thinking");
  setBusy(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: trimmed, history }),
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
}

function populateMovementSelect() {
  if (!movementSelect) return;

  const groups = new Map();
  for (const movement of scene.getMovements()) {
    if (!groups.has(movement.group)) {
      groups.set(movement.group, []);
    }
    groups.get(movement.group).push(movement);
  }

  movementSelect.replaceChildren();
  for (const [group, items] of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group;
    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      optgroup.appendChild(option);
    }
    movementSelect.appendChild(optgroup);
  }
}

function playSelectedMovement() {
  if (!movementSelect?.value) return;
  scene.playMovement(movementSelect.value, {
    onGlitch: (strength) => effects.pulseGlitch(strength),
  });
}

async function init() {
  await voice.configure();
  await scene.ready.catch(() => {});
  populateMovementSelect();

  let statusText = "LIVE";
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    speechInput.configure({ transcribe: data.transcribe });
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
    "Max is on the air. Type or tap the mic — c-c-c-come on, don't be shy."
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

movementPlayBtn?.addEventListener("click", () => playSelectedMovement());

voiceBtn?.addEventListener("click", () => speechInput.toggle());

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await sendMessage(input.value);
});

function animate(time) {
  scene.tick(time);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
init();
