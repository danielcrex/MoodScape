/* ===========================================================================
   theme.js — derive a mood-tinted UI palette from one tint colour
   ---------------------------------------------------------------------------
   MoodScape used to be strict "white glass + one Cobalt accent". That reads as
   white-and-blue chrome sitting ON TOP of the scene. Instead we now tint the
   whole HUD toward each mood so the chrome feels part of the atmosphere.

   Everything is derived from the mood's `tint` (moods.js). The HARD RULE is
   legibility: we never hard-code text colour, we CHOOSE it from the measured
   luminance / contrast of the surface it sits on, so it stays readable on every
   mood — even if a future tint were very light or very dark.

   applyMoodTheme(mood) writes a family of CSS custom properties that styles.css
   consumes:
     --mood                brand-mark whisper (the raw tint)
     --mood-strong         solid accent fill (active tab, primary button, …)
     --mood-strong-ink     text/icon colour that is legible ON --mood-strong
     --mood-strong-shadow  a soft coloured glow for the accent
     --mood-text           a darker accent used as COLOURED TEXT on light panels
     --panel               frosted panel background (white nudged toward tint)
     --panel-border        panel hairline (more tint)
     --panel-ink[-2/-3]    panel text hierarchy, flipped as a set if panel is dark
     --panel-chip          neutral control fill on the panel (chips, slider track)
   =========================================================================== */

/* ---- tiny sRGB colour helpers ------------------------------------------- */

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0; const l = (max + min) / 2;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}

/* Compact HSL→RGB (CSS Color 4 formula); h,s,l are 0–1. */
function hslToRgb({ h, s, l }) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/* WCAG relative luminance, 0 (black) … 1 (white). */
function luminance({ r, g, b }) {
  const c = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/* WCAG contrast ratio between two luminances. */
const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });

const css = ({ r, g, b }, a) =>
  a == null ? `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
            : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

const WHITE = { r: 255, g: 255, b: 255 };
const DARK_INK = '#0E1116';

/* Pick the more readable of black/white text for a given background. */
function inkFor(bg) {
  const L = luminance(bg);
  return contrast(L, 1) >= contrast(L, 0.006) ? '#FFFFFF' : DARK_INK; // 0.006 ≈ #0E1116
}

/* Darken a hue (drop HSL lightness) until it contrasts ≥ `ratio` against white,
   so it is safe to use as coloured TEXT on a near-white panel. */
function textToneOnLight(hsl, ratio) {
  let l = Math.min(hsl.l, 0.42);
  let rgb = hslToRgb({ h: hsl.h, s: hsl.s, l });
  while (l > 0.08 && contrast(luminance(rgb), 1) < ratio) {
    l -= 0.03;
    rgb = hslToRgb({ h: hsl.h, s: hsl.s, l });
  }
  return rgb;
}

export function applyMoodTheme(mood) {
  const root = document.documentElement.style;
  const tint = hexToRgb(mood.tint);
  const hsl = rgbToHsl(tint);
  const sat = Math.min(1, Math.max(0.55, hsl.s)); // pastels get pushed so accents keep colour

  // Solid accent fill: a saturated mid-tone. Its ink adapts, so the fill itself
  // can stay vivid (amber, slate, teal, violet…) and still carry legible text.
  const strong = hslToRgb({ h: hsl.h, s: sat, l: 0.46 });

  // Coloured text on the light panel (running timer, master label): darker, so
  // it clears 4.5:1 on white even for perceptually-light hues like gold.
  const moodText = textToneOnLight({ h: hsl.h, s: sat, l: 0.4 }, 4.5);

  // Frosted panels: mostly white, nudged toward the tint. Kept light on purpose;
  // panel ink is still chosen from the measured luminance in case a tint is dark.
  const panel = mix(WHITE, tint, 0.18);
  const panelDark = luminance(panel) <= 0.42;

  root.setProperty('--mood', mood.tint);
  root.setProperty('--mood-strong', css(strong));
  root.setProperty('--mood-strong-ink', inkFor(strong));
  root.setProperty('--mood-strong-shadow', css(strong, 0.34));
  root.setProperty('--mood-text', css(moodText));

  root.setProperty('--panel', css(panel, 0.84));
  root.setProperty('--panel-border', css(mix(WHITE, tint, 0.5), 0.65));
  root.setProperty('--panel-ink',   panelDark ? '#FFFFFF' : '#0E1116');
  root.setProperty('--panel-ink-2', panelDark ? 'rgba(255,255,255,.82)' : '#4B525C');
  root.setProperty('--panel-ink-3', panelDark ? 'rgba(255,255,255,.66)' : '#858C97');
  root.setProperty('--panel-chip',  panelDark ? css(mix(WHITE, tint, 0.3), 0.18) : css(mix(WHITE, tint, 0.28)));
}
