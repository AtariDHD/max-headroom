import { MaxScene } from "./max-scene.js";
import { MaxVoice } from "./max-voice.js";
import { MaxEffects } from "./max-effects.js";
import { MaxSpeechInput } from "./max-speech-input.js";
import { initCubeDebug } from "./cube-debug.js";
import { appendMessage, appendMaxMessage, MaxMessageHighlighter } from "./max-chat.js";
import { initSpeechDebug } from "./speech-debug.js";

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
const highlighter = new MaxMessageHighlighter();
let activeMessageBody = null;
const speechDebug = initSpeechDebug();

const voice = new MaxVoice({
  onStart: () => scene.setSpeaking(true),
  onEnd: () => {
    scene.setSpeaking(false);
    scene.setMouthLevel(0);
    setBusy(false);
    input.focus();
  },
  onWord: (level) => scene.setMouthLevel(level),
  onStutter: () => {
    scene.head.stutterNod(1.2);
  },
  onStutterStart: (wordIndex) => highlighter.holdWord(wordIndex),
  onStutterEnd: () => highlighter.releaseHold(),
  onGlitch: () => effects.pulseGlitch(0.8 + Math.random() * 0.4),
  onSpeakStart: ({ rawText, alignment, durationMs }) => {
    speechDebug?.onSpeakStart?.({ rawText, alignment, durationMs });
    if (activeMessageBody) {
      highlighter.start(activeMessageBody, rawText, alignment, durationMs);
    }
  },
  onSpeakProgress: (atSec) => highlighter.update(atSec),
  onSpeakStop: () => highlighter.stop(),
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
  messagesEl.querySelectorAll(".msg-replay-btn").forEach((btn) => {
    btn.disabled = value;
  });
}

async function speakMaxMessage(text, messageBody) {
  activeMessageBody = messageBody ?? null;
  try {
    await voice.speak(text);
  } finally {
    activeMessageBody = null;
  }
}

async function replayMaxMessage(text, messageBody) {
  if (busy || !text?.trim()) return;

  voice.stop();
  setBusy(true);
  try {
    await speakMaxMessage(text, messageBody);
  } finally {
    setBusy(false);
  }
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
    const msgEl = appendMaxMessage(messagesEl, reply);

    try {
      await speakMaxMessage(reply, msgEl.querySelector(".msg-max__body"));
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
  const greetingEl = appendMaxMessage(messagesEl, greeting);
  history.push({ role: "assistant", content: greeting });
  setBusy(true);
  try {
    await speakMaxMessage(greeting, greetingEl.querySelector(".msg-max__body"));
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

messagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".msg-replay-btn");
  if (!btn || btn.disabled) return;
  const msg = btn.closest(".msg.max");
  const text = msg?.dataset.replayText;
  const body = msg?.querySelector(".msg-max__body");
  if (text && body) replayMaxMessage(text, body);
});

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
