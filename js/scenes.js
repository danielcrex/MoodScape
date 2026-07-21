/* ===========================================================================
   scenes.js — procedural canvas backgrounds (the app's signature)
   ---------------------------------------------------------------------------
   Every mood has a hand-written generative scene so MoodScape looks alive with
   NO downloaded assets. Each scene is a small factory:

       createScene(canvas, mood) -> { start(), stop(), resize() }

   All scenes share the same lifecycle:
     - start()   begin the animation loop (or paint one static frame if the
                 user prefers reduced motion)
     - stop()    cancel the loop and free the CPU (called after a crossfade
                 finishes, so only the visible scene ever animates)
     - resize()  re-fit the canvas to its box on window resize / rotation

   The colour WASH for each mood lives in a separate DOM overlay (see
   background.js); scenes only paint their own base atmosphere + particles.
   =========================================================================== */

/* Honour the OS "reduce motion" setting: when true we render one frame and
   stop, so the experience is calm and battery-friendly for those who need it. */
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Fit a canvas to its CSS box at the device pixel ratio (capped at 2 so we
   don't burn GPU on very high-DPI phones), and return a context already scaled
   to CSS pixels so all drawing code can think in simple px units. */
function fit(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* Paint a top→bottom gradient across the whole canvas. */
function backdrop(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

const rand = (a, b) => a + Math.random() * (b - a);

/* Small helper that wires up the RAF loop + reduced-motion handling so each
   scene factory only has to provide init(), draw(time) and (optionally) a
   static frame. Returns the { start, stop, resize } object every scene exposes. */
function makeScene(canvas, { init, draw }) {
  let raf = 0;
  let running = false;
  let state = null; // whatever init() returns (particles, dims, etc.)
  let t0 = performance.now();

  function resize() {
    const { ctx, w, h } = fit(canvas);
    state = init(ctx, w, h);
  }

  function frame(now) {
    if (!running) return;
    // Clamp to 0: a rAF timestamp can be marginally EARLIER than the t0 we took
    // just before scheduling it, which would make elapsed time negative and,
    // e.g., feed a negative radius into ctx.ellipse (ripples). Time since start
    // is never negative, so guard it here for every scene.
    const t = Math.max(0, (now - t0) / 1000); // seconds since start, for smooth motion
    draw(state, t);
    raf = requestAnimationFrame(frame);
  }

  return {
    resize,
    start() {
      if (running) return;
      running = true;
      resize();
      if (REDUCED) {
        draw(state, 0); // one representative frame, then hold
        return;
      }
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}

/* ---------------------------------------------------------------------------
   RELAX — warm light motes drifting upward over a golden-hour sky, with a
   soft band of swaying grass silhouetted along the bottom.
   --------------------------------------------------------------------------- */
function motes(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      const motes = Array.from({ length: 46 }, () => ({
        x: rand(0, w), y: rand(0, h),
        r: rand(1, 3.4), speed: rand(6, 20), drift: rand(-8, 8), a: rand(0.2, 0.7),
      }));
      // Pre-compute grass blade phases so each sways independently.
      const blades = Array.from({ length: 70 }, (_, i) => ({
        x: (i / 70) * w, h: rand(h * 0.10, h * 0.26), phase: rand(0, Math.PI * 2), sway: rand(6, 16),
      }));
      return { ctx, w, h, motes, blades };
    },
    draw({ ctx, w, h, motes, blades }, t) {
      backdrop(ctx, w, h, '#F6C77A', '#B4762E');
      // Motes: additive glow so they read as suspended pollen/light.
      ctx.globalCompositeOperation = 'lighter';
      for (const m of motes) {
        m.y -= m.speed * 0.016;
        m.x += Math.sin(t + m.y * 0.01) * 0.3 + m.drift * 0.004;
        if (m.y < -10) { m.y = h + 10; m.x = rand(0, w); }
        ctx.beginPath();
        ctx.fillStyle = mood.tint;
        ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(t * 1.5 + m.x));
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      // Grass: dark blades that lean with a shared breeze.
      ctx.strokeStyle = 'rgba(60,36,8,0.55)';
      ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const b of blades) {
        const lean = Math.sin(t * 0.8 + b.phase) * b.sway;
        ctx.beginPath();
        ctx.moveTo(b.x, h);
        ctx.quadraticCurveTo(b.x + lean * 0.5, h - b.h * 0.6, b.x + lean, h - b.h);
        ctx.stroke();
      }
    },
  });
}

/* ---------------------------------------------------------------------------
   MELANCHOLY — steady rain streaks over a misty forest, pine silhouettes
   fading into fog at the horizon.
   --------------------------------------------------------------------------- */
function rain(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      const drops = Array.from({ length: 260 }, () => ({
        x: rand(0, w), y: rand(0, h), len: rand(10, 24), speed: rand(600, 900),
      }));
      // Pine silhouettes anchored along the base, receding in tone.
      const pines = Array.from({ length: 14 }, (_, i) => ({
        x: (i / 13) * w, w: rand(w * 0.05, w * 0.10), h: rand(h * 0.22, h * 0.42), shade: rand(0.25, 0.5),
      }));
      return { ctx, w, h, drops, pines };
    },
    draw({ ctx, w, h, drops, pines }, t) {
      backdrop(ctx, w, h, '#7C8CA6', '#232F44');
      // Mist band drifting horizontally near the treeline.
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = '#C9D4E4';
      ctx.fillRect(0, h * 0.55 + Math.sin(t * 0.3) * 8, w, h * 0.25);
      ctx.globalAlpha = 1;
      // Pines drawn as simple triangles, back-to-front.
      for (const p of pines) {
        ctx.fillStyle = `rgba(18,26,40,${p.shade})`;
        ctx.beginPath();
        ctx.moveTo(p.x, h - p.h);
        ctx.lineTo(p.x - p.w, h);
        ctx.lineTo(p.x + p.w, h);
        ctx.closePath();
        ctx.fill();
      }
      // Rain: thin, slightly angled streaks.
      ctx.strokeStyle = 'rgba(200,214,235,0.45)';
      ctx.lineWidth = 1.2;
      for (const d of drops) {
        d.y += d.speed * 0.016;
        d.x += 1.2; // gentle wind slant
        if (d.y > h) { d.y = -d.len; d.x = rand(0, w); }
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 2, d.y + d.len);
        ctx.stroke();
      }
    },
  });
}

