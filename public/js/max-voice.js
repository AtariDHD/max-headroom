/**
 * Max Headroom speech: ElevenLabs when configured, else browser TTS.
 * HD voice plays clean audio with playback scrub-back stutters.
 */

import {
  buildGlitchSchedule,
  buildGlitchScheduleFromAlignment,
  buildStutterSchedule,
  buildStutterScheduleFromAlignment,
  stripStutterForSpeech,
} from "./max-chat.js";

class AudioGlitchPlayback {
  constructor({ ctx, analyser, buffer, onStutter, onStutterStart, onStutterEnd, onGlitch, onEnded, isAborted }) {
    this.ctx = ctx;
    this.analyser = analyser;
    this.buffer = buffer;
    this.onStutter = onStutter;
    this.onStutterStart = onStutterStart;
    this.onStutterEnd = onStutterEnd;
    this.onGlitch = onGlitch;
    this.onEnded = onEnded;
    this.isAborted = isAborted;
    this.source = null;
    this.offset = 0;
    this.startTime = 0;
    this.generation = 0;
    this.timers = [];
    this.stutterQueue = [];
    this.glitchQueue = [];
    this._inBurst = false;
    this.suppressEnd = false;
  }

  position() {
    if (!this.source) return this.offset;
    return Math.min(
      this.buffer.duration,
      this.offset + (this.ctx.currentTime - this.startTime)
    );
  }

  start(offset = 0) {
    this._stopSource();
    this.offset = offset;
    this.startTime = this.ctx.currentTime;
    const gen = ++this.generation;

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.analyser);
    this.source.onended = () => {
      if (gen !== this.generation) return;
      if (this.suppressEnd) {
        this.suppressEnd = false;
        return;
      }
      if (this.position() >= this.buffer.duration - 0.08) {
        this.onEnded?.();
      }
    };

    try {
      this.source.start(0, offset);
    } catch {
      this.onEnded?.();
    }
  }

  _stopSource() {
    if (!this.source) return;
    this.offset = this.position();
    this.suppressEnd = true;
    try {
      this.source.stop();
    } catch {
      /* already stopped */
    }
    this.source.disconnect();
    this.source = null;
  }

  /**
   * Repeat a short slice of the stuttered word. The slice is clamped to the
   * word's own duration so playback never bleeds into the next word (which
   * made short words like "so" sound like they stuttered on the next word).
   */
  stutterBurst(anchorSec, endSec, wordIndex) {
    if (this.isAborted()) return;

    this._inBurst = true;
    this.onStutterStart?.(wordIndex);
    const wordStart = anchorSec;
    const wordEnd = endSec ?? anchorSec + 0.14;
    const wordSpanMs = Math.max(50, (wordEnd - wordStart) * 1000);
    // Stay inside the word: a slice can't be longer than the word itself.
    const sliceMs = Math.max(55, Math.min(150, wordSpanMs * 0.9));
    const from = wordStart;
    const repeats = 5 + Math.floor(Math.random() * 3);

    if (typeof window !== "undefined" && window.__maxSpeechDebug) {
      window.__maxSpeechDebug.log("stutter-burst", {
        anchorSec,
        endSec: wordEnd,
        wordSpanMs: Math.round(wordSpanMs),
        sliceMs: Math.round(sliceMs),
        rewindFrom: from,
        playbackPos: this.position(),
      });
    }

    for (let i = 0; i < repeats; i++) {
      const timer = setTimeout(() => {
        if (this.isAborted()) return;
        this.start(from);
        this.onStutter?.();
      }, i * sliceMs);
      this.timers.push(timer);
    }

    const doneTimer = setTimeout(() => {
      this._inBurst = false;
      this.onStutterEnd?.();
    }, repeats * sliceMs + 40);
    this.timers.push(doneTimer);
  }

  scheduleStutters(events) {
    this.stutterQueue = events.map((ev) => ({
      atSec: ev.atSec,
      endSec: ev.endSec,
      word: ev.word,
      wordIndex: ev.wordIndex,
      fired: false,
    }));
  }

  scheduleGlitches(events) {
    this.glitchQueue = events.map((ev) => ({
      atSec: ev.atSec,
      fired: false,
    }));
  }

  /** Poll playback head — trigger stutters and glitches at anchor times. */
  update() {
    if (this.isAborted()) return;

    const pos = this.position();

    for (const ev of this.glitchQueue) {
      if (!ev.fired && pos >= ev.atSec) {
        ev.fired = true;
        this.onGlitch?.();
        break;
      }
    }

    if (this._inBurst || !this.stutterQueue.length) return;

    for (const ev of this.stutterQueue) {
      if (!ev.fired && pos >= ev.atSec) {
        ev.fired = true;
        if (typeof window !== "undefined" && window.__maxSpeechDebug) {
          window.__maxSpeechDebug.log("stutter-trigger", {
            word: ev.word,
            atSec: ev.atSec,
            endSec: ev.endSec,
            playbackPos: pos,
            deltaSec: pos - ev.atSec,
          });
        }
        this.stutterBurst(ev.atSec, ev.endSec, ev.wordIndex);
        break;
      }
    }
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.stutterQueue = [];
    this.glitchQueue = [];
    if (this._inBurst) this.onStutterEnd?.();
    this._inBurst = false;
    this._stopSource();
  }
}

