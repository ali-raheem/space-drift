// Ambient soundtrack, synthesised live with Web Audio (no audio files, works offline).
//
// - Pad: four detuned voices playing slowly gliding seventh chords through a
//   breathing low-pass filter, in a key and mode picked per sector.
// - Chimes: sparse bell notes from the same scale, mostly sent to a long reverb.
// - Space wind: filtered noise that swells with warp and the wormhole tunnel.
// - Rumble: a low drone that rises as a black hole gets close.
// - Arrival: a deep swell whenever the journey enters a new sector.
//
// Music randomness is cosmetic, so Math.random is fine here; the key itself is
// derived from the sector so a seed's sectors keep their character.

const MODES = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
};
const MODE_NAMES = Object.keys(MODES);
// Scale degrees a progression wanders between, weighted towards restful ones.
const PROGRESSION = [0, 0, 3, 5, 5, 3, 4, 1, 2];
const CHIME_DEGREES = [0, 1, 2, 4, 5];

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const rand = (a, b) => a + Math.random() * (b - a);

export class Soundtrack {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.6;
    this.paused = false;
    this.key = { root: 50, mode: MODES.lydian };
    this.degree = 0;
    this.nextChord = 0;
    this.nextChime = 0;
    this.lastUpdate = 0;
  }

  /** Browsers only allow audio to start from a user gesture; call this from one. */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state !== 'running' && !this.paused) this.ctx.resume().catch(() => {});
  }

  get running() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const now = ctx.currentTime;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, now);
    this.master.connect(comp);
    this.applyVolume(4);

    // Long synthetic hall: decaying stereo noise impulse.
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.buildPad();
    this.buildWind();
    this.buildRumble();
    this.setChord(0, 0.01);
    this.nextChord = now + rand(14, 22);
    this.nextChime = now + rand(2, 5);
  }

  send(node, dry, wet) {
    const d = this.ctx.createGain();
    d.gain.value = dry;
    node.connect(d).connect(this.master);
    const w = this.ctx.createGain();
    w.gain.value = wet;
    node.connect(w).connect(this.reverb);
  }

  buildPad() {
    const ctx = this.ctx;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.8;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const depth = ctx.createGain();
    depth.gain.value = 320;
    lfo.connect(depth).connect(this.padFilter.frequency);
    lfo.start();
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.11;
    this.padFilter.connect(this.padGain);
    this.send(this.padGain, 0.6, 0.7);

    this.voices = [];
    for (let v = 0; v < 4; v++) {
      const gain = ctx.createGain();
      gain.gain.value = 0.18;
      // Each voice swells on its own slow cycle so the texture keeps moving.
      const swell = ctx.createOscillator();
      swell.frequency.value = rand(0.025, 0.07);
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = 0.1;
      swell.connect(swellDepth).connect(gain.gain);
      swell.start();
      const oscs = [-6, 6].map((detune) => {
        const o = ctx.createOscillator();
        o.type = v === 0 ? 'triangle' : 'sawtooth';
        o.detune.value = detune + rand(-2, 2);
        o.connect(gain);
        o.start();
        return o;
      });
      gain.connect(this.padFilter);
      this.voices.push({ oscs, gain });
    }
    // Sub-octave root.
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.07;
    this.sub.connect(subGain).connect(this.master);
    this.sub.start();
  }

  buildWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.9;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.015;
    src.connect(this.windFilter).connect(this.windGain);
    this.send(this.windGain, 0.7, 0.4);
    src.start();
  }

  buildRumble() {
    const ctx = this.ctx;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 90;
    for (const f of [31, 46.5]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.3;
    const ng = ctx.createGain();
    ng.gain.value = 0.6;
    src.connect(ng).connect(lp);
    src.start();
    lp.connect(this.rumbleGain).connect(this.master);
  }

  // --- music ------------------------------------------------------------------------

  /** Pitch (MIDI) of scale degree `deg` above the key root. */
  note(deg, octave = 0) {
    const { root, mode } = this.key;
    const o = Math.floor(deg / 7);
    return root + 12 * (octave + o) + mode[((deg % 7) + 7) % 7];
  }

  setChord(degree, glide = 3) {
    this.degree = degree;
    const now = this.ctx.currentTime;
    // Root-position seventh chord, spread a little for an open voicing.
    const pitches = [this.note(degree, -1), this.note(degree + 2), this.note(degree + 4), this.note(degree + 6)];
    this.voices.forEach((v, i) => {
      for (const o of v.oscs) o.frequency.setTargetAtTime(midiHz(pitches[i]), now, glide);
    });
    this.sub.frequency.setTargetAtTime(midiHz(this.note(degree, -2)), now, glide);
  }

  chime(now) {
    const ctx = this.ctx;
    const count = Math.random() < 0.25 ? 3 : 1;
    let deg = pick(CHIME_DEGREES) + this.degree;
    for (let i = 0; i < count; i++) {
      const t = now + i * rand(0.25, 0.6);
      const f = midiHz(this.note(deg, 1 + (Math.random() < 0.3 ? 1 : 0)));
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(rand(0.04, 0.08), t + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t + rand(3, 6));
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) pan.pan.value = rand(-0.7, 0.7);
      for (const [mult, level] of [[1, 1], [2.76, 0.18], [5.4, 0.06]]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.value = level;
        o.connect(g).connect(env);
        o.start(t);
        o.stop(t + 6.5);
      }
      if (pan) env.connect(pan);
      this.send(pan ?? env, 0.25, 0.9);
      deg += pick([1, 2, -1, 3]);
    }
  }

  /** Deep swell for arriving in a new sector. */
  arrival() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    o.connect(g);
    this.send(g, 0.6, 0.8);
    o.start(t);
    o.stop(t + 6.2);
  }

  // --- hooks from the app -------------------------------------------------------------

  /** New sector: move to its key. `arrived` is false for the very first one. */
  setSector(sector, arrived) {
    const hue = ((sector.hueA % 360) + 360) % 360;
    this.key = {
      root: 45 + (Math.floor(hue / 30) % 12) % 9, // A2–F3 keeps the pad in a warm range
      mode: MODES[MODE_NAMES[Math.floor(hue * 7.3) % MODE_NAMES.length]],
    };
    if (!this.ctx) return;
    this.setChord(0, arrived ? 1.5 : 0.01);
    this.nextChord = this.ctx.currentTime + rand(14, 22);
    if (arrived && this.running) this.arrival();
  }

  /** Called every frame; follows the journey's state with smoothed parameters. */
  update(journey) {
    if (!this.running) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastUpdate < 0.1) return;
    this.lastUpdate = now;

    if (now >= this.nextChord) {
      let d;
      do d = pick(PROGRESSION); while (d === this.degree);
      this.setChord(d);
      this.nextChord = now + rand(14, 24);
    }
    if (now >= this.nextChime) {
      this.chime(now);
      this.nextChime = now + rand(3, 9);
    }

    // Speed rushes the wind and opens the pad's filter.
    const cruise = 520 * Math.max(0.25, journey.speedScale);
    const rush = Math.min(1, Math.max(0, Math.log(journey.speed / cruise) / Math.log(40)));
    const tunnel = journey.phase === 'tunnel' ? 1 : 0;
    const wind = Math.max(rush, tunnel * 0.7);
    this.windGain.gain.setTargetAtTime(0.015 + wind * 0.22, now, 0.4);
    this.windFilter.frequency.setTargetAtTime(450 + wind * 2600 + tunnel * 300 * Math.sin(now * 0.8), now, 0.4);
    this.padFilter.frequency.setTargetAtTime(700 + wind * 1400, now, 1);

    let near = 0;
    for (const b of journey.bodies) {
      if (b.type === 'blackhole' && b.sr && b.alpha) near = Math.max(near, Math.min(1, (b.sr * 8) / journey.halfDiag) * b.alpha);
    }
    this.rumbleGain.gain.setTargetAtTime(near * 0.5, now, 0.8);
  }

  applyVolume(fade = 0.3) {
    if (!this.ctx) return;
    const v = this.enabled && !this.paused ? this.volume * this.volume * 0.9 : 0;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, fade / 3);
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
    this.applyVolume();
    this.suspendLater();
  }

  setVolume(v) {
    this.volume = v;
    this.applyVolume(0.1);
  }

  /** Pausing (or hiding the tab) fades out, then suspends the context to save power. */
  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (!p && this.enabled) this.ctx.resume().catch(() => {});
    this.applyVolume(p ? 0.4 : 1.5);
    this.suspendLater();
  }

  suspendLater() {
    clearTimeout(this.suspendTimer);
    if (!this.ctx || (this.enabled && !this.paused)) return;
    this.suspendTimer = setTimeout(() => {
      if (!this.enabled || this.paused) this.ctx.suspend().catch(() => {});
    }, 600);
  }
}
