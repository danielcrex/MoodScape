/* ===========================================================================
   app.js — the conductor
   ---------------------------------------------------------------------------
   Wires the modules together: builds the mood tabs and mixer, orchestrates a
   mood change (scene + colour + audio + affirmation all at once), and handles
   the timer, fullscreen, sound toggle, keyboard shortcuts, and idle immersion.
   =========================================================================== */

import { MOODS, getMood } from './moods.js';
import { Background } from './background.js';
import { AudioEngine } from './audio.js';
import { Timer } from './timer.js';
import { Prompts } from './prompts.js';
import { Fullscreen } from './fullscreen.js';
import { applyMoodTheme } from './theme.js';

/* Human-readable names for the synth layers (used as mixer row labels). */
const LAYER_LABEL = {
  rain: 'Rain', wind: 'Wind', water: 'River', noise: 'White noise', fire: 'Fire',
  thunder: 'Thunder', birds: 'Birdsong', chimes: 'Chimes', drone: 'Drone', beat: 'Lofi beat',
  waves: 'Waves', crickets: 'Crickets', bowl: 'Singing bowl', bubbles: 'Water drops',
};

/* Small helpers for reading/writing the last-used mood, guarded so a locked-down
   browser (no storage) still runs fine. */
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

/* Grab all the elements app.js drives. */
const el = {
  root: document.getElementById('app'),
  bg: document.getElementById('bg'),
  nav: document.getElementById('moodNav'),
  soundToggle: document.getElementById('soundToggle'),
  soundIcon: document.getElementById('soundIcon'),
  soundLabel: document.getElementById('soundLabel'),
  mixerBtn: document.getElementById('mixerBtn'),
  mixerCard: document.getElementById('mixerCard'),
  mixerBody: document.getElementById('mixerBody'),
  mixerClose: document.getElementById('mixerClose'),
  fsBtn: document.getElementById('fsBtn'),
  timerCard: document.getElementById('timerCard'),
  timerDisplay: document.getElementById('timerDisplay'),
  timerDurations: document.getElementById('timerDurations'),
  timerToggle: document.getElementById('timerToggle'),
  timerReset: document.getElementById('timerReset'),
  prompt: document.getElementById('prompt'),
};

/* Instantiate the engines. */
const background = new Background(el.bg);
const audio = new AudioEngine();
const prompts = new Prompts(el.prompt);
const timer = new Timer(el.timerDisplay, {
  onComplete: () => {
    audio.ding();                                    // soft bell if sound is on
    el.timerCard.classList.remove('timer--pinned');
    setTimerButton(false);
  },
});

let currentMood = null;

/* ---------------------------------------------------------------------------
   MOOD TABS
   Build one tab per mood from the manifest, with its icon and label.
   --------------------------------------------------------------------------- */
MOODS.forEach((mood, i) => {
  const tab = document.createElement('button');
  tab.className = 'mood-tab';
  tab.dataset.id = mood.id;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', 'false');
  tab.title = `${mood.label}  ·  ${i + 1}`;
  tab.innerHTML = `<svg class="icon"><use href="#icon-${mood.icon}"/></svg><span>${mood.label}</span>`;
  tab.addEventListener('click', () => selectMood(mood.id));
  el.nav.appendChild(tab);
});
el.nav.setAttribute('role', 'tablist');

/* ---------------------------------------------------------------------------
   SELECT A MOOD — the one orchestrated moment: scene, colour, sound, words.
   --------------------------------------------------------------------------- */
function selectMood(id) {
  const mood = getMood(id);
  if (!mood) return;
  currentMood = mood;

  // Mark the active tab and keep it scrolled into view.
  el.nav.querySelectorAll('.mood-tab').forEach((t) =>
    t.setAttribute('aria-selected', String(t.dataset.id === id)));
  el.nav.querySelector('[aria-selected="true"]')
    ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });

  // Tint the whole HUD toward this mood (panels, accent, sliders, focus ring),
  // deriving legible text ink from the tint's luminance. See theme.js.
  applyMoodTheme(mood);

  background.show(mood);       // crossfade the backdrop + grade
  applyAudioForMood(mood);     // ramp the ambient mix
  audio.setMusicMood(mood);    // rebuild the music bed for this mood (if music is on)
  prompts.setMood(mood);       // swap affirmations
  buildMixer(mood);            // rebuild the mixer rows for this mood's layers

  store.set('moodscape:mood', id);
}

