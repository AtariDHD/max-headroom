/**
 * Max Headroom speech: ElevenLabs when configured, else browser TTS
 * with stutter pauses and pitch/rate tuned for a sharp TV-host feel.
 */

const STUTTER_RE = /([A-Za-z])-(?:\1-)+(\1)/gi;

export class MaxVoice {
  constructor({ onStart, onEnd, onWord, onStutter } = {}) {
    this.onStart = onStart ?? (() => {});
    this.onEnd = onEnd ?? (() => {});
    this.onWord = onWord ?? (() => {});
    this.onStutter = onStutter ?? (() => {});
    this.useElevenLabs = false;
    this._audio = null;
    this._ctx = null;
    this._analyser = null;
    this._source = null;
    this._raf = null;
    this._abort = false;
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

  /** Split text into speakable chunks with stutter timing */
  _tokenize(text) {
    const clean = text.replace(/\[GLITCH\]/gi, "").trim();
    const parts = [];
    const re = /([A-Za-z])-((?:\1-)+)(\1)(\w*)/gi;
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
    const text = rawText.replace(/\[GLITCH\]/gi, "").trim();
    if (!text) return;

    this.onStart();

    try {
      if (this.useElevenLabs) {
        await this._speakElevenLabs(text);
      } else {
        await this._speakBrowser(text);
      }
    } finally {
      if (!this._abort) this.onEnd();
    }
  }

  /** Call after a user gesture so HD voice can play (browser autoplay policy). */
  async resumeAudio() {
    await this._ensureAudioContext();
  }

  async _speakElevenLabs(text) {
    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("TTS unavailable");
      const blob = await res.blob();
      await this._playBlobWithAnalysis(blob, text);
    } catch {
      await this._speakBrowser(text);
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

  async _playBlobWithAnalysis(blob, displayText) {
    await this._ensureAudioContext();
    const url = URL.createObjectURL(blob);
    this._audio = new Audio(url);

    const arrayBuf = await fetch(url).then((r) => r.arrayBuffer());
    const buffer = await this._ctx.decodeAudioData(arrayBuf);
    this._source = this._ctx.createBufferSource();
    this._source.buffer = buffer;
    this._source.connect(this._analyser);

    this._runMouthAnalysis();
    this._simulateWordCallbacks(displayText, buffer.duration * 1000);

    const durationMs = buffer.duration * 1000;

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        this._stopAnalysis();
        URL.revokeObjectURL(url);
        resolve();
      };

      const fallbackTimer = setTimeout(finish, durationMs + 1500);

      this._source.onended = finish;

      try {
        this._source.start(0);
      } catch {
        finish();
      }
    });
  }

  _runMouthAnalysis() {
    const data = new Uint8Array(this._analyser.frequencyBinCount);
    const tick = () => {
      if (!this._analyser) return;
      this._analyser.getByteFrequencyData(data);
      this.onWord(this._mouthFromSpectrum(data));
      this._raf = requestAnimationFrame(tick);
    };
    tick();
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

  _simulateWordCallbacks(text, durationMs) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const perWord = durationMs / words.length;
    words.forEach((_, i) => {
      setTimeout(() => {
        if (!this._abort && STUTTER_RE.test(words[i])) {
          this.onStutter();
        }
      }, i * perWord);
    });
  }

  async _speakBrowser(text) {
    if (!window.speechSynthesis) {
      await this._delay(1500);
      return;
    }

    const parts = this._tokenize(text);
    const voices = speechSynthesis.getVoices();
    const voice =
      voices.find((v) => /male|david|mark|google uk english male/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      voices[0];

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
    speechSynthesis?.cancel();
    if (this._source) {
      try {
        this._source.stop();
      } catch {
        /* already stopped */
      }
      this._source = null;
    }
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
