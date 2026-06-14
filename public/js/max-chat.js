/** Format Max's text for display with stutter styling */

// Matches single- or multi-letter onset stutters: "C-c-c-caught", "st-st-stutter".
const STUTTER_RE = /([A-Za-z]{1,3})-((?:\1-)+)(\1)(\w*)/gi;

function toCleanPartial(text) {
  return text
    .replace(/\[GLITCH\]/gi, "")
    .replace(STUTTER_RE, (_, letter, _mid, _letter2, rest) => letter + rest)
    .replace(/\s+/g, " ");
}

/** Natural speech for TTS — strips [GLITCH] and spelled-out stutters. */
export function stripStutterForSpeech(text) {
  return toCleanPartial(text).trim();
}

/** Character index in clean speech text for a position in the raw message. */
function cleanIndexAtRaw(rawText, rawIndex) {
  return toCleanPartial(rawText.slice(0, rawIndex)).length;
}

/** Map a clean-text index to the parallel index in the alignment character stream. */
function mapCleanIndexToSpoken(cleanPos, cleanText, spoken) {
  if (!spoken.length) return 0;
  if (spoken === cleanText) {
    return Math.min(cleanPos, spoken.length - 1);
  }

  let ci = 0;
  let si = 0;
  while (ci < cleanPos && ci < cleanText.length && si < spoken.length) {
    const cc = cleanText[ci];
    const sc = spoken[si];
    if (cc === sc || cc.toLowerCase() === sc.toLowerCase()) {
      ci++;
      si++;
      continue;
    }
    if (/\s/.test(cc) && /\s/.test(sc)) {
      ci++;
      si++;
      continue;
    }
    if (/[^\w\s]/.test(cc)) {
      ci++;
      continue;
    }
    if (/[^\w\s]/.test(sc)) {
      si++;
      continue;
    }
    si++;
  }
  return Math.min(si, spoken.length - 1);
}

function cleanPosToTime(cleanPos, cleanText, spoken, starts) {
  const idx = mapCleanIndexToSpoken(cleanPos, cleanText, spoken);
  return starts[Math.min(Math.max(0, idx), starts.length - 1)];
}

/** Per-word start/end times in the spoken audio. */
export function buildCleanWordTimeline(cleanText, spoken, starts, ends) {
  const timeline = [];
  const re = /\S+/g;
  let m;

  while ((m = re.exec(cleanText)) !== null) {
    const charIdx = mapCleanIndexToSpoken(m.index, cleanText, spoken);
    const endCharIdx = Math.min(
      spoken.length - 1,
      charIdx + Math.max(0, m[0].length - 1)
    );
    timeline.push({
      word: m[0],
      cleanStart: m.index,
      atSec: starts[charIdx],
      endSec: ends?.[endCharIdx] ?? starts[endCharIdx],
    });
  }

  return timeline;
}

function wordAtCleanPos(timeline, cleanPos) {
  for (const entry of timeline) {
    if (cleanPos >= entry.cleanStart && cleanPos < entry.cleanStart + entry.word.length) {
      return entry;
    }
  }
  return timeline.find((entry) => entry.cleanStart === cleanPos) ?? null;
}

function stutterEventAtCleanPos(rawText, matchIndex, cleanText, spoken, starts, ends) {
  const cleanPos = cleanIndexAtRaw(rawText, matchIndex);
  const timeline = buildCleanWordTimeline(cleanText, spoken, starts, ends);
  const word = wordAtCleanPos(timeline, cleanPos);

  if (word) {
    return { atSec: word.atSec, endSec: word.endSec, word: word.word, cleanPos };
  }

  return {
    atSec: cleanPosToTime(cleanPos, cleanText, spoken, starts),
    endSec: null,
    word: null,
    cleanPos,
  };
}

/** Display word indices for each stutter, in order of appearance. */
function stutterWordIndices(rawText) {
  return parseDisplayTokens(rawText)
    .filter((t) => t.kind === "stutter")
    .map((t) => t.wordIndex);
}

/** Map stutter markers to audio times using ElevenLabs character alignment. */
export function buildStutterScheduleFromAlignment(rawText, alignment) {
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  const chars = alignment?.characters;
  if (!starts?.length || !chars?.length) return null;

  const cleanText = stripStutterForSpeech(rawText);
  if (!cleanText) return null;

  const spoken = chars.join("");
  const wordIndices = stutterWordIndices(rawText);
  const events = [];
  const re = new RegExp(STUTTER_RE.source, STUTTER_RE.flags);
  let m;
  let i = 0;

  while ((m = re.exec(rawText)) !== null) {
    const ev = stutterEventAtCleanPos(rawText, m.index, cleanText, spoken, starts, ends);
    ev.wordIndex = wordIndices[i++];
    events.push(ev);
  }

  return events.length ? events : null;
}

