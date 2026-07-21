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
cloud bands…), a **synthesized ambient soundscape** (rain, wind, water, fire,
birds, chimes, drone, a lofi beat, plus waves, crickets, a singing bowl and water
drops) and a **synthesized music bed** (a melodic/harmonic pad whose mode, chord,
tempo and timbre are tuned per mood) — all generated live with the Web Audio API.
Nothing is downloaded, so the repo is tiny and there are no licensing worries.
Real looping videos are an optional drop-in upgrade (see `assets/README.md`); a
clearly-marked seam in `audio.js` lets you swap the synth music for real audio
files just as easily.

## Moods

Each mood mixes a handful of ambient layers **and** its own music bed. Every
active layer gets its own slider in the mixer; the music bed has a separate
on/off switch and volume.

| Mood | Scene | Ambient layers | Music bed |
|------|-------|----------------|-----------|
| Relax | golden-hour light motes over swaying grass | wind · birdsong · crickets | warm major pentatonic |
| Melancholy | rain over misty pines | rain · thunder · wind | slow minor pentatonic |
| Joyful | petals lifting in bright light | river · birdsong · water drops | bright major |
| Focused | glassy lake with slow ripples | wind · white noise · waves | sparse open fifths |
| Cozy | embers rising over firelight | fire · wind | warm major sevenths |
| Enchanted | pulsing fireflies in deep woods | chimes · drone · crickets | Lydian shimmer |
| Ethereal | aurora ribbons over stars | drone · waves · singing bowl | weightless whole-tone |
| Vibrant | fast time-lapse cloud bands | lofi beat · wind | upbeat major |

In **Melancholy**, a soft flash of lightning brightens the rain scene roughly
when the thunder swells. It is a gentle, brief luminance lift (never a strobe)
and is switched off entirely when the OS `prefers-reduced-motion` setting is on.

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
- **Sound toggle** — a speaker switch in the header (with a state-reflecting
  volume/mute glyph) resumes audio on first use.
- **Ambient mixer** — a floating card; blend the master level and each active
  layer (add more rain, more birds…). Volumes are per-mood. A distinct **Music**
  block at the top switches the mood's melodic bed on/off and sets its volume;
  turning music on also turns the master sound on so it's audible.
- **Mindfulness prompt** — mood-matched affirmations that cycle; tap for the next.
- **Focus timer** — top-right, tabular figures, selectable length (5/15/25/45),
  stays visible and running in fullscreen.
- **Fullscreen** — the whole HUD expands; after a few idle seconds the chrome
  fades so only the scene remains.
- **Graceful video fallback** — missing/slow footage falls back to the scene.
- **Efficient audio** — idle sound layers (and the music bed) are torn down when
  a mood is left, so oscillators and schedulers don't pile up over a long session.
- **Accessible** — visible (mood-tinted) focus rings, ARIA labels that update
  with state, an `aria-live` prompt, and a fully honoured `prefers-reduced-motion`
  (scenes hold a single calm frame, and the Melancholy lightning is suppressed).

## Project structure

```
index.html            markup, HUD, inline SVG icon sprite
css/styles.css        design tokens + immersive glass HUD (responsive)
js/
  moods.js            the mood manifest — one place to tune everything
  scenes.js           procedural canvas scenes (the visual signature)
  background.js        crossfading layers: video-or-scene + colour grade
  audio.js            Web Audio engine: ambient layers + per-mood music + teardown
  theme.js            derives the mood-tinted HUD palette (legible-by-luminance)
  timer.js            focus/relaxation timer (tabular figures)
  prompts.js          the affirmation cycler
  fullscreen.js       cross-browser fullscreen helper
  app.js              the conductor — wires it all together
assets/               optional real videos/posters (see assets/README.md)
```

## Notes on the design-system fit

MoodScape started from "Daniele's Touch" (*pure white, depth from shadow, one
Cobalt accent*), keeping its borders, shadows, radii, type scale and tabular
figures. But strict white-glass-plus-Cobalt chrome reads as UI sitting **on top
of** the scene rather than part of it. So this app deliberately relaxes that one
rule and **tints the whole HUD toward each mood**: the frosted panels, borders,
active tab, primary button, slider fills and focus ring all take a colour derived
from the mood's tint (see `theme.js`), while everything else about the system
stays intact.

The hard constraint is legibility. `theme.js` never hard-codes text colour — it
**measures** each surface's luminance/contrast and picks the ink accordingly:
accents get black or white text depending on the hue (warm gold accents take dark
ink, cool ones take white), and the panel ink flips as a set if a panel were ever
dark. Blending is never allowed to cost readability.
