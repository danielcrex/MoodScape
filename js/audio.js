/* ===========================================================================
   audio.js — procedural ambient sound engine
   ---------------------------------------------------------------------------
   Every ambient sound (rain, wind, water, fire, birds, chimes, drone, a lofi
   beat) is SYNTHESIZED with the Web Audio API — nothing is downloaded. That
   keeps the repo tiny, sidesteps audio licensing, and makes the Ambient Mixer
   work the instant the page loads.

   Signal path:   [layer graph] → layerGain → masterGain → destination
   The mixer sliders write to layerGain (one per active layer) and masterGain.

   Browsers block audio until a user gesture, so the app calls resume() from
   the first click/tap. Everything is built lazily on first use.
   =========================================================================== */

/* The full set of layers a mood may reference (see mood.audio in moods.js). */
const LAYER_NAMES = ['rain', 'wind', 'water', 'noise', 'fire', 'thunder', 'birds', 'chimes', 'drone', 'beat'];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.layers = {};          // name → { gain, target, ...internals }
    this.enabled = false;      // master on/off (the sound toggle)
    this.masterLevel = 0.8;    // 0–1, the "master" mixer slider
    this.mix = {};             // current per-layer target gains for this mood
  }

  /* Create the context on first user gesture. Safe to call repeatedly. */
  resume() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;                 // start silent, ramp up later
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.#makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* Turn all sound on/off (the header speaker toggle). */
  setEnabled(on) {
    this.enabled = on;
    if (on) this.resume();
    this.#applyMaster();
  }

  /* Master volume slider (0–1). */
  setMasterLevel(v) {
    this.masterLevel = v;
    this.#applyMaster();
  }

  #applyMaster() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    const target = this.enabled ? this.masterLevel : 0;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(target, t, 0.25); // smooth fade
  }

  /* Switch the mix to a mood: ramp each layer to its mood level, silence the
     rest. Layers are built on demand the first time a mood needs them. */
  setMoodMix(mood) {
    this.mix = { ...mood.audio };
    LAYER_NAMES.forEach((name) => {
      const target = mood.audio[name] || 0;
      if (target > 0) this.#ensureLayer(name);
      this.#setLayer(name, target);
    });
  }

  /* Set one layer's volume (used by the mixer sliders). value is 0–1. */
  setLayer(name, value) {
    this.mix[name] = value;
    this.#ensureLayer(name);
    this.#setLayer(name, value);
  }

  getLayer(name) {
    return this.mix[name] ?? 0;
  }

  #setLayer(name, value) {
    const layer = this.layers[name];
    if (!layer) return;
    layer.target = value;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      layer.gain.gain.cancelScheduledValues(t);
      layer.gain.gain.setTargetAtTime(value, t, 0.4); // gentle crossfade
    }
  }

  /* A single soft bell — played when the focus timer finishes. Works even if
     the mood has no chime layer, as long as sound is enabled. */
  ding() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.3 / (i + 1), t + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      osc.connect(env).connect(this.master);
      osc.start(t); osc.stop(t + 2);
    });
  }

  /* ---- shared building blocks --------------------------------------------- */

  /* A 2-second buffer of white noise, looped by several layers. */
  #makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* A looping noise source. */
  #noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  /* Create a layer's gain node, wire it to master, and remember it. */
  #layerGain(name) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    this.layers[name] = { gain: g, target: 0 };
    return g;
  }

  /* Build a layer's synth graph the first time it's needed. */
  #ensureLayer(name) {
    if (!this.ctx || this.layers[name]) return;
    ({
      rain: () => this.#buildFilteredNoise(name, 'highpass', 1000, 'lowpass', 9000, 0.5),
      water: () => this.#buildFilteredNoise(name, 'highpass', 500, 'bandpass', 1200, 0.55),
      noise: () => this.#buildFilteredNoise(name, 'lowpass', 5200, null, 0, 0.25),
      wind: () => this.#buildWind(name),
      fire: () => this.#buildFire(name),
      thunder: () => this.#buildThunder(name),
      birds: () => this.#buildBirds(name),
      chimes: () => this.#buildChimes(name),
      drone: () => this.#buildDrone(name),
      beat: () => this.#buildBeat(name),
    }[name] || (() => {}))();
  }

  /* Continuous layers: noise → two filters → layer gain. Covers rain / water /
     white noise, differing only in filter shapes. */
  #buildFilteredNoise(name, t1, f1, t2, f2, level) {
    const g = this.#layerGain(name);
    const src = this.#noiseSource();
    const filterA = this.ctx.createBiquadFilter();
    filterA.type = t1; filterA.frequency.value = f1;
    src.connect(filterA);
    let out = filterA;
    if (t2) {
      const filterB = this.ctx.createBiquadFilter();
      filterB.type = t2; filterB.frequency.value = f2; filterB.Q.value = 0.7;
      filterA.connect(filterB);
      out = filterB;
    }
    // A fixed trim keeps raw noise from overpowering everything else.
    const trim = this.ctx.createGain();
    trim.gain.value = level;
    out.connect(trim).connect(g);
  }

  /* Wind: low-passed noise whose cutoff drifts, producing gusts. */
  #buildWind(name) {
    const g = this.#layerGain(name);
    const src = this.#noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 3;
    // An LFO slowly sweeps the cutoff up and down = swelling gusts.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    const trim = this.ctx.createGain(); trim.gain.value = 0.7;
    src.connect(lp).connect(trim).connect(g);
  }

  /* Fire: a steady low rumble plus scheduled sharp "crackle" bursts. */
  #buildFire(name) {
    const g = this.#layerGain(name);
    // Rumble
    const src = this.#noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    const trim = this.ctx.createGain(); trim.gain.value = 0.4;
    src.connect(lp).connect(trim).connect(g);
    // Crackles: recurring short bandpass pops.
    const crackle = () => {
      const layer = this.layers[name];
      if (layer && layer.target > 0.01) {
        const n = this.#noiseSource();
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1400 + Math.random() * 1600; bp.Q.value = 4;
        const env = this.ctx.createGain();
        const t = this.ctx.currentTime;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.5, t + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        n.connect(bp).connect(env).connect(g);
        n.stop(t + 0.1);
      }
      setTimeout(crackle, 60 + Math.random() * 400);
    };
    crackle();
  }

  /* Thunder: an occasional deep, slow swell of low-passed noise. */
  #buildThunder(name) {
    const g = this.#layerGain(name);
    const boom = () => {
      const layer = this.layers[name];
      if (layer && layer.target > 0.01) {
        const n = this.#noiseSource();
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 180;
        const env = this.ctx.createGain();
        const t = this.ctx.currentTime;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.9, t + 0.6);   // slow attack
        env.gain.exponentialRampToValueAtTime(0.001, t + 3.5); // long tail
        n.connect(lp).connect(env).connect(g);
        n.stop(t + 4);
      }
      setTimeout(boom, 8000 + Math.random() * 12000);
    };
    setTimeout(boom, 3000 + Math.random() * 5000);
  }

  /* Birds: randomly timed chirps, each a quick pitch-swept triangle tone. */
  #buildBirds(name) {
    const g = this.#layerGain(name);
    const chirp = () => {
      const layer = this.layers[name];
      if (layer && layer.target > 0.01) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        const base = 1800 + Math.random() * 1600;
        const t = this.ctx.currentTime;
        osc.frequency.setValueAtTime(base, t);
        osc.frequency.linearRampToValueAtTime(base * 1.4, t + 0.06);
        osc.frequency.linearRampToValueAtTime(base * 0.9, t + 0.12);
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.25, t + 0.02);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(env).connect(g);
        osc.start(t); osc.stop(t + 0.2);
      }
      setTimeout(chirp, 300 + Math.random() * 2200);
    };
    chirp();
  }

  /* Chimes: gentle bell tones drawn from a pentatonic set, with soft decay. */
  #buildChimes(name) {
    const g = this.#layerGain(name);
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0]; // C D E G A
    const ring = () => {
      const layer = this.layers[name];
      if (layer && layer.target > 0.01) {
        const f = scale[Math.floor(Math.random() * scale.length)];
        const t = this.ctx.currentTime;
        // A bell = fundamental + two inharmonic partials, each decaying.
        [1, 2.01, 3.03].forEach((mult, i) => {
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = f * mult;
          const env = this.ctx.createGain();
          const peak = 0.3 / (i + 1);
          env.gain.setValueAtTime(0, t);
          env.gain.linearRampToValueAtTime(peak, t + 0.01);
          env.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
          osc.connect(env).connect(g);
          osc.start(t); osc.stop(t + 2.6);
        });
      }
      setTimeout(ring, 1500 + Math.random() * 3000);
    };
    ring();
  }

  /* Drone: detuned sine oscillators through a slowly moving low-pass — a warm,
     resonant pad that never resolves. */
  #buildDrone(name) {
    const g = this.#layerGain(name);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 6;
    const trim = this.ctx.createGain(); trim.gain.value = 0.4;
    lp.connect(trim).connect(g);
    [55, 82.5, 110, 138.6].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.01); // slight detune
      osc.connect(lp);
      osc.start();
    });
    // Very slow filter sweep for movement.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
  }

  /* Beat: a mellow lofi loop — soft kick, hat, and a sustained chord pad, kept
     under a lowpass so it stays cozy rather than clubby. */
  #buildBeat(name) {
    const g = this.#layerGain(name);
    const bus = this.ctx.createBiquadFilter();
    bus.type = 'lowpass'; bus.frequency.value = 2600;
    bus.connect(g);

    const bpm = 74;
    const beatDur = 60 / bpm;
    let step = 0;
    let nextTime = this.ctx.currentTime + 0.1;

    const kick = (t) => {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      env.gain.setValueAtTime(0.9, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(env).connect(bus);
      osc.start(t); osc.stop(t + 0.26);
    };
    const hat = (t) => {
      const n = this.#noiseSource();
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7000;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.18, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      n.connect(hp).connect(env).connect(bus);
      n.stop(t + 0.06);
    };
    const pad = (t) => {
      // A soft minor-7 chord that swells in once per bar.
      [220, 261.63, 329.63, 392].forEach((f) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.06, t + 0.4);
        env.gain.exponentialRampToValueAtTime(0.001, t + beatDur * 4);
        osc.connect(env).connect(bus);
        osc.start(t); osc.stop(t + beatDur * 4 + 0.1);
      });
    };

    // Lookahead scheduler: fires slightly ahead of time for steady timing.
    setInterval(() => {
      const layer = this.layers[name];
      if (!layer || layer.target <= 0.01) return;      // stay silent when muted
      while (nextTime < this.ctx.currentTime + 0.15) {
        if (step % 4 === 0) { kick(nextTime); if (step % 16 === 0) pad(nextTime); }
        if (step % 2 === 1) hat(nextTime);
        step = (step + 1) % 16;
        nextTime += beatDur / 2;                        // eighth-note grid
      }
    }, 25);
  }
}
