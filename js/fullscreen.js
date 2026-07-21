/* ===========================================================================
   fullscreen.js — a tiny cross-browser wrapper around the Fullscreen API
   ---------------------------------------------------------------------------
   Safari still uses webkit-prefixed methods, so we probe for whichever exists.
   We put the whole app root into fullscreen (not just the video), so the nav,
   timer, mixer and prompt all expand together into the immersive view.
   =========================================================================== */

export const Fullscreen = {
  /* Is anything currently fullscreen? */
  active() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },

  /* Toggle fullscreen for the given element. Returns a promise where possible. */
  toggle(el) {
    if (this.active()) {
      return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    // Some browsers reject if not triggered by a user gesture — swallow quietly.
    return request ? request.call(el).catch(() => {}) : Promise.resolve();
  },

  /* Subscribe to enter/exit so the UI can update its button label + icon. */
  onChange(cb) {
    document.addEventListener('fullscreenchange', cb);
    document.addEventListener('webkitfullscreenchange', cb);
  },
};
