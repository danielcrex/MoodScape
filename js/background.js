/* ===========================================================================
   background.js — the immersive backdrop
   ---------------------------------------------------------------------------
   Manages TWO stacked full-screen layers that crossfade into each other, so a
   mood change never flashes to black. Each layer can host EITHER:
     - a <video> (if the mood declares real footage AND it loads), or
     - a <canvas> running the mood's procedural scene (the default fallback).

   A per-layer colour "grade" (a low-alpha gradient) washes the atmosphere in
   the mood's palette. Because the grade lives inside the layer, it crossfades
   together with the imagery as one orchestrated moment.

   Public API:
     const bg = new Background(mountEl);
     bg.show(mood);   // crossfade to a mood
   =========================================================================== */

import { createScene } from './scenes.js';

/* Build one layer's DOM: a positioned wrapper containing a video, a canvas,
   and a grade overlay. Returns the pieces we need to drive it. */
function buildLayer() {
  const root = document.createElement('div');
  root.className = 'bg-layer';

  const video = document.createElement('video');
  video.className = 'bg-video';
  video.muted = true;          // required for autoplay; real audio is mixed separately
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';

  const canvas = document.createElement('canvas');
  canvas.className = 'bg-canvas';

  const grade = document.createElement('div');
  grade.className = 'bg-grade';

  root.append(video, canvas, grade);
  return { root, video, canvas, grade, scene: null, video_active: false };
}

export class Background {
  constructor(mount) {
    this.mount = mount;
    this.layers = [buildLayer(), buildLayer()];
    this.layers.forEach((l) => mount.appendChild(l.root));
    this.front = 0;               // index of the currently visible layer
    this.current = null;          // current mood object

    // Keep the visible canvas sized to the viewport on resize/rotate.
    window.addEventListener('resize', () => {
      const l = this.layers[this.front];
      if (l.scene) l.scene.resize();
    });
  }

  /* Crossfade to `mood`. Loads it into the hidden (back) layer, fades layers,
     then tears down the old one so only the visible scene keeps animating. */
  show(mood) {
    if (this.current && this.current.id === mood.id) return;
    this.current = mood;

    const back = this.layers[this.front === 0 ? 1 : 0];
    const frontLayer = this.layers[this.front];

    // Paint the colour grade for this mood (top → bottom gradient).
    back.grade.style.background =
      `linear-gradient(to bottom, ${mood.grade[0]}, ${mood.grade[1]})`;

    // Tear down whatever the back layer was showing before.
    this.#teardown(back);

    // Prefer real video when the mood provides it; otherwise a procedural scene.
    if (mood.video) {
      this.#tryVideo(back, mood);
    } else {
      this.#useScene(back, mood);
    }

    // Crossfade: reveal the back layer, hide the front one (CSS handles the
    // opacity transition). Then swap our notion of which layer is in front.
    requestAnimationFrame(() => {
      back.root.classList.add('is-visible');
      frontLayer.root.classList.remove('is-visible');
    });
    this.front = this.front === 0 ? 1 : 0;

    // Once the fade is done, stop the now-hidden layer to save the CPU/GPU.
    clearTimeout(this._cleanupTimer);
    this._cleanupTimer = setTimeout(() => this.#teardown(frontLayer), 1300);
  }

  /* Attempt to play footage. If it errors (e.g. files not added yet) we quietly
     fall back to the procedural scene, so the app is never broken by a missing
     asset. */
  #tryVideo(layer, mood) {
    const v = layer.video;
    v.innerHTML = '';
    if (mood.video.poster) v.poster = mood.video.poster;
    if (mood.video.webm) v.append(source(mood.video.webm, 'video/webm'));
    if (mood.video.mp4) v.append(source(mood.video.mp4, 'video/mp4'));

    layer.root.classList.add('is-loading');
    const onReady = () => {
      layer.root.classList.remove('is-loading');
      layer.video_active = true;
      v.play().catch(() => {});
    };
    const onFail = () => {
      layer.root.classList.remove('is-loading');
      this.#useScene(layer, mood); // graceful degradation
    };
    v.addEventListener('canplay', onReady, { once: true });
    v.addEventListener('error', onFail, { once: true });
    // Guard: if nothing has loaded shortly, assume the file is absent.
    layer._videoGuard = setTimeout(() => {
      if (!layer.video_active) onFail();
    }, 2500);
    v.load();
  }

  /* Start the mood's generative canvas scene on this layer. */
  #useScene(layer, mood) {
    layer.canvas.style.display = 'block';
    layer.scene = createScene(layer.canvas, mood);
    layer.scene.start();
  }

  /* Stop and reset a layer so it holds no running loop or playing video. */
  #teardown(layer) {
    clearTimeout(layer._videoGuard);
    if (layer.scene) { layer.scene.stop(); layer.scene = null; }
    if (layer.video_active) { layer.video.pause(); layer.video_active = false; }
    layer.canvas.style.display = 'none';
  }
}

/* Helper: build a <source> element for the video. */
function source(src, type) {
  const s = document.createElement('source');
  s.src = src; s.type = type;
  return s;
}
