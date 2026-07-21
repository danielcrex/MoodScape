# Assets

MoodScape runs beautifully with **no files here** — every mood renders a
procedural canvas scene and every ambient sound is synthesized in the browser.

Adding real footage is an optional upgrade.

## Adding a background video for a mood

1. Drop the files in `assets/video/` (and an optional poster image in `assets/img/`).
   For best performance provide **both** a WebM and an MP4:

   ```
   assets/video/relax.webm
   assets/video/relax.mp4
   assets/img/relax.jpg      (optional poster shown while it buffers)
   ```

2. Point the mood at them in `js/moods.js` by un-commenting its `video` block:

   ```js
   video: { webm: 'assets/video/relax.webm', mp4: 'assets/video/relax.mp4', poster: 'assets/img/relax.jpg' },
   ```

That's it. The background manager prefers the video, shows the poster + a loading
shimmer while it buffers, and **falls back to the procedural scene automatically**
if the files are missing or fail to load — so a missing asset never breaks the app.

### Encoding tips for smooth looping backgrounds
- Keep clips short (10–20s) and seamless; the player loops them.
- Target ~1080p and a modest bitrate (2–4 Mbps) — these are ambient, not cinema.
- WebM (VP9) is smaller; MP4 (H.264) is the universal fallback.
- Silence the video's own track if you only want the synthesized ambience.

### Where to find free, licensable nature footage
Pexels, Pixabay, and Coverr all offer free stock clips. Check each clip's
licence before shipping it in your repo.