/* ---------------------------------------------------------------------------
   JOYFUL — bright blooming field: petals lift and tumble upward through sunlit
   air, with occasional sparkle.
   --------------------------------------------------------------------------- */
function petals(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      const petals = Array.from({ length: 34 }, () => ({
        x: rand(0, w), y: rand(0, h), r: rand(5, 11), rot: rand(0, Math.PI * 2),
        spin: rand(-1, 1), rise: rand(14, 30), sway: rand(20, 46), hue: rand(-14, 14),
      }));
      return { ctx, w, h, petals };
    },
    draw({ ctx, w, h, petals }, t) {
      backdrop(ctx, w, h, '#FCEBB0', '#8CCE7C');
      for (const p of petals) {
        p.y -= p.rise * 0.016;
        p.x += Math.sin(t + p.y * 0.02) * (p.sway * 0.01);
        p.rot += p.spin * 0.02;
        if (p.y < -14) { p.y = h + 14; p.x = rand(0, w); }
        // A petal = a rotated, squashed ellipse in soft pink/cream.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `hsl(${340 + p.hue}, 80%, 84%)`;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // Sparkles: brief additive twinkles keyed off time.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) {
        const a = 0.5 + 0.5 * Math.sin(t * 3 + i * 2);
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = '#FFFDEB';
        const x = (i / 8) * w + Math.sin(t + i) * 30;
        const y = h * 0.3 + Math.cos(t * 0.7 + i) * h * 0.2;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
  });
}

/* ---------------------------------------------------------------------------
   FOCUSED — a glassy mountain lake: near-still water with slow horizontal
   shimmer lines and the occasional expanding ripple. Deliberately minimal.
   --------------------------------------------------------------------------- */
function ripples(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      // A few ripples with staggered birth times so they don't pulse in sync.
      const ripples = Array.from({ length: 4 }, (_, i) => ({
        x: rand(w * 0.2, w * 0.8), y: rand(h * 0.55, h * 0.9), born: -i * 2.5,
      }));
      return { ctx, w, h, ripples };
    },
    draw({ ctx, w, h, ripples }, t) {
      backdrop(ctx, w, h, '#9DB6BE', '#28404A');
      // Shimmer: faint horizontal highlights that slide, reading as calm water.
      ctx.strokeStyle = 'rgba(220,236,240,0.12)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 22; i++) {
        const y = h * 0.5 + (i / 22) * h * 0.5;
        const off = Math.sin(t * 0.5 + i * 0.6) * 14;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + off);
        ctx.stroke();
      }
      // Ripples: expanding rings that fade, then respawn.
      ctx.strokeStyle = 'rgba(220,236,240,0.5)';
      for (const r of ripples) {
        const age = t - r.born;
        const radius = (age % 6) * 26;            // grows over a 6s cycle
        const alpha = Math.max(0, 1 - (age % 6) / 6);
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, radius, radius * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  });
}

/* ---------------------------------------------------------------------------
   COZY — a warm hearth: embers rising through a dark, flickering glow.
   --------------------------------------------------------------------------- */
function embers(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      const sparks = Array.from({ length: 70 }, () => ({
        x: rand(0, w), y: rand(h * 0.4, h), r: rand(1, 2.8),
        speed: rand(20, 55), drift: rand(-10, 10), a: rand(0.4, 1),
      }));
      return { ctx, w, h, sparks };
    },
    draw({ ctx, w, h, sparks }, t) {
      backdrop(ctx, w, h, '#5A2A12', '#170905');
      // Warm floor glow that breathes, as if firelight were flickering.
      const flicker = 0.5 + 0.5 * Math.abs(Math.sin(t * 6) * Math.sin(t * 2.3));
      const g = ctx.createRadialGradient(w / 2, h, 40, w / 2, h, h * 0.9);
      g.addColorStop(0, `rgba(255,150,60,${0.35 + flicker * 0.2})`);
      g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Embers float up and cool as they rise.
      ctx.globalCompositeOperation = 'lighter';
      for (const s of sparks) {
        s.y -= s.speed * 0.016;
        s.x += Math.sin(t * 2 + s.y * 0.05) * 0.4 + s.drift * 0.004;
        if (s.y < h * 0.15) { s.y = h; s.x = rand(0, w); }
        ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(t * 4 + s.x));
        ctx.fillStyle = mood.tint;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
  });
}

