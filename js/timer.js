/* ===========================================================================
   timer.js — the minimalist focus / relaxation timer (top-right)
   ---------------------------------------------------------------------------
   Counts DOWN from a chosen duration. The display uses the design system's
   tabular figures (the .num class) so the digits never jitter as they change.
   Because the timer is part of the app root that enters fullscreen, it keeps
   running and stays visible in fullscreen automatically.

   Timing is derived from timestamps (not by decrementing a counter each tick),
   so it stays accurate even if the tab is throttled in the background.
   =========================================================================== */

export class Timer {
  constructor(displayEl, { onComplete } = {}) {
    this.display = displayEl;
    this.onComplete = onComplete || (() => {});
    this.duration = 15 * 60;    // seconds; default 15 minutes
    this.remaining = this.duration;
    this.endAt = 0;             // wall-clock time (ms) the timer will hit zero
    this.ticker = 0;
    this.running = false;
    this.render();
  }

  /* Choose a focus length (seconds). Resets the countdown. */
  setDuration(seconds) {
    this.duration = seconds;
    this.reset();
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Anchor the finish time so we can recompute remaining from "now".
    this.endAt = Date.now() + this.remaining * 1000;
    this.ticker = setInterval(() => this.tick(), 250);
    this.render();
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.ticker);
    this.remaining = Math.max(0, Math.round((this.endAt - Date.now()) / 1000));
    this.render();
  }

  toggle() { this.running ? this.pause() : this.start(); }

  reset() {
    clearInterval(this.ticker);
    this.running = false;
    this.remaining = this.duration;
    this.render();
  }

  tick() {
    this.remaining = Math.max(0, Math.round((this.endAt - Date.now()) / 1000));
    this.render();
    if (this.remaining <= 0) {
      clearInterval(this.ticker);
      this.running = false;
      this.onComplete();       // app plays a soft chime + flashes the display
      this.remaining = this.duration; // ready to go again
    }
  }

  /* Paint mm:ss into the display element. */
  render() {
    const m = Math.floor(this.remaining / 60);
    const s = this.remaining % 60;
    this.display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    this.display.classList.toggle('is-running', this.running);
  }
}
