/* ===========================================================================
   prompts.js — the Mindfulness Prompt
   ---------------------------------------------------------------------------
   Slowly cycles through the current mood's affirmations, fading one line out
   before fading the next in. Tapping the line advances it immediately.
   Switching moods swaps in that mood's lines and restarts the cycle.
   =========================================================================== */

const CYCLE_MS = 9000; // how long each affirmation lingers before the next

export class Prompts {
  constructor(el) {
    this.el = el;
    this.lines = [];
    this.i = 0;
    this.timer = 0;
    // Advance on click/tap for people who want to move at their own pace.
    this.el.addEventListener('click', () => this.next());
  }

  /* Load a mood's affirmations and show the first one. */
  setMood(mood) {
    this.lines = mood.affirmations || [];
    this.i = 0;
    this.show(this.lines[0] || '');
    this.schedule();
  }

  schedule() {
    clearInterval(this.timer);
    if (this.lines.length > 1) this.timer = setInterval(() => this.next(), CYCLE_MS);
  }

  next() {
    if (this.lines.length === 0) return;
    this.i = (this.i + 1) % this.lines.length;
    this.show(this.lines[this.i]);
    this.schedule(); // reset the interval so a manual tap doesn't double-fire
  }

  /* Fade the current text out, swap it, fade it back in. The CSS class handles
     the transition; under reduced-motion the swap is effectively instant. */
  show(text) {
    this.el.classList.add('is-fading');
    setTimeout(() => {
      this.el.textContent = text;
      this.el.classList.remove('is-fading');
    }, 400);
  }
}