/* Apply a mood's audio mix. Called on select and when sound is first enabled
   (so layers are built once the AudioContext exists). */
function applyAudioForMood(mood) {
  audio.setMoodMix(mood);
}

/* ---------------------------------------------------------------------------
   AMBIENT MIXER
   A master slider plus one slider per active layer in the current mood.
   --------------------------------------------------------------------------- */
function buildMixer(mood) {
  el.mixerBody.innerHTML = '';
  el.mixerBody.appendChild(musicBlock());            // the mood's melodic bed (distinct)
  el.mixerBody.appendChild(mixRow('master', 'Master', audio.masterLevel, 'mix-row--master'));
  Object.keys(mood.audio).forEach((name) => {
    el.mixerBody.appendChild(mixRow(name, LAYER_LABEL[name] || name, audio.getLayer(name)));
  });
}

/* The Music block: visually distinct from the ambient sliders (its own card
   with an on/off switch and a volume slider). The switch is a real gesture, so
   it resumes audio; enabling music also turns the master sound on so it's
   actually audible. Rebuilt with the mixer, so it reflects live engine state. */
function musicBlock() {
  const on = audio.isMusicOn();
  const block = document.createElement('div');
  block.className = `mix-music${on ? ' is-on' : ''}`;

  const head = document.createElement('div');
  head.className = 'mix-music__head';
  head.innerHTML =
    `<span class="mix-music__title"><svg class="icon"><use href="#icon-music"/></svg>Music</span>`;

  // On/off switch (reuses the design-system toggle styling, in a small size).
  const toggle = document.createElement('label');
  toggle.className = 'toggle toggle--sm';
  toggle.title = 'Music bed';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = on;
  cb.setAttribute('aria-label', on ? 'Music on' : 'Music off');
  const track = document.createElement('span'); track.className = 'track';
  const thumb = document.createElement('span'); thumb.className = 'thumb';
  toggle.append(cb, track, thumb);
  head.appendChild(toggle);

  // Volume slider (dimmed when music is off).
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0'; range.max = '1'; range.step = '0.01';
  range.value = String(audio.getMusicLevel());
  range.setAttribute('aria-label', 'Music volume');
  const paint = () => range.style.setProperty('--val', `${range.value * 100}%`);
  paint();

  cb.addEventListener('change', () => {
    const wantOn = cb.checked;
    if (wantOn) enableSound(true);        // music needs the master on to be heard
    audio.setMusicEnabled(wantOn);
    cb.setAttribute('aria-label', wantOn ? 'Music on' : 'Music off');
    block.classList.toggle('is-on', wantOn);
  });
  range.addEventListener('input', () => {
    audio.setMusicLevel(parseFloat(range.value));
    paint();
  });

  block.append(head, range);
  return block;
}

/* Build one labelled slider row. `key` is 'master' or a layer name. */
function mixRow(key, label, value, extraClass = '') {
  const row = document.createElement('div');
  row.className = `mix-row ${extraClass}`;

  const top = document.createElement('div');
  top.className = 'mix-row__top';
  top.innerHTML = `<span class="mix-row__name">${label}</span><span class="mix-row__val num">${Math.round(value * 100)}</span>`;

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0'; range.max = '1'; range.step = '0.01'; range.value = String(value);
  range.setAttribute('aria-label', `${label} volume`);
  const paint = () => range.style.setProperty('--val', `${range.value * 100}%`);
  paint();

  range.addEventListener('input', () => {
    const v = parseFloat(range.value);
    top.querySelector('.mix-row__val').textContent = Math.round(v * 100);
    paint();
    if (key === 'master') audio.setMasterLevel(v);
    else audio.setLayer(key, v);
  });

  row.append(top, range);
  return row;
}

/* ---------------------------------------------------------------------------
   SOUND ON / OFF
   Browsers block audio until a gesture, so the first enable both resumes the
   context and (re)applies the current mix so its layers get built.
   --------------------------------------------------------------------------- */
function enableSound(on) {
  audio.setEnabled(on);
  el.soundToggle.checked = on;
  // Reflect state in the speaker glyph + accessible label (which names the switch).
  el.soundIcon.querySelector('use').setAttribute('href', on ? '#icon-volume' : '#icon-mute');
  el.soundLabel.textContent = on ? 'Ambient sound on' : 'Ambient sound off';
  if (on && currentMood) applyAudioForMood(currentMood);
}
el.soundToggle.addEventListener('change', () => enableSound(el.soundToggle.checked));