/* ---------------------------------------------------------------------------
   ENCHANTED — fireflies wandering and pulsing through deep, dark woods.
   --------------------------------------------------------------------------- */
function fireflies(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      const flies = Array.from({ length: 40 }, () => ({
        x: rand(0, w), y: rand(0, h), vx: rand(-12, 12), vy: rand(-12, 12),
        phase: rand(0, Math.PI * 2), r: rand(1.6, 3.2),
      }));
      return { ctx, w, h, flies };
    },
    draw({ ctx, w, h, flies }, t) {
      backdrop(ctx, w, h, '#123A30', '#07201B');
      ctx.globalCompositeOperation = 'lighter';
      for (const f of flies) {
        // Wander: nudge velocity randomly, then integrate position.
        f.vx += rand(-2, 2); f.vy += rand(-2, 2);
        f.vx = Math.max(-18, Math.min(18, f.vx));
        f.vy = Math.max(-18, Math.min(18, f.vy));
        f.x += f.vx * 0.016; f.y += f.vy * 0.016;
        // Wrap softly at the edges.
        if (f.x < 0) f.x = w; if (f.x > w) f.x = 0;
        if (f.y < 0) f.y = h; if (f.y > h) f.y = 0;
        // Pulse the glow so the swarm twinkles out of sync.
        const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2 + f.phase));
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 6);
        g.addColorStop(0, mood.tint);
        g.addColorStop(1, 'rgba(159,240,200,0)');
        ctx.globalAlpha = glow;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
  });
}

/* ---------------------------------------------------------------------------
   ETHEREAL — slow aurora ribbons rippling over a field of stars.
   --------------------------------------------------------------------------- */
function aurora(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      const stars = Array.from({ length: 120 }, () => ({
        x: rand(0, w), y: rand(0, h * 0.7), r: rand(0.4, 1.4), tw: rand(0, Math.PI * 2),
      }));
      return { ctx, w, h, stars };
    },
    draw({ ctx, w, h, stars }, t) {
      backdrop(ctx, w, h, '#0A1030', '#05070F');
      // Stars twinkle via a slow sine on alpha.
      for (const s of stars) {
        ctx.globalAlpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t + s.tw));
        ctx.fillStyle = '#DCE6FF';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Aurora: three stacked ribbons, each a soft vertical gradient whose
      // baseline undulates with layered sine waves.
      ctx.globalCompositeOperation = 'lighter';
      const bands = ['#4FE0B0', '#5AA0FF', '#A070FF'];
      for (let b = 0; b < 3; b++) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 12) {
          const y = h * 0.42
            + Math.sin(x * 0.004 + t * 0.6 + b) * 40
            + Math.sin(x * 0.011 + t * 0.9 + b * 2) * 20
            + b * 26;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
        const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
        g.addColorStop(0, bands[b]);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    },
  });
}

/* ---------------------------------------------------------------------------
   VIBRANT — a fast time-lapse of dramatic clouds sliding across a bold sky.
   --------------------------------------------------------------------------- */
function clouds(canvas, mood) {
  return makeScene(canvas, {
    init(ctx, w, h) {
      // Several soft cloud "blobs" per layer, each layer moving at its own pace
      // for parallax. Faster than other scenes to feel energetic.
      const layers = [0.6, 1.0, 1.6].map((speed, li) => ({
        speed,
        blobs: Array.from({ length: 6 }, () => ({
          x: rand(0, w), y: rand(h * 0.1 + li * h * 0.22, h * 0.35 + li * h * 0.22),
          r: rand(w * 0.12, w * 0.26), a: rand(0.1, 0.28),
        })),
      }));
      return { ctx, w, h, layers };
    },
    draw({ ctx, w, h, layers }, t) {
      backdrop(ctx, w, h, '#FF9A76', '#5A3CA0');
      for (const layer of layers) {
        for (const c of layer.blobs) {
          c.x += layer.speed * 1.4;                 // scroll clouds sideways
          if (c.x - c.r > w) c.x = -c.r;             // wrap around
          const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r);
          g.addColorStop(0, `rgba(255,244,236,${c.a})`);
          g.addColorStop(1, 'rgba(255,244,236,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  });
}

/* Registry: mood.scene string → factory. background.js calls createScene(). */
const SCENES = { motes, rain, petals, ripples, embers, fireflies, aurora, clouds };

export function createScene(canvas, mood) {
  const factory = SCENES[mood.scene] || motes;
  return factory(canvas, mood);
}
