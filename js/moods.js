/* ===========================================================================
   moods.js — the single source of truth for the whole app.
   ---------------------------------------------------------------------------
   Every other module (background, audio, prompts, nav) reads from this array,
   so adding or re-tuning a mood happens in exactly one place.

   Each mood object declares:
     id          unique key, used in the DOM and in state
     label       what the user sees on the nav tab
     icon        key into the inline SVG icon set (see index.html)
     scene       which procedural canvas scene to render as the live fallback
     grade       the subtle colour wash painted OVER the video/scene.
                 [topColor, bottomColor] — a vertical gradient, low alpha,
                 so it tints the atmosphere without hiding it.
     tint        a single accent colour the canvas scene uses for its particles.
                 It ALSO seeds the mood-tinted HUD palette (see theme.js).
     audio       { layerName: defaultGain } — which ambient synth layers this
                 mood mixes, and how loud each sits by default (0–1). These
                 become the per-layer sliders in the Ambient Mixer.
     music       parameters for this mood's synthesized MUSIC bed (see audio.js
                 #buildMusic). Data-driven so each mood gets its own mode/tempo:
                   root    base frequency in Hz (the tonal centre)
                   scale   semitone offsets used by the arpeggio (the "mode")
                   chord   semitone offsets held as a soft sustained pad
                   tempo   arpeggio notes per minute
                   wave    oscillator type for the arpeggio voices
                   padWave oscillator type for the pad (defaults to sine)
                   cutoff  low-pass on the music bus, keeps the bed soft (Hz)
                   gain    per-mood loudness trim so beds sit evenly (0–1)
                 EXTENSION POINT: to use a real recording instead, add a `src`
                 here and handle it in audio.js #buildMusic (seam documented there).
     affirmations  short, mood-matched lines the Mindfulness Prompt cycles through
     video       OPTIONAL. Drop real footage in /assets/video and point to it here;
                 the background manager prefers video and falls back to `scene`
                 automatically when the files are missing.
   =========================================================================== */

