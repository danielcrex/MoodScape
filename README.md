# MoodScape

An immersive, single-page mood switcher. Pick a mood and the whole atmosphere
changes at once — a living backdrop, a subtle colour grade, a synthesized
ambient soundscape you can mix, and a matching affirmation — with a quiet focus
timer and a distraction-free fullscreen view.

Built with **vanilla HTML / CSS / JavaScript** (ES modules, no build step, no
dependencies) on the **"Daniele's Touch"** design system.

## The idea in one line

The video is the canvas; every piece of UI stays true to the design system as
**floating frosted-white glass** — hairline borders, layered shadows, one Cobalt
accent for the active state, tabular figures for the timer.

## Signature: it's alive with zero assets

Each mood ships a hand-written **procedural canvas scene** (drifting light motes,
rain over misty pines, rising embers, wandering fireflies, aurora ribbons, moving
cloud bands…) and a **synthesized ambient soundscape** (rain, wind, water, fire,
birds, chimes, drone, a lofi beat) generated live with the Web Audio API. Nothing
is downloaded, so the repo is tiny and there are no licensing worries. Real
looping videos are an optional drop-in upgrade (see `assets/README.md`).

## Moods

| Mood | Scene | Ambient layers |
|------|-------|----------------|
| Relax | golden-hour light motes over swaying grass | wind · birdsong |
| Melancholy | rain over misty pines | rain · thunder |
| Joyful | petals lifting in bright light | river · birdsong |
| Focused | glassy lake with slow ripples | wind · white noise |
| Cozy | embers rising over firelight | fire |
| Enchanted | pulsing fireflies in deep woods | chimes · drone |
| Ethereal | aurora ribbons over stars | drone |
| Vibrant | fast time-lapse cloud bands | lofi beat |

## Run it

ES modules need to be served over HTTP (not opened as a `file://` path).

```bash
# from the project root
python3 -m http.server 8000
# then open http://localhost:8000
```

Deploying to **GitHub Pages** works with no changes: push, then enable Pages on
the `main` branch (root).

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `F` | Toggle fullscreen |
| `Space` | Start / pause the timer |
| `M` | Mute / unmute ambient sound |
| `←` `→` | Previous / next mood |
| `1`–`8` | Jump straight to a mood |
| `Esc` | Close the mixer (or exit fullscreen) |

## Features

- **Mood tabs** — top on desktop, a floating bar at the bottom on mobile.
- **Ambient mixer** — a floating card; blend the master level and each layer
  (add more rain, more birds…). Volumes are per-mood.
- **Mindfulness prompt** — mood-matched affirmations that cycle; tap for the next.
- **Focus timer** — top-right, tabular figures, selectable length (5/15/25/45),
  stays visible and running in fullscreen.
- **Fullscreen** — the whole HUD expands; after a few idle seconds the chrome
  fades so only the scene remains.
- **Graceful video fallback** — missing/slow footage falls back to the scene.
- **Accessible** — visible focus rings, ARIA labels, `aria-live` prompt, and a
  fully honoured `prefers-reduced-motion` (scenes hold a single calm frame).

## Project structure

```
index.html            markup, HUD, inline SVG icon sprite
css/styles.css        design tokens + immersive glass HUD (responsive)
js/
  moods.js            the mood manifest — one place to tune everything
  scenes.js           procedural canvas scenes (the visual signature)
  background.js        crossfading layers: video-or-scene + colour grade
  audio.js            Web Audio ambient engine + mixer volumes
  timer.js            focus/relaxation timer (tabular figures)
  prompts.js          the affirmation cycler
  fullscreen.js       cross-browser fullscreen helper
  app.js              the conductor — wires it all together
assets/               optional real videos/posters (see assets/README.md)
```

## Notes on the design-system fit

"Daniele's Touch" specifies *pure white, depth from shadow, never coloured
panels*. A fullscreen video experience can't literally use a white page, so the
system is expressed through the chrome: translucent white glass panels that keep
the same borders, shadows, radius, type scale and single accent. Each mood's
colour lives in the **scene and grade**, not the UI — so the interface stays
disciplined while the atmosphere does the emoting.
