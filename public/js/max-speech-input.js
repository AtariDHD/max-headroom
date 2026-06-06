import { RealtimeTranscriber } from "./max-realtime-transcribe.js";

/**
 * Voice input — OpenAI realtime streaming transcription when available
 * (live word-by-word over WebSocket), server-side Whisper as the next
 * option, otherwise the browser Web Speech API (Chrome sends audio to Google).
 */
export class MaxSpeechInput {
  /**
   * @param {{
   *   input: HTMLInputElement,
   *   button: HTMLButtonElement,
   *   onResult: (text: string) => void,
   *   onError?: (message: string) => void,
   * }} options
   */
  constructor({ input, button, onResult, onError }) {
    this.input = input;
    this.button = button;
    this.onResult = onResult;
    this.onError = onError;
    this.listening = false;
    this._transcribing = false;
    this._enabled = true;
    this._placeholder = input.placeholder;
    this.mode = "browser";
    this.supported =
      this._hasBrowserRecognition() ||
      Boolean(navigator.mediaDevices?.getUserMedia);
    this._syncButton();
  }

  configure({ transcribe = false, realtime = false } = {}) {
    const canCapture = Boolean(navigator.mediaDevices?.getUserMedia);
    if (realtime && canCapture && typeof window.AudioContext !== "undefined") {
      this.mode = "realtime";
    } else if (transcribe) {
      this.mode = "server";
    } else {
      this.mode = "browser";
    }
    this.supported =
      this.mode === "browser" ? this._hasBrowserRecognition() : canCapture;
    this._syncButton();
  }

  _hasBrowserRecognition() {
    return Boolean(
      window.SpeechRecognition || window.webkitSpeechRecognition
    );
  }

  setEnabled(enabled) {
    this._enabled = enabled;
    if (!enabled) this.stop();
    this._syncButton();
  }

  toggle() {
    if (!this.supported || !this._enabled || this._transcribing) return;
    if (this.mode === "realtime") {
      if (this.listening) this._stopRealtime();
      else this._startRealtime();
      return;
    }
    if (this.mode === "server") {
      if (this.listening) this._stopServerRecording();
      else this._startServerRecording();
      return;
    }
    if (this.listening) this.stop();
    else this._startBrowserRecognition();
  }

  stop() {
    if (this.mode === "realtime" && this.listening) {
      this._stopRealtime();
      return;
    }
    if (this.mode === "server" && this.listening) {
      this._stopServerRecording();
      return;
    }
    this._stopBrowserRecognition();
  }

  // --- Realtime streaming transcription (OpenAI over WebSocket) ------------

  async _startRealtime() {
    this._realtimeFell = false;
    this._realtimeGotText = false;

    this._realtime = new RealtimeTranscriber({
      onPartial: (text) => {
        if (!this.listening) return;
        if (text) {
          this._realtimeGotText = true;
          this.input.value = text;
        }
      },
      onError: (message) => this._onRealtimeError(message),
    });

    try {
      this._setListening(true);
      await this._realtime.start();
      this._maxTimer = window.setTimeout(() => this._stopRealtime(), 30000);
    } catch (err) {
      const denied =
        err?.name === "NotAllowedError" || err?.name === "SecurityError";
      if (denied) {
        this._setListening(false);
        this._realtime = null;
        this.onError?.(
          "Microphone access denied — allow mic permission in your browser."
        );
        return;
      }
      // Couldn't start realtime — fall back to Whisper recording.
      this._fallbackToWhisper();
    }
  }

  _stopRealtime() {
    if (!this.listening || !this._realtime) return;
    clearTimeout(this._maxTimer);
    this._setListening(false);
    const transcriber = this._realtime;
    this._realtime = null;

    transcriber
      .stop()
      .then((text) => {
        const finalText = String(text ?? "").trim();
        if (finalText) {
          this.input.value = finalText;
          this.onResult(finalText);
        } else if (!this._realtimeGotText) {
          this.onError?.("No speech detected — try again.");
        }
      })
      .catch(() => {
        this.onError?.("Transcription failed.");
      });
  }