export class MaxVoice {
  constructor({ onStart, onEnd, onWord, onStutter, onStutterStart, onStutterEnd, onGlitch, onSpeakStart, onSpeakProgress, onSpeakStop } = {}) {
    this.onStart = onStart ?? (() => {});
    this.onEnd = onEnd ?? (() => {});
    this.onWord = onWord ?? (() => {});
    this.onStutter = onStutter ?? (() => {});
    this.onStutterStart = onStutterStart ?? (() => {});
    this.onStutterEnd = onStutterEnd ?? (() => {});
    this.onGlitch = onGlitch ?? (() => {});
    this.onSpeakStart = onSpeakStart ?? (() => {});
    this.onSpeakProgress = onSpeakProgress ?? (() => {});
    this.onSpeakStop = onSpeakStop ?? (() => {});
    this.useElevenLabs = false;
    this._audio = null;
    this._ctx = null;
    this._analyser = null;
    this._playback = null;
    this._raf = null;
    this._abort = false;
    this._browserProgressTimer = null;
  }

  async configure() {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      this.useElevenLabs = Boolean(data.elevenlabs);
    } catch {
      this.useElevenLabs = false;
    }
  }

  /** Split text into speakable chunks with stutter timing (browser TTS fallback). */
  _tokenize(text) {
    const clean = text.replace(/\[GLITCH\]/gi, "").trim();
    const parts = [];
    const re = /([A-Za-z]{1,3})-((?:\1-)+)(\1)(\w*)/gi;
    let last = 0;
    let m;
    while ((m = re.exec(clean)) !== null) {
      if (m.index > last) {
        parts.push({ type: "say", text: clean.slice(last, m.index) });
      }
      const letter = m[1];
      const rest = m[4] || "";
      parts.push({
        type: "stutter",
        letter,
        full: `${letter}-${m[2]}${letter}${rest}`,
        tail: rest,
      });
      last = m.index + m[0].length;
    }
    if (last < clean.length) {
      parts.push({ type: "say", text: clean.slice(last) });
    }
    if (parts.length === 0) parts.push({ type: "say", text: clean });
    return parts;
  }

  async speak(rawText) {
    this.stop();
    this._abort = false;
    const text = rawText.trim();
    if (!text) return;

    this.onStart();

    try {
      if (this.useElevenLabs) {
        await this._speakElevenLabs(text);
      } else {
        await this._speakBrowser(text);
      }
    } finally {
      this._stopBrowserProgress();
      this.onSpeakStop();
      if (!this._abort) this.onEnd();
    }
  }

  /** Call after a user gesture so HD voice can play (browser autoplay policy). */
  async resumeAudio() {
    await this._ensureAudioContext();
  }

  async _speakElevenLabs(rawText) {
    const cleanText = stripStutterForSpeech(rawText);
    if (!cleanText) return;

    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText }),
      });
      if (!res.ok) throw new Error("TTS unavailable");

      const contentType = res.headers.get("content-type") || "";
      let blob;
      let alignment = null;

      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        blob = base64ToBlob(data.audio, data.mime || "audio/mpeg");
        alignment = pickAlignment(data, cleanText);
      } else {
        // Older server builds returned raw MP3 instead of JSON.
        blob = await res.blob();
      }

      await this._playBlobWithAnalysis(blob, rawText, alignment);
    } catch (err) {
      console.warn("ElevenLabs playback failed, using browser voice:", err);
      await this._speakBrowser(rawText);
    }
  }

  _ensureAudioContext() {
    if (!this._ctx) {
      this._ctx = new AudioContext();
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.connect(this._ctx.destination);
    }
    if (this._ctx.state === "suspended") {
      return this._ctx.resume();
    }
    return Promise.resolve();
  }

  async _playBlobWithAnalysis(blob, rawText, alignment = null) {
    await this._ensureAudioContext();
    const url = URL.createObjectURL(blob);

    const arrayBuf = await fetch(url).then((r) => r.arrayBuffer());
    const buffer = await this._ctx.decodeAudioData(arrayBuf);
    const durationMs = buffer.duration * 1000;

    this._playback = new AudioGlitchPlayback({
      ctx: this._ctx,
      analyser: this._analyser,
      buffer,
      onStutter: () => this.onStutter(),
      onStutterStart: (wordIndex) => this.onStutterStart(wordIndex),
      onStutterEnd: () => this.onStutterEnd(),
      onGlitch: () => this.onGlitch(),
      isAborted: () => this._abort,
      onEnded: null,
    });

    this._runMouthAnalysis();
    const stutterEvents =
      buildStutterScheduleFromAlignment(rawText, alignment) ??
      buildStutterSchedule(rawText, durationMs);
    const glitchEvents =
      buildGlitchScheduleFromAlignment(rawText, alignment) ??
      buildGlitchSchedule(rawText, durationMs);
    this._playback.scheduleStutters(stutterEvents);
    this._playback.scheduleGlitches(glitchEvents);

    this.onSpeakStart({
      rawText,
      alignment,
      durationMs,
    });

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        this._playback?.dispose();
        this._playback = null;
        this._stopAnalysis();
        URL.revokeObjectURL(url);
        resolve();
      };

      this._playback.onEnded = finish;
      const fallbackTimer = setTimeout(
        finish,
        durationMs + stutterEvents.length * 1200 + 3000
      );

      this._playback.start(0);
    });
  }

  _runMouthAnalysis() {
    const data = new Uint8Array(this._analyser.frequencyBinCount);
    const tick = () => {
      if (!this._analyser) return;
      this._playback?.update();
      this.onSpeakProgress(this._playback?.position() ?? 0);
      this._analyser.getByteFrequencyData(data);
      this.onWord(this._mouthFromSpectrum(data));
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  _startBrowserProgress(rawText) {
    this._stopBrowserProgress();
    const estMs = Math.max(2500, stripStutterForSpeech(rawText).length * 55);
    this.onSpeakStart({ rawText, alignment: null, durationMs: estMs });
    const t0 = performance.now();
    this._browserProgressTimer = setInterval(() => {
      if (this._abort) return;
      this.onSpeakProgress((performance.now() - t0) / 1000);
    }, 50);
  }

  _stopBrowserProgress() {
    if (this._browserProgressTimer) {
      clearInterval(this._browserProgressTimer);
      this._browserProgressTimer = null;
    }
  }

  _mouthFromSpectrum(data) {
    const n = data.length;
    const avg = (from, to) => {
      let s = 0;
      for (let i = from; i < to; i++) s += data[i];
      return s / ((to - from) || 1);
    };
    const low = avg(0, Math.floor(n * 0.15));
    const mid = avg(Math.floor(n * 0.15), Math.floor(n * 0.5));
    const high = avg(Math.floor(n * 0.5), n);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += data[i];
    const level = Math.min(1, (sum / n / 128) * 1.8);
    return {
      level,
      low: low / 128,
      mid: mid / 128,
      high: high / 128,
    };
  }

  _mouthWobble(t) {
    const wobble = 0.35 + Math.sin(t * 0.02) * 0.25;
    return {
      level: wobble,
      low: wobble * 0.45,
      mid: wobble * 0.35,
      high: wobble * 0.2,
    };
  }

  _stopAnalysis() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.onWord(0);
  }

  async _speakBrowser(text) {
    if (!window.speechSynthesis) {
      await this._delay(1500);
      return;
    }

    this._startBrowserProgress(text);

    const voices = speechSynthesis.getVoices();
    const voice =
      voices.find((v) => /male|david|mark|google uk english male/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      voices[0];

    for (const segment of splitOnGlitch(text)) {
      if (this._abort) break;

      if (segment.type === "glitch") {
        this.onGlitch();
        continue;
      }

      const parts = this._tokenize(segment.text);
      for (const part of parts) {
        if (this._abort) break;

        if (part.type === "stutter") {
          this.onStutter();
          const repeats = 3 + Math.floor(Math.random() * 2);
          for (let i = 0; i < repeats; i++) {
            if (this._abort) break;
            await this._utter(`${part.letter}!`, voice, {
              rate: 1.35,
              pitch: 1.15,
              volume: 1,
            });
            await this._delay(40 + Math.random() * 50);
          }
          if (part.tail) {
            await this._utter(part.tail, voice, { rate: 1.2, pitch: 1.05 });
          }
        } else if (part.text.trim()) {
          await this._utter(part.text, voice, {
            rate: 1.18,
            pitch: 1.08,
            volume: 1,
          });
        }
      }
    }
  }

  _utter(text, voice, opts = {}) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.rate = opts.rate ?? 1.15;
      u.pitch = opts.pitch ?? 1.05;
      u.volume = opts.volume ?? 1;

      let anim;
      const start = performance.now();
      u.onstart = () => {
        anim = setInterval(() => {
          this.onWord(this._mouthWobble(performance.now() - start));
        }, 50);
      };
      u.onend = () => {
        clearInterval(anim);
        this.onWord(0);
        resolve();
      };
      u.onerror = () => {
        clearInterval(anim);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  _delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  stop() {
    this._abort = true;
    this._stopBrowserProgress();
    this.onSpeakStop();
    speechSynthesis?.cancel();
    this._playback?.dispose();
    this._playback = null;
    if (this._audio) {
      this._audio.pause();
      this._audio = null;
    }
    this._stopAnalysis();
  }
}

// Chrome loads voices async
if (typeof window !== "undefined" && window.speechSynthesis) {
  speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

function splitOnGlitch(text) {
  const segments = [];
  const re = /\[GLITCH\]/gi;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: "say", text: text.slice(last, m.index) });
    segments.push({ type: "glitch" });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: "say", text: text.slice(last) });
  if (!segments.length) segments.push({ type: "say", text });
  return segments;
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Prefer alignment that best matches the clean text we sent to TTS. */
function pickAlignment(data, cleanText) {
  const candidates = [data.alignment, data.normalized_alignment].filter(Boolean);
  if (!candidates.length) return null;

  let best = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const spoken = candidate.characters?.join("") ?? "";
    const spokenTrim = spoken.trim();
    let score = spoken === cleanText || spokenTrim === cleanText ? 1000 : 0;
    if (!score && spoken.length && cleanText.length) {
      const ratioDiff = Math.abs(spokenTrim.length - cleanText.length);
      score = 500 - ratioDiff;
      if (spokenTrim.toLowerCase().includes(cleanText.slice(0, 8).toLowerCase())) {
        score += 100;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}
