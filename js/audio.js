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

   LIFECYCLE (review finding 2.1)
   ---------------------------------------------------------------------------
   A layer used to be built once and never freed: its oscillators, LFOs and
   schedulers (the beat's 25 ms setInterval, the recursive setTimeout chains in
   fire/thunder/birds/chimes) kept running forever, even ramped to silence, so
   CPU grew every time a new mood was visited. Now each layer records the nodes
   and timers it owns, and #teardownLayer() stops/disconnects everything and
   clears every handle. When a layer fades to zero we free it shortly after the
   fade completes; it is rebuilt lazily the next time a mood needs it.
   =========================================================================== */

/* The full set of layers a mood may reference (see mood.audio in moods.js). */
const LAYER_NAMES = ['rain', 'wind', 'water', 'noise', 'fire', 'thunder', 'birds', 'chimes', 'drone', 'beat'];

/* How long after a fade-to-zero we wait before freeing a layer's graph. Must
   comfortably exceed the gain fade (setTargetAtTime, ~0.4 s time-constant) so
   the teardown is inaudible. */
const FREE_DELAY_MS = 1200;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.layers = {};          // name → layer record (see #layerGain)
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
     rest. Layers are built on demand the first time a mood needs them, and the
     silenced ones are freed by #setLayer once their fade-out completes. */
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
    if (value > 0) this.#ensureLayer(name);
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
    // Ramping (near) to zero → free the layer once the fade finishes so idle
    // moods stop consuming CPU. Re-raising the level cancels the pending free.
    clearTimeout(layer.freeTimer);
    if (value <= 0.001) {
      layer.freeTimer = setTimeout(() => {
        const l = this.layers[name];
        if (l && l.target <= 0.001) this.#teardownLayer(name);
      }, FREE_DELAY_MS);
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

  /* ---- teardown ----------------------------------------------------------- */

  /* Stop and release everything a layer owns, then forget it so #ensureLayer
     rebuilds it fresh next time. Safe to call on an unknown/already-freed name. */
  #teardownLayer(name) {
    const layer = this.layers[name];
    if (!layer) return;
    // Stop the schedulers first so no new voices are spawned mid-teardown.
    clearTimeout(layer.timer);       // recursive setTimeout chain (fire/…)
    clearInterval(layer.interval);   // beat's lookahead scheduler
    clearTimeout(layer.freeTimer);   // our own pending free, if any
    // Stop long-lived sources (oscillators, looping noise) and disconnect nodes.
    layer.sources.forEach((s) => { try { s.stop(); } catch {} });
    layer.nodes.forEach((n) => { try { n.disconnect(); } catch {} });
    delete this.layers[name];
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

  /* A looping noise source that BELONGS to a layer (tracked for teardown). Use
     this for a layer's persistent bed. */
  #noiseSource(layer) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    layer.nodes.push(src);
    layer.sources.push(src);
    src.start();
    return src;
  }

  /* A short-lived noise burst for one-shot voices (crackles, hats). It stops
     itself, so it is deliberately NOT tracked — tracking transient voices would
     grow the layer's arrays without bound. It plays into the layer's gain, so
     once that gain is disconnected on teardown any in-flight burst is silent. */
  #noiseBurst() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start();
    return src;
  }

  /* Create a layer's gain node, wire it to master, and return the new layer
     record. `nodes` holds every persistent AudioNode to disconnect on teardown;
     `sources` holds the subset that must also be stopped; `timer`/`interval`
     hold the layer's scheduler handles. */
  #layerGain(name) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const layer = {
      name, gain: g, target: 0,
      nodes: [g], sources: [],
      timer: 0, interval: 0, freeTimer: 0,
    };
    this.layers[name] = layer;
    return layer;
  }

  /* Drive a self-rescheduling voice (crackle/boom/chirp/ring). It stops on its
     own the moment its layer is torn down (the record is gone or replaced), and
     its pending handle lives on layer.timer so teardown can cancel it. `work`
     fires only while the layer is audible; `delayFn()` returns ms to the next. */
  #repeat(layer, work, delayFn) {
    const run = () => {
      if (this.layers[layer.name] !== layer) return; // torn down → stop the chain
      if (layer.target > 0.01) work();               // stay silent when muted
      layer.timer = setTimeout(run, delayFn());
    };
    layer.timer = setTimeout(run, delayFn());
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
    const layer = this.#layerGain(name);
    const src = this.#noiseSource(layer);
    const filterA = this.ctx.createBiquadFilter();
    filterA.type = t1; filterA.frequency.value = f1;
    layer.nodes.push(filterA);
    src.connect(filterA);
    let out = filterA;
    if (t2) {
      const filterB = this.ctx.createBiquadFilter();
      filterB.type = t2; filterB.frequency.value = f2; filterB.Q.value = 0.7;
      layer.nodes.push(filterB);
      filterA.connect(filterB);
      out = filterB;
    }
    // A fixed trim keeps raw noise from overpowering everything else.
    const trim = this.ctx.createGain();
    trim.gain.value = level;
    layer.nodes.push(trim);
    out.connect(trim).connect(layer.gain);
  }

  /* Wind: low-passed noise whose cutoff drifts, producing gusts. */
  #buildWind(name) {
    const layer = this.#layerGain(name);
    const src = this.#noiseSource(layer);
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
    layer.nodes.push(lp, lfo, lfoGain, trim);
    layer.sources.push(lfo);
    src.connect(lp).connect(trim).connect(layer.gain);
  }

  /* Fire: a steady low rumble plus scheduled sharp "crackle" bursts. */
  #buildFire(name) {
    const layer = this.#layerGain(name);
    // Rumble (persistent)
    const src = this.#noiseSource(layer);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    const trim = this.ctx.createGain(); trim.gain.value = 0.4;
    layer.nodes.push(lp, trim);
    src.connect(lp).connect(trim).connect(layer.gain);
    // Crackles: recurring short bandpass pops (transient voices).
    this.#repeat(layer, () => {
      const n = this.#noiseBurst();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1400 + Math.random() * 1600; bp.Q.value = 4;
      const env = this.ctx.createGain();
      const t = this.ctx.currentTime;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5 + Math.random() * 0.5, t + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      n.connect(bp).connect(env).connect(layer.gain);
      n.stop(t + 0.1);
    }, () => 60 + Math.random() * 400);
  }

  /* Thunder: an occasional deep, slow swell of low-passed noise. */
  #buildThunder(name) {
    const layer = this.#layerGain(name);
    this.#repeat(layer, () => {
      const n = this.#noiseBurst();
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 180;
      const env = this.ctx.createGain();
      const t = this.ctx.currentTime;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.9, t + 0.6);        // slow attack
      env.gain.exponentialRampToValueAtTime(0.001, t + 3.5); // long tail
      n.connect(lp).connect(env).connect(layer.gain);
      n.stop(t + 4);
      // Announce the swell so the scene can flash lightning in sympathy.
      if (this.onThunder) this.onThunder();
    }, () => 8000 + Math.random() * 12000);
  }

  /* Birds: randomly timed chirps, each a quick pitch-swept triangle tone. */
  #buildBirds(name) {
    const layer = this.#layerGain(name);
    this.#repeat(layer, () => {
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
      osc.connect(env).connect(layer.gain);
      osc.start(t); osc.stop(t + 0.2);
    }, () => 300 + Math.random() * 2200);
  }

  /* Chimes: gentle bell tones drawn from a pentatonic set, with soft decay. */
  #buildChimes(name) {
    const layer = this.#layerGain(name);
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0]; // C D E G A
    this.#repeat(layer, () => {
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
        osc.connect(env).connect(layer.gain);
        osc.start(t); osc.stop(t + 2.6);
      });
    }, () => 1500 + Math.random() * 3000);
  }

  /* Drone: detuned sine oscillators through a slowly moving low-pass — a warm,
     resonant pad that never resolves. */
  #buildDrone(name) {
    const layer = this.#layerGain(name);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 6;
    const trim = this.ctx.createGain(); trim.gain.value = 0.4;
    layer.nodes.push(lp, trim);
    lp.connect(trim).connect(layer.gain);
    [55, 82.5, 110, 138.6].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.01); // slight detune
      osc.connect(lp);
      osc.start();
      layer.nodes.push(osc); layer.sources.push(osc);
    });
    // Very slow filter sweep for movement.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    layer.nodes.push(lfo, lfoGain); layer.sources.push(lfo);
  }

  /* Beat: a mellow lofi loop — soft kick, hat, and a sustained chord pad, kept
     under a lowpass so it stays cozy rather than clubby. */
  #buildBeat(name) {
    const layer = this.#layerGain(name);
    const bus = this.ctx.createBiquadFilter();
    bus.type = 'lowpass'; bus.frequency.value = 2600;
    layer.nodes.push(bus);
    bus.connect(layer.gain);

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
      const n = this.#noiseBurst();
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

    // Lookahead scheduler: fires slightly ahead of time for steady timing. The
    // handle lives on layer.interval so #teardownLayer can clear it; it also
    // self-stops if the layer is ever swapped out from under it.
    layer.interval = setInterval(() => {
      if (this.layers[name] !== layer) { clearInterval(layer.interval); return; }
      if (layer.target <= 0.01) return;                // stay silent when muted
      while (nextTime < this.ctx.currentTime + 0.15) {
        if (step % 4 === 0) { kick(nextTime); if (step % 16 === 0) pad(nextTime); }
        if (step % 2 === 1) hat(nextTime);
        step = (step + 1) % 16;
        nextTime += beatDur / 2;                        // eighth-note grid
      }
    }, 25);
  }
}