/* ---------------------------------------------------------------------------
   MIXER PANEL open/close
   --------------------------------------------------------------------------- */
function toggleMixer(force) {
  const open = force ?? el.mixerCard.hidden;
  el.mixerCard.hidden = !open;
  el.mixerBtn.setAttribute('aria-pressed', String(open));
}
el.mixerBtn.addEventListener('click', () => toggleMixer());
el.mixerClose.addEventListener('click', () => toggleMixer(false));

/* ---------------------------------------------------------------------------
   TIMER controls
   --------------------------------------------------------------------------- */
function setTimerButton(running) {
  const use = el.timerToggle.querySelector('use');
  const label = el.timerToggle.querySelector('span');
  use.setAttribute('href', running ? '#icon-pause' : '#icon-play');
  label.textContent = running ? 'Pause' : 'Start';
}

el.timerDurations.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  el.timerDurations.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
  timer.setDuration(parseInt(btn.dataset.min, 10) * 60);
  setTimerButton(false);
  el.timerCard.classList.remove('timer--pinned');
});

el.timerToggle.addEventListener('click', () => {
  timer.toggle();
  setTimerButton(timer.running);
  // Keep the timer visible in immersive fullscreen while it's running.
  el.timerCard.classList.toggle('timer--pinned', timer.running);
});

el.timerReset.addEventListener('click', () => {
  timer.reset();
  setTimerButton(false);
  el.timerCard.classList.remove('timer--pinned');
});

/* ---------------------------------------------------------------------------
   FULLSCREEN
   --------------------------------------------------------------------------- */
el.fsBtn.addEventListener('click', () => Fullscreen.toggle(el.root));
Fullscreen.onChange(() => {
  const active = Fullscreen.active();
  el.fsBtn.querySelector('use').setAttribute('href', active ? '#icon-compress' : '#icon-expand');
  el.fsBtn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  if (!active) wake();                          // always show chrome when leaving FS
});

/* ---------------------------------------------------------------------------
   IDLE IMMERSION
   In fullscreen, hide the HUD after a few seconds of no input; any movement or
   keypress brings it back.
   --------------------------------------------------------------------------- */
let idleTimer = 0;
function wake() {
  el.root.classList.remove('is-immersed');
  clearTimeout(idleTimer);
  if (Fullscreen.active()) {
    idleTimer = setTimeout(() => el.root.classList.add('is-immersed'), 3000);
  }
}
['mousemove', 'pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, wake, { passive: true }));

/* ---------------------------------------------------------------------------
   KEYBOARD SHORTCUTS
     F        toggle fullscreen        Space   start / pause timer
     M        mute / unmute            1–8     jump to a mood
     ← / →    previous / next mood     Esc     close the mixer
   --------------------------------------------------------------------------- */
const isField = (t) => /INPUT|TEXTAREA|SELECT/.test(t.tagName);
window.addEventListener('keydown', (e) => {
  if (isField(e.target)) return;                 // don't hijack typing in fields
  const idx = MOODS.findIndex((m) => m.id === currentMood?.id);

  switch (e.key.toLowerCase()) {
    case 'f':
      Fullscreen.toggle(el.root); break;
    case 'm':
      enableSound(!audio.enabled); break;
    case 'arrowright':
      selectMood(MOODS[(idx + 1) % MOODS.length].id); break;
    case 'arrowleft':
      selectMood(MOODS[(idx - 1 + MOODS.length) % MOODS.length].id); break;
    case 'escape':
      if (!el.mixerCard.hidden) toggleMixer(false); break;
    case ' ':
      // Only when the focus isn't a button, so Space still clicks buttons.
      if (e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        timer.toggle();
        setTimerButton(timer.running);
        el.timerCard.classList.toggle('timer--pinned', timer.running);
      }
      break;
    default:
      // Number keys 1–8 select the matching mood.
      if (/^[1-9]$/.test(e.key)) {
        const m = MOODS[parseInt(e.key, 10) - 1];
        if (m) selectMood(m.id);
      }
  }
});

/* ---------------------------------------------------------------------------
   BOOT
   Start on the last-used mood (or the first), and invite the user to add sound.
   --------------------------------------------------------------------------- */
const startId = store.get('moodscape:mood') && getMood(store.get('moodscape:mood'))
  ? store.get('moodscape:mood')
  : MOODS[0].id;
selectMood(startId);
