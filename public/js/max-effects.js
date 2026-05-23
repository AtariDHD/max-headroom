/** DOM + 3D glitch coordination */
export class MaxEffects {
  constructor({ stage, flash, scene }) {
    this.stage = stage;
    this.flash = flash;
    this.scene = scene;
  }

  pulseGlitch(strength = 1) {
    this.scene?.triggerGlitch(strength);
    if (this.stage) {
      this.stage.classList.remove("glitching");
      void this.stage.offsetWidth;
      this.stage.classList.add("glitching");
      setTimeout(() => this.stage.classList.remove("glitching"), 200);
    }
    if (this.flash) {
      this.flash.hidden = false;
      this.flash.classList.remove("active");
      void this.flash.offsetWidth;
      this.flash.classList.add("active");
    }
  }

  /** Run glitches timed to [GLITCH] markers and random stutters */
  scheduleForSpeech(text, durationMs = 3000) {
    this._timeouts.forEach(clearTimeout);
    this._timeouts = [];

    // Glitches only on explicit [GLITCH] markers — not random shakes while talking
    const markers = (text.match(/\[GLITCH\]/gi) || []).length;
    for (let i = 0; i < markers; i++) {
      const at = (durationMs / (markers + 1)) * (i + 1);
      this._timeouts.push(
        setTimeout(() => this.pulseGlitch(0.8 + Math.random() * 0.4), at)
      );
    }
  }

  _timeouts = [];
}
