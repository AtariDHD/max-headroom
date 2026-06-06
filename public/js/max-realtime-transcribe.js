/**
 * Streams mic audio to OpenAI's realtime transcription via the server proxy,
 * emitting live word-by-word text. PCM16 mono @ 24 kHz over a WebSocket.
 */
export class RealtimeTranscriber {
  /**
   * @param {{
   *   onReady?: () => void,
   *   onPartial?: (text: string) => void,
   *   onError?: (message: string) => void,
   * }} handlers
   */
  constructor({ onReady, onPartial, onError } = {}) {
    this.onReady = onReady ?? (() => {});
    this.onPartial = onPartial ?? (() => {});
    this.onError = onError ?? (() => {});
    this._ws = null;
    this._ctx = null;
    this._stream = null;
    this._node = null;
    this._source = null;
    this._sink = null;
    this._committed = "";
    this._pending = "";
    this._flushBuffer = [];
    this._flushSamples = 0;
    this._active = false;
  }

  get transcript() {
    return `${this._committed} ${this._pending}`.replace(/\s+/g, " ").trim();
  }

  async start() {
    this._active = true;
    this._committed = "";
    this._pending = "";

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    if (!this._active) return this._teardownMedia();

    this._ctx = new AudioContext({ sampleRate: 24000 });
    await this._ctx.audioWorklet.addModule("/js/pcm-worklet.js");
    if (!this._active) return this.stop();

    this._source = this._ctx.createMediaStreamSource(this._stream);
    this._node = new AudioWorkletNode(this._ctx, "pcm-processor");
    // Silent sink keeps the worklet pulling audio without playing the mic back.
    this._sink = this._ctx.createGain();
    this._sink.gain.value = 0;
    this._source.connect(this._node);
    this._node.connect(this._sink);
    this._sink.connect(this._ctx.destination);

    this._node.port.onmessage = (e) => this._onPcmFrame(e.data);

    await this._openSocket();
  }

  _openSocket() {
    return new Promise((resolve) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/api/realtime-transcribe`);
      this._ws = ws;

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === "ready") {
          this.onReady();
        } else if (msg.type === "delta") {
          this._pending += msg.text;
          this.onPartial(this.transcript);
        } else if (msg.type === "completed") {
          this._committed = `${this._committed} ${msg.text ?? this._pending}`
            .replace(/\s+/g, " ")
            .trim();
          this._pending = "";
          this.onPartial(this.transcript);
        } else if (msg.type === "error") {
          this.onError(msg.error || "Realtime transcription error");
        }
      };

      ws.onerror = () => this.onError("Realtime connection error");
      ws.onclose = () => {
        if (this._active) this.onError("Realtime connection closed");
      };
      ws.onopen = () => resolve();
    });
  }

  _onPcmFrame(float32) {
    if (!this._active) return;
    this._flushBuffer.push(float32);
    this._flushSamples += float32.length;

    // Flush ~every 120ms (2880 samples @ 24 kHz) to keep latency low.
    if (this._flushSamples >= 2880) {
      this._flushPcm();
    }
  }

  _flushPcm() {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._flushSamples) {
      this._flushBuffer = [];
      this._flushSamples = 0;
      return;
    }

    const merged = new Float32Array(this._flushSamples);
    let offset = 0;
    for (const chunk of this._flushBuffer) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this._flushBuffer = [];
    this._flushSamples = 0;

    const pcm16 = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    this._ws.send(JSON.stringify({ audio: base64FromBytes(new Uint8Array(pcm16.buffer)) }));
  }

  /** Stop capture; returns the best-known transcript. */
  async stop() {
    this._active = false;
    this._flushPcm();
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify({ type: "commit" }));
      } catch {
        /* ignore */
      }
    }
    this._teardownMedia();
    const text = this.transcript;
    // Give the final delta/completed a brief moment to land.
    await new Promise((r) => setTimeout(r, 250));
    const finalText = this.transcript || text;
    this._closeSocket();
    return finalText;
  }

  _teardownMedia() {
    if (this._node) {
      this._node.port.onmessage = null;
      this._node.disconnect();
      this._node = null;
    }
    this._source?.disconnect();
    this._source = null;
    this._sink?.disconnect();
    this._sink = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this._ctx?.close().catch(() => {});
    this._ctx = null;
  }

  _closeSocket() {
    if (this._ws) {
      this._ws.onmessage = null;
      this._ws.onerror = null;
      this._ws.onclose = null;
      try {
        this._ws.close();
      } catch {
        /* ignore */
      }
      this._ws = null;
    }
  }

  abort() {
    this._active = false;
    this._teardownMedia();
    this._closeSocket();
  }
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