/** Fallback: estimate stutter times from duration when alignment is unavailable. */
export function buildStutterSchedule(rawText, durationMs) {
  const cleanText = stripStutterForSpeech(rawText);
  const totalClean = cleanText.length;
  const durationSec = durationMs / 1000;
  if (!totalClean || !durationSec) return [];

  const wordIndices = stutterWordIndices(rawText);
  const events = [];
  const re = new RegExp(STUTTER_RE.source, STUTTER_RE.flags);
  let m;
  let i = 0;

  while ((m = re.exec(rawText)) !== null) {
    const cleanPos = cleanIndexAtRaw(rawText, m.index);
    const atSec = (cleanPos / totalClean) * durationSec;
    const wordMatch = cleanText.slice(cleanPos).match(/^\S+/);
    const wordLen = wordMatch?.[0]?.length ?? 1;
    const endSec = ((cleanPos + wordLen) / totalClean) * durationSec;
    events.push({ atSec, endSec, word: wordMatch?.[0] ?? null, cleanPos, wordIndex: wordIndices[i++] });
  }

  return events;
}

/** Map [GLITCH] markers to audio times using ElevenLabs character alignment. */
export function buildGlitchScheduleFromAlignment(rawText, alignment) {
  const positions = glitchCleanPositions(rawText);
  if (!positions.length) return [];

  const starts = alignment?.character_start_times_seconds;
  const chars = alignment?.characters;
  if (!starts?.length || !chars?.length) return null;

  const cleanText = stripStutterForSpeech(rawText);
  const spoken = chars.join("");
  return positions.map((cleanPos) => ({
    atSec: cleanPosToTime(cleanPos, cleanText, spoken, starts),
  }));
}

/** Fallback: estimate [GLITCH] times from duration when alignment is unavailable. */
export function buildGlitchSchedule(rawText, durationMs) {
  const positions = glitchCleanPositions(rawText);
  const totalClean = stripStutterForSpeech(rawText).length;
  const durationSec = durationMs / 1000;
  if (!positions.length || !totalClean || !durationSec) return [];

  return positions.map((cleanPos) => ({
    atSec: (cleanPos / totalClean) * durationSec,
  }));
}

function glitchCleanPositions(rawText) {
  const positions = [];
  const re = /\[GLITCH\]/gi;
  let m;
  while ((m = re.exec(rawText)) !== null) {
    positions.push(cleanIndexAtRaw(rawText, m.index));
  }
  return positions;
}

/** Display tokens for karaoke highlighting (words + stutter spans).
 * Each token's cleanStart is derived from its raw index via cleanIndexAtRaw so
 * it stays consistent with the clean speech text (spaces collapsed) — manual
 * accumulation previously skipped spaces, drifting later words earlier. */
function parseDisplayTokens(rawText) {
  const tokens = [];
  let wordIndex = 0;
  let i = 0;

  while (i < rawText.length) {
    if (/^\[GLITCH\]/i.test(rawText.slice(i))) {
      i += 8;
      continue;
    }

    const stutterRe = new RegExp(STUTTER_RE.source, STUTTER_RE.flags);
    stutterRe.lastIndex = i;
    const sm = stutterRe.exec(rawText);
    if (sm && sm.index === i) {
      tokens.push({
        kind: "stutter",
        display: sm[0],
        wordIndex: wordIndex++,
        cleanStart: cleanIndexAtRaw(rawText, i),
      });
      i += sm[0].length;
      continue;
    }

    if (/\s/.test(rawText[i])) {
      let ws = "";
      while (i < rawText.length && /\s/.test(rawText[i])) ws += rawText[i++];
      tokens.push({ kind: "space", display: ws.replace(/\s+/g, " ") });
      continue;
    }

    const wordStart = i;
    let word = "";
    while (i < rawText.length) {
      if (/^\[GLITCH\]/i.test(rawText.slice(i))) break;
      if (/\s/.test(rawText[i])) break;
      const stutterRe2 = new RegExp(STUTTER_RE.source, STUTTER_RE.flags);
      stutterRe2.lastIndex = i;
      const maybe = stutterRe2.exec(rawText);
      if (maybe && maybe.index === i) break;
      word += rawText[i++];
    }

    if (word) {
      tokens.push({
        kind: "word",
        display: word,
        wordIndex: wordIndex++,
        cleanStart: cleanIndexAtRaw(rawText, wordStart),
      });
    }
  }

  return tokens;
}