  _onRealtimeError(message) {
    if (this._realtimeFell) return;
    // If realtime fails before producing any text, fall back to Whisper.
    if (!this._realtimeGotText && this._realtime) {
      this._fallbackToWhisper();
      return;
    }
    this.onError?.(message || "Realtime transcription error.");
  }

  _fallbackToWhisper() {
    this._realtimeFell = true;
    this._realtime?.abort();
    this._realtime = null;
    this._setListening(false);
    if (!Boolean(navigator.mediaDevices?.getUserMedia)) {
      this.onError?.("Voice input unavailable.");
      return;
    }
    this.mode = "server";
    this._startServerRecording();
  }

  // --- Server recording (Whisper) -----------------------------------------

  async _startServerRecording() {
    try {
      this._chunks = [];
      this._recordMime = this._pickMimeType();
      this._mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this._mediaRecorder = new MediaRecorder(this._mediaStream, {
        mimeType: this._recordMime,
      });
      this._mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this._chunks.push(event.data);
      };
      this._mediaRecorder.onstop = () => {
        this._transcribeRecording(this._recordMime);
      };

      this._mediaRecorder.start(250);
      this._setListening(true);
      this._startSilenceMonitor();
      this._startLivePartials();
      this._maxTimer = window.setTimeout(
        () => this._stopServerRecording(),
        25000
      );
    } catch (err) {
      this._setListening(false);
      const denied =
        err?.name === "NotAllowedError" || err?.name === "SecurityError";
      this.onError?.(
        denied
          ? "Microphone access denied — allow mic permission in your browser."
          : "Could not access microphone."
      );
    }
  }

  _stopServerRecording() {
    if (!this.listening) return;
    clearTimeout(this._maxTimer);
    this._stopSilenceMonitor();
    this._stopLivePartials();
    this._setListening(false);

    if (this._mediaRecorder?.state === "recording") {
      this._mediaRecorder.stop();
    } else {
      this._releaseStream();
    }
  }

  /**
   * Live preview by re-transcribing the audio captured so far every ~1.6s and
   * showing the partial text. Works in any browser (including Brave, which
   * blocks the Web Speech API). The final Whisper pass on stop is authoritative.
   */
  _startLivePartials() {
    this._partialGen = (this._partialGen ?? 0) + 1;
    this._partialBusy = false;
    this._lastPartialChunkCount = 0;
    this._partialTimer = window.setInterval(() => this._runPartial(), 1600);
  }

  _stopLivePartials() {
    this._partialGen = (this._partialGen ?? 0) + 1;
    clearInterval(this._partialTimer);
    this._partialTimer = null;
  }

  async _runPartial() {
    if (!this.listening || this._transcribing || this._partialBusy) return;
    if (!this._chunks || this._chunks.length <= this._lastPartialChunkCount) {
      return; // no new audio since last partial
    }

    this._lastPartialChunkCount = this._chunks.length;
    const gen = this._partialGen;
    const mime = this._recordMime;
    this._partialBusy = true;

    try {
      const blob = new Blob(this._chunks, { type: mime });
      const audio = await blobToBase64(blob);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, mime, partial: true }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const text = String(data.text ?? "").trim();
      if (
        text &&
        gen === this._partialGen &&
        this.listening &&
        !this._transcribing
      ) {
        this.input.value = text;
      }
    } catch {
      /* partial failures are non-fatal — final pass will catch up */
    } finally {
      this._partialBusy = false;
    }
  }

  async _transcribeRecording(mime) {
    this._releaseStream();

    if (!this._chunks.length) {
      this.onError?.("No speech detected — try again.");
      return;
    }

    this._transcribing = true;
    this.input.placeholder = "Transcribing…";
    this._syncButton();

    try {
      const blob = new Blob(this._chunks, { type: mime });
      const audio = await blobToBase64(blob);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, mime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");

      const text = String(data.text ?? "").trim();
      if (!text) {
        this.onError?.("No speech detected — try again.");
        return;
      }

      this.input.value = text;
      this.onResult(text);
    } catch (err) {
      this.onError?.(err.message || "Transcription failed.");
    } finally {
      this._transcribing = false;
      this.input.placeholder = this._placeholder;
      this._chunks = [];
      this._syncButton();
    }
  }

  _pickMimeType() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "audio/webm";
  }

  _startSilenceMonitor() {
    if (!this._mediaStream) return;

    this._audioCtx = new AudioContext();
    const source = this._audioCtx.createMediaStreamSource(this._mediaStream);
    const analyser = this._audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const bins = new Uint8Array(analyser.frequencyBinCount);
    let silentSince = 0;
    const SILENCE_MS = 1500;
    const THRESHOLD = 10;

    const tick = () => {
      if (!this.listening) return;
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < bins.length; i++) sum += bins[i];
      const level = sum / bins.length;

      if (level < THRESHOLD) {
        if (!silentSince) silentSince = performance.now();
        else if (performance.now() - silentSince >= SILENCE_MS) {
          this._stopServerRecording();
          return;
        }
      } else {
        silentSince = 0;
      }

      this._silenceRaf = requestAnimationFrame(tick);
    };

    tick();
  }

  _stopSilenceMonitor() {
    cancelAnimationFrame(this._silenceRaf);
    this._silenceRaf = 0;
    this._audioCtx?.close().catch(() => {});
    this._audioCtx = null;
  }

  _releaseStream() {
    this._mediaStream?.getTracks().forEach((track) => track.stop());
    this._mediaStream = null;
    this._mediaRecorder = null;
  }

  // --- Browser Web Speech API (fallback) ----------------------------------

  _disposeRecognition() {
    if (!this.recognition) return;
    this.recognition.onstart = null;
    this.recognition.onend = null;
    this.recognition.onresult = null;
    this.recognition.onerror = null;
    try {
      this.recognition.abort();
    } catch {
      /* ignore */
    }
    this.recognition = null;
  }

  async _startBrowserRecognition() {
    await this._wait(300);
    this._disposeRecognition();
    this._networkRetries = 0;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.onError?.("Voice input not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this._setListening(true);
    };

    this.recognition.onend = () => {
      this._setListening(false);
    };

    this.recognition.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += transcript;
        else interim += transcript;
      }

      const draft = (final || interim).trim();
      if (draft) this.input.value = draft;
      if (final.trim()) this.onResult(final.trim());
    };

    this.recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;

      if (event.error === "network" && this._networkRetries < 1) {
        this._networkRetries++;
        this._setListening(false);
        this._disposeRecognition();
        window.setTimeout(() => this._startBrowserRecognition(), 800);
        return;
      }

      const message =
        event.error === "not-allowed"
          ? "Microphone access denied — allow mic permission in your browser."
          : event.error === "network"
            ? "Browser speech service unreachable — Chrome sends voice to Google. Use Edge, check your connection, or add OPENAI_API_KEY for server transcription."
            : `Voice input error: ${event.error}`;
      this.onError?.(message);
      this._setListening(false);
    };

    try {
      this.input.focus();
      this.recognition.start();
    } catch {
      await this._wait(500);
      try {
        this.recognition.start();
      } catch {
        this.onError?.("Could not start voice input — try again in a moment.");
        this._setListening(false);
      }
    }
  }

  _stopBrowserRecognition() {
    if (!this.listening) return;
    try {
      this.recognition?.stop();
    } catch {
      /* ignore */
    }
    this._setListening(false);
  }

  // --- Shared UI -----------------------------------------------------------

  _setListening(value) {
    this.listening = value;
    this.input.placeholder = value ? "Listening…" : this._placeholder;
    this._syncButton();
  }

  _syncButton() {
    if (!this.button) return;

    const unavailable = !this.supported;
    this.button.disabled = unavailable || !this._enabled || this._transcribing;
    this.button.classList.toggle("listening", this.listening);
    this.button.setAttribute("aria-pressed", String(this.listening));

    if (unavailable) {
      this.button.title = "Voice input not available";
    } else if (this._transcribing) {
      this.button.title = "Transcribing…";
    } else if (this.listening) {
      this.button.title =
        this.mode === "browser" ? "Stop listening" : "Stop recording";
    } else {
      this.button.title = "Speak to Max";
    }
  }

  _wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