export const MOODS = [
  {
    id: 'relax',
    label: 'Relax',
    icon: 'sun',
    scene: 'motes',                                   // warm light motes drifting up
    grade: ['rgba(255,196,112,0.20)', 'rgba(180,120,40,0.34)'],
    tint: '#FFD79A',
    audio: { wind: 0.30, birds: 0.32, crickets: 0.14 }, // rustling grass + meadowlarks + evening insects
    music: { root: 196.00, scale: [0, 2, 4, 7, 9], chord: [0, 4, 7], tempo: 50, wave: 'triangle', cutoff: 1600, gain: 0.5 }, // warm major pentatonic
    affirmations: [
      'Let the light move slowly.',
      'There is nowhere you need to be.',
      'Breathe with the grass.',
      'The evening is unhurried, and so are you.',
      'Soften your shoulders. Stay a while.'
    ],
    // video: { webm: 'assets/video/relax.webm', mp4: 'assets/video/relax.mp4', poster: 'assets/img/relax.jpg' },
  },

  {
    id: 'melancholy',
    label: 'Melancholy',
    icon: 'rain',
    scene: 'rain',                                     // rain streaks over misty pines
    grade: ['rgba(120,140,168,0.22)', 'rgba(30,42,64,0.52)'],
    tint: '#AEC2DA',
    audio: { rain: 0.52, thunder: 0.26, wind: 0.18 }, // muffled rain + low thunder + cold wind
    music: { root: 220.00, scale: [0, 3, 5, 7, 10], chord: [0, 3, 7], tempo: 42, wave: 'sine', cutoff: 1200, gain: 0.5 }, // minor pentatonic, slow
    affirmations: [
      'Some days ask only that you stay.',
      'Grey is a colour worth resting in.',
      'Let the rain carry what you cannot.',
      'Feeling it is a way of moving through it.',
      'Quiet is not empty.'
    ],
  },

  {
    id: 'joyful',
    label: 'Joyful',
    icon: 'flower',
    scene: 'petals',                                   // petals lifting in bright light
    grade: ['rgba(255,224,150,0.18)', 'rgba(120,200,120,0.28)'],
    tint: '#FFF0B8',
    audio: { water: 0.34, birds: 0.46, bubbles: 0.22 }, // flowing river + active birdsong + playful drips
    music: { root: 261.63, scale: [0, 2, 4, 7, 9], chord: [0, 4, 7], tempo: 78, wave: 'triangle', cutoff: 2400, gain: 0.42 }, // bright major, livelier
    affirmations: [
      'Good things are already on their way.',
      'Let yourself take up the whole morning.',
      'Delight is allowed, no reason required.',
      'The field is open. So are you.',
      'Move like the light moves.'
    ],
  },

  {
    id: 'focused',
    label: 'Focused',
    icon: 'target',
    scene: 'ripples',                                  // still lake with slow ripple lines
    grade: ['rgba(150,178,190,0.16)', 'rgba(40,64,74,0.40)'],
    tint: '#CFE3E8',
    audio: { wind: 0.24, noise: 0.20, waves: 0.20 },  // high thin wind + white noise + faint lake lapping
    music: { root: 174.61, scale: [0, 2, 3, 5, 7], chord: [0, 7], tempo: 38, wave: 'sine', cutoff: 1400, gain: 0.4 }, // sparse, open fifths
    affirmations: [
      'One thing, fully.',
      'The lake is still. Let your mind match it.',
      'Begin. Momentum will meet you.',
      'Distraction passes. The work remains.',
      'Depth over speed.'
    ],
  },

  {
    id: 'cozy',
    label: 'Cozy',
    icon: 'flame',
    scene: 'embers',                                   // embers rising over warm flicker
    grade: ['rgba(255,150,70,0.20)', 'rgba(70,26,10,0.58)'],
    tint: '#FFB067',
    audio: { fire: 0.52, wind: 0.14 },                // crackling logs + faint draft outside
    music: { root: 196.00, scale: [0, 4, 7, 11], chord: [0, 4, 7, 11], tempo: 54, wave: 'triangle', cutoff: 1500, gain: 0.5 }, // warm major 7ths
    affirmations: [
      'You are warm, and that is enough.',
      'Let the fire keep watch.',
      'Nothing out there needs you right now.',
      'Settle in. The night is soft.',
      'Rest is not idleness.'
    ],
  },

  {
    id: 'enchanted',
    label: 'Enchanted',
    icon: 'sparkle',
    scene: 'fireflies',                                // pulsing fireflies in deep woods
    grade: ['rgba(80,170,150,0.18)', 'rgba(14,40,34,0.56)'],
    tint: '#9FF0C8',
    audio: { chimes: 0.36, drone: 0.20, crickets: 0.18 }, // gentle chimes + string pad + night insects
    music: { root: 261.63, scale: [0, 2, 4, 6, 9], chord: [0, 4, 7], tempo: 62, wave: 'sine', cutoff: 2200, gain: 0.44 }, // Lydian shimmer
    affirmations: [
      'Wonder is a way of paying attention.',
      'The woods keep their small magics for the patient.',
      'Follow the light, wherever it drifts.',
      'Ordinary things are stranger up close.',
      'Stay curious a moment longer.'
    ],
  },

  {
    id: 'ethereal',
    label: 'Ethereal',
    icon: 'wave',
    scene: 'aurora',                                   // slow aurora ribbons over stars
    grade: ['rgba(90,120,220,0.20)', 'rgba(10,14,40,0.62)'],
    tint: '#8FD0FF',
    audio: { drone: 0.42, waves: 0.16, bowl: 0.24 },  // resonant drone + distant swell + singing bowl
    music: { root: 220.00, scale: [0, 2, 4, 6, 8, 10], chord: [0, 4, 8], tempo: 34, wave: 'sine', cutoff: 1400, gain: 0.5 }, // whole-tone, weightless
    affirmations: [
      'You are a small part of something vast, and that is a comfort.',
      'Let your thoughts move like light across the sky.',
      'Nothing here is in a hurry.',
      'Look up. Widen.',
      'The quiet goes on for a long way.'
    ],
  },

  {
    id: 'vibrant',
    label: 'Vibrant',
    icon: 'bolt',
    scene: 'clouds',                                   // fast time-lapse cloud bands
    grade: ['rgba(255,150,120,0.18)', 'rgba(90,60,160,0.40)'],
    tint: '#FFC0A8',
    audio: { beat: 0.42, wind: 0.12 },                // upbeat lofi + air rushing past
    music: { root: 293.66, scale: [0, 2, 4, 7, 9], chord: [0, 4, 7], tempo: 96, wave: 'triangle', cutoff: 2600, gain: 0.38 }, // bright major, upbeat
    affirmations: [
      'The day has momentum. Ride it.',
      'Say yes to the next good idea.',
      'Energy is a decision.',
      'Move first. Think on the way.',
      'Today is worth showing up for.'
    ],
  },
];

/* Convenience lookup so callers can do getMood('cozy') without re-scanning. */
const byId = Object.fromEntries(MOODS.map((m) => [m.id, m]));
export const getMood = (id) => byId[id];