/** Word highlight times from ElevenLabs alignment. */
export function buildWordScheduleFromAlignment(rawText, alignment) {
  const starts = alignment?.character_start_times_seconds;
  const chars = alignment?.characters;
  if (!starts?.length || !chars?.length) return null;

  const cleanText = stripStutterForSpeech(rawText);
  const spoken = chars.join("");
  const tokens = parseDisplayTokens(rawText).filter((t) => t.wordIndex != null);

  return tokens.map((t) => ({
    wordIndex: t.wordIndex,
    atSec: cleanPosToTime(t.cleanStart, cleanText, spoken, starts),
  }));
}

/** Times at which each spoken sentence begins (for per-sentence gestures). */
export function buildSentenceScheduleFromAlignment(_rawText, alignment) {
  const starts = alignment?.character_start_times_seconds;
  const chars = alignment?.characters;
  if (!starts?.length || !chars?.length) return null;

  const isEnd = (c) => c === "." || c === "!" || c === "?";
  const events = [];
  let expectStart = true; // start of speech begins the first sentence

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (expectStart && c.trim()) {
      events.push({ atSec: starts[i] });
      expectStart = false;
    }
    if (isEnd(c)) {
      const next = chars[i + 1];
      if (!next || /\s/.test(next)) expectStart = true; // skip decimals (3.5)
    }
  }

  return events.length ? events : null;
}

/** Fallback word highlight times from total duration. */
export function buildWordSchedule(rawText, durationMs) {
  const cleanText = stripStutterForSpeech(rawText);
  const totalClean = cleanText.length;
  const durationSec = durationMs / 1000;
  if (!totalClean || !durationSec) return [];

  return parseDisplayTokens(rawText)
    .filter((t) => t.wordIndex != null)
    .map((t) => ({
      wordIndex: t.wordIndex,
      atSec: (t.cleanStart / totalClean) * durationSec,
    }));
}

export class MaxMessageHighlighter {
  start(bodyEl, rawText, alignment, durationMs) {
    this.stop();
    if (!bodyEl) return;

    this.body = bodyEl;
    this.schedule =
      buildWordScheduleFromAlignment(rawText, alignment) ??
      buildWordSchedule(rawText, durationMs ?? 3000);
    this.words = bodyEl.querySelectorAll(".speak-word");
    this._active = -1;
    this._hold = null;
    bodyEl.closest(".msg.max")?.classList.add("speaking");
  }

  update(atSec) {
    if (!this.schedule.length) return;
    // While a word is stuttering, keep it lit — don't let playback jitter
    // (the burst rewinds/restarts) flick the highlight onto the next word.
    if (this._hold != null) {
      this._setActive(this._hold);
      return;
    }

    let idx = -1;
    for (const ev of this.schedule) {
      if (atSec >= ev.atSec) idx = ev.wordIndex;
      else break;
    }
    this._setActive(idx);
  }

  /** Lock the highlight onto a word for the duration of a stutter burst. */
  holdWord(wordIndex) {
    if (wordIndex == null) return;
    this._hold = wordIndex;
    this._setActive(wordIndex);
  }

  releaseHold() {
    this._hold = null;
  }

  stop() {
    this._setActive(-1);
    this._hold = null;
    this.body?.closest(".msg.max")?.classList.remove("speaking");
    this.body = null;
    this.schedule = [];
    this.words = null;
  }

  _setActive(idx) {
    if (idx === this._active) return;
    this._active = idx;
    this.words?.forEach((el) => {
      el.classList.toggle("speak-word--active", Number(el.dataset.w) === idx);
    });
  }
}

export function formatMaxMessage(text) {
  let html = "";

  for (const t of parseDisplayTokens(text)) {
    if (t.kind === "space") {
      html += escapeHtml(t.display);
    } else if (t.kind === "stutter") {
      html += `<span class="speak-word stutter" data-w="${t.wordIndex}">${escapeHtml(t.display)}</span>`;
    } else {
      html += `<span class="speak-word" data-w="${t.wordIndex}">${escapeHtml(t.display)}</span>`;
    }
  }

  return html;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function appendMaxMessage(container, rawText, className = "") {
  const el = document.createElement("p");
  el.className = `msg max ${className}`.trim();
  el.dataset.replayText = rawText;

  const body = document.createElement("span");
  body.className = "msg-max__body";
  body.innerHTML = formatMaxMessage(rawText);

  const replayBtn = document.createElement("button");
  replayBtn.type = "button";
  replayBtn.className = "msg-replay-btn";
  replayBtn.textContent = "Replay";
  replayBtn.setAttribute("aria-label", "Replay Max's message");

  el.append(body, replayBtn);
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

export function appendMessage(container, role, html, className = "") {
  const el = document.createElement("p");
  el.className = `msg ${role} ${className}`.trim();
  if (role === "max") {
    el.innerHTML = html;
  } else {
    el.textContent = html;
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}
