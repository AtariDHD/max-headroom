/**
 * Captures mono mic audio and posts Float32 frames to the main thread.
 * The AudioContext runs at 24 kHz, so frames are already at OpenAI's
 * expected realtime input rate — no resampling needed on the main thread.
 */
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
