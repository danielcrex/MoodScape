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

/* The full set of ambient layers a mood may reference (see mood.audio in
   moods.js). NOTE: 'music' is deliberately NOT here — the melodic bed is its
   own subsystem (own toggle + volume), managed separately from setMoodMix. */
const LAYER_NAMES = ['rain', 'wind', 'water', 'noise', 'fire', 'thunder', 'birds', 'chimes', 'drone', 'beat',
  'waves', 'crickets', 'bowl', 'bubbles'];

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
    this.musicOn = false;      // the Music toggle (separate from ambient sound)
    this.musicLevel = 0.6;     // 0–1, the Music volume slider
    this.musicMood = null;     // the mood whose music we'd build
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
      waves: () => this.#buildWaves(name),
      crickets: () => this.#buildCrickets(name),
      bowl: () => this.#buildBowl(name),
      bubbles: () => this.#buildBubbles(name),
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

  /* Waves: ocean surf — low-passed noise whose amplitude swells slowly in and
     out (an LFO on a gain), so it rolls rather than hisses. */
  #buildWaves(name) {
    const layer = this.#layerGain(name);
    const src = this.#noiseSource(layer);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.6;
    const swell = this.ctx.createGain(); swell.gain.value = 0.5;
    // Slow LFO on the swell gain = surf rolling in and out.
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.1;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.4;
    lfo.connect(lfoGain).connect(swell.gain); lfo.start();
    const trim = this.ctx.createGain(); trim.gain.value = 0.7;
    layer.nodes.push(lp, swell, lfo, lfoGain, trim);
    layer.sources.push(lfo);
    src.connect(lp).connect(swell).connect(trim).connect(layer.gain);
  }

  /* Crickets: night insects — each event is a short "stridulation" of fast
     pulses on a narrow high band, at random intervals. */
  #buildCrickets(name) {
    const layer = this.#layerGain(name);
    this.#repeat(layer, () => {
      const t = this.ctx.currentTime;
      const base = 4200 + Math.random() * 600;
      const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = base;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = base; bp.Q.value = 8;
      const env = this.ctx.createGain(); env.gain.value = 0.0001;
      const pulses = 6 + Math.floor(Math.random() * 4);
      for (let i = 0; i < pulses; i++) {
        const s = t + i * 0.03;                         // a train of tiny pulses
        env.gain.setValueAtTime(0.0001, s);
        env.gain.linearRampToValueAtTime(0.05, s + 0.008);
        env.gain.linearRampToValueAtTime(0.0001, s + 0.024);
      }
      osc.connect(bp).connect(env).connect(layer.gain);
      osc.start(t); osc.stop(t + pulses * 0.03 + 0.05);
    }, () => 400 + Math.random() * 900);
  }

  /* Bowl: a singing bowl — an occasional low struck tone with inharmonic
     partials and a long shimmering decay. */
  #buildBowl(name) {
    const layer = this.#layerGain(name);
    const scale = [196.0, 220.0, 261.63, 293.66]; // G3 A3 C4 D4
    this.#repeat(layer, () => {
      const f = scale[Math.floor(Math.random() * scale.length)];
      const t = this.ctx.currentTime;
      [1, 2.7, 4.2].forEach((mult, i) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = f * mult;
        const env = this.ctx.createGain();
        const peak = 0.26 / (i + 1);
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(peak, t + 0.04);
        env.gain.exponentialRampToValueAtTime(0.001, t + 6); // long tail
        osc.connect(env).connect(layer.gain);
        osc.start(t); osc.stop(t + 6.2);
      });
    }, () => 5000 + Math.random() * 5000);
  }

  /* Bubbles: gentle water drops — short sines that leap up in pitch (a "plop"). */
  #buildBubbles(name) {
    const layer = this.#layerGain(name);
    this.#repeat(layer, () => {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator(); osc.type = 'sine';
      const f = 500 + Math.random() * 700;
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.06); // rising plop
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.14, t + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(env).connect(layer.gain);
      osc.start(t); osc.stop(t + 0.16);
    }, () => 300 + Math.random() * 1200);
  }

  /* =======================================================================
     MUSIC — a synthesized melodic/harmonic bed, one per mood.
     -----------------------------------------------------------------------
     Music is a first-class layer but managed on its own (separate toggle +
     volume, rebuilt per mood because each mood's mode/tempo differ). It reuses
     the same layer record + #teardownLayer machinery, so it stops cleanly when
     a mood is left or the toggle is switched off.
     ======================================================================= */

  /* Remember the mood whose music we'd play, and (re)build if music is on. */
  setMusicMood(mood) {
    this.musicMood = mood;
    if (this.musicOn && this.ctx) {
      this.#teardownLayer('music');       // different mood = different mode/tempo
      this.#buildMusic(mood);
      this.#setMusicGain(this.musicLevel);
    }
  }

  /* The music on/off toggle. Like the layers, this must be reached from a user
     gesture so the AudioContext can resume. */
  setMusicEnabled(on) {
    this.musicOn = on;
    if (on) {
      this.resume();
      if (this.ctx && this.musicMood) {
        this.#teardownLayer('music');
        this.#buildMusic(this.musicMood);
        this.#setMusicGain(this.musicLevel);
      }
    } else {
      this.#setMusicGain(0);              // fade out, then free (see #setMusicGain)
    }
  }

  setMusicLevel(v) {
    this.musicLevel = v;
    if (this.musicOn) this.#setMusicGain(v);
  }

  getMusicLevel() { return this.musicLevel; }
  isMusicOn() { return this.musicOn; }

  /* Ramp the music bed's gain; free it (stopping oscillators + arpeggiator)
     once it has faded to silence, mirroring the ambient layers' behaviour. */
  #setMusicGain(v) {
    const layer = this.layers['music'];
    if (!layer || !this.ctx) return;
    layer.target = v;
    const t = this.ctx.currentTime;
    layer.gain.gain.cancelScheduledValues(t);
    layer.gain.gain.setTargetAtTime(v, t, 0.4);
    clearTimeout(layer.freeTimer);
    if (v <= 0.001) {
      layer.freeTimer = setTimeout(() => {
        const l = this.layers['music'];
        if (l && l.target <= 0.001) this.#teardownLayer('music');
      }, FREE_DELAY_MS);
    }
  }

  /* Build the synthesized bed for a mood from its data-driven `music` params. */
  #buildMusic(mood) {
    const p = mood.music;
    if (!p) return;
    const layer = this.#layerGain('music');

    /* =====================================================================
       EXTENSION POINT — swapping in a real recording later
       ---------------------------------------------------------------------
       To play a real music loop instead of synthesizing, this is the only seam
       you need. Given e.g. `music: { src: 'assets/music/relax.mp3' }` in
       moods.js, build the source HERE and return early:

         const audioEl = new Audio(p.src); audioEl.loop = true;
         const node = this.ctx.createMediaElementSource(audioEl);
         node.connect(layer.gain);
         audioEl.play().catch(() => {});
         layer.nodes.push(node);
         layer.el = audioEl;            // and pause it in #teardownLayer
         return;

       Everything downstream — the toggle, the volume slider, per-mood
       switching, and #teardownLayer — already works unchanged.
       ===================================================================== */

    // A gentle low-pass keeps the bed soft and sitting behind the ambience.
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass'; tone.frequency.value = p.cutoff || 2000; tone.Q.value = 0.4;
    const trim = this.ctx.createGain(); trim.gain.value = p.gain ?? 0.5;
    layer.nodes.push(tone, trim);
    tone.connect(trim).connect(layer.gain);

    // Sustained pad: a soft chord underpinning the arpeggio (persistent voices).
    if (p.chord) {
      p.chord.forEach((semi) => {
        const osc = this.ctx.createOscillator();
        osc.type = p.padWave || 'sine';
        osc.frequency.value = p.root * Math.pow(2, semi / 12);
        const g = this.ctx.createGain(); g.gain.value = 0.05;
        osc.connect(g).connect(tone); osc.start();
        layer.nodes.push(osc, g); layer.sources.push(osc);
      });
    }

    // Arpeggio: each beat plays the next scale note as a soft plucked voice,
    // with occasional octave lifts and harmonies so it never feels mechanical.
    const beat = 60 / (p.tempo || 50);
    const notes = p.scale;
    let i = 0;
    const voice = (t, freq) => {
      const osc = this.ctx.createOscillator();
      osc.type = p.wave || 'triangle';
      osc.frequency.value = freq;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.16, t + 0.04);
      env.gain.exponentialRampToValueAtTime(0.001, t + beat * 1.6);
      osc.connect(env).connect(tone);
      osc.start(t); osc.stop(t + beat * 1.6 + 0.1);
    };
    this.#repeat(layer, () => {
      const t = this.ctx.currentTime + 0.05;
      const semi = notes[i % notes.length] + 12 * (Math.random() < 0.25 ? 1 : 0);
      voice(t, p.root * Math.pow(2, semi / 12));
      if (Math.random() < 0.3) voice(t, p.root * Math.pow(2, (semi + 7) / 12)); // a fifth above
      i = (i + 1 + (Math.random() < 0.2 ? 1 : 0)) % (notes.length * 2);
    }, () => beat * 1000 * (Math.random() < 0.15 ? 2 : 1)); // steady, with the odd rest
  }
}
