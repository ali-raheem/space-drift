# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Space Drift: an endless procedurally generated flight through space (planets, stars, black holes, nebulae, asteroids, comets, pulsars, warp jumps, wormholes), shipped as an offline PWA and meant to double as a screensaver. There is no build step and there are no dependencies. The code is plain ES modules loaded straight from `index.html`. It's a sibling of `../RSB` and shares its HUD and control conventions.

(The parent `../CLAUDE.md` describes an unrelated Rust/Fallout project. Ignore it here.)

## Commands

```bash
npm test                                   # node --test tests/*.test.mjs
node --test tests/sw.test.mjs              # single file
npm run serve                              # python3 -m http.server 8080
npm run bump                               # bump js/version.js + package.json (-- minor|major)
npm run icons                              # regenerate icons/*.png (Pillow)
```

## Architecture

- `js/rng.js`: seeded mulberry32 `Rng`, 3D value noise (`makeNoise` → `noise3`, `fbm3`) and name generators. No DOM.
- `js/textures.js`: procedural sprites. The per-pixel ones (`planetJob`, `starSurfaceJob`, `diskJob`, `skyJob`) are **generator functions that yield every few rows**. Cheaper ones (rings, puffs, galaxies, rocks) are synchronous.
- `js/scene.js`: the `Journey` class. The camera is fixed at the origin looking +z, and everything moves towards it at `speed`. The projection is `screen = world / z * f`, and the whole world layer is rotated by a slow `roll`.
  - `Field`: recycled point fields (stars, near-camera dust). These are advanced in `drawField` using `lastDt`, not in `update`.
  - `bodies`: plain objects with a `type` that are drawn far to near. Bodies with `occluder` hide the stars behind them. Black holes and wormholes push entries into `lenses`, which displace the stars behind them (`r' = r + θE²/r`).
  - The director, `nextEvent()`, picks from `EVENT_WEIGHTS` once `time >= nextEventAt` and only in the `cruise` phase. The phases are `cruise` → `warp` (a speed ramp; the sector switches mid-blur) and `cruise` → `tunnel` (entered when the wormhole mouth fills the screen; the sector switches just before the exit flash).
  - Sectors (palette, light direction, sky, puff/rock sprites) are made by `makeSector()`. The next sector is always prepared in the background, so a jump never stalls. `switchSector()` finishes its job synchronously if it isn't ready yet.
  - Background jobs: `addJob(gen, done)` and `runJobs()` (5 ms budget per frame). `finishJob()` forces completion.
  - `adapt()` lowers `dprCap` when frames are consistently slow.
- `js/audio.js`: `Soundtrack`, the live Web Audio ambient score. It has pad chords plus chimes in a key derived from `sector.hueA` (`setSector`, hooked up through `journey.onSector`), wind and filter that follow `journey.speed`/`phase`, a rumble as black holes get close, and an arrival swell. It starts only after the first user gesture (`unlock()`), and pausing or hiding the tab fades it out and suspends the context. It may use `Math.random`, because the music is cosmetic.
- `js/settings.js`: the persisted preferences (speed, captions, keep awake, sound, volume). Storage is injectable so it can be tested.
- `js/app.js`: rAF loop, HUD and captions, keyboard/buttons, `#seed=` hash, idle fade plus a hidden cursor, swallowing the click that wakes the HUD, wake lock, install prompt and service worker registration.

### Randomness

`this.rng` (seeded) drives the director and all content, so a seed reproduces the sequence of sectors and encounters. `this.fx` is a separate cosmetic stream for star/dust respawns. Timing depends on the frame rate, so replays aren't frame-exact. Don't use `Math.random` in `scene.js` or `textures.js`.

## Neighbourliness invariants (important)

Other apps share the origin (deployed alongside RSB etc.). `tests/sw.test.mjs` and `tests/core.test.mjs` enforce these:

- `manifest.webmanifest` `id` is pinned to `/space-drift/`. Never change it once released.
- `sw.js` cache names are `space-drift:<scope path>:<version>`. Activation deletes only caches with that exact prefix. Fetch handles only URLs in its own `ASSETS` and reads only via `caches.open(CACHE_NAME)`. Never use `caches.match()`.
- localStorage holds only `storageKey(location.pathname)` = `space-drift:<dir>:settings`.

## Conventions and gotchas

- **Adding or renaming a file:** add it to `ASSETS` in `sw.js` (`tests/assets.test.mjs` fails otherwise), then `npm run bump`.
- **Icons in the UI:** use the inline SVG sprite at the top of `index.html` (`<symbol id="i-…">`). Don't use emoji.
- **Body `alpha` is overwritten every frame** by the distance fade in `drawWorld`. Use a different property for per-body opacity (puffs use `opacity`).
- **Reduced motion** (`journey.reducedMotion`): gentler warp speed, less sway, slower pulsar and wormhole spin, and a black exit fade instead of a white flash. Keep new effects consistent with this.
- **Pacing knobs:** `CRUISE`, `WARP`, `BODY_FAR`, `EVENT_WEIGHTS`, and the gaps in `nextEvent()`.
- **Visual checks:** there's no screenshot test. Drive it with Playwright, or call `journey.nextEvent('<kind>')` and step `update()` in a page that imports `scene.js`.

## Deployment

Live at https://shoryuken.me/space/ (nginx web root `/var/www/shoryuken.me/space/` on `root@185.163.204.17`; see `/var/www/shoryuken.me/CLAUDE.md` there for the server's conventions). After `npm test` and `npm run bump`:

```bash
rsync -a --delete --chmod=D755,F644 index.html manifest.webmanifest sw.js css js icons root@185.163.204.17:/var/www/shoryuken.me/space/
```

Cloudflare sits in front and sets `Cache-Control: max-age=14400` on JS/CSS/images, overriding nginx's `no-cache`. So the service worker installs with `cache: 'reload'` and fetches its own files with `cache: 'no-cache'` (a cheap ETag revalidation). Keep both, or returning visitors can run stale code for up to 4 h after a deploy. Browsers always re-check `sw.js` itself.

Mirror at http://ali.sdf-eu.org/space/ (SDF-EU, NetBSD + Apache; `~/html` is the web root). It's HTTP only, because the TLS cert covers only `sdfeu.org`. So the service worker, PWA install, wake lock and clipboard don't work there, but the journey and the sound do. `~/html` also holds unrelated files, so keep the deploy inside `space/`:

```bash
rsync -a --delete --chmod=D755,F644 index.html manifest.webmanifest sw.js css js icons ali@sdf-eu.org:html/space/
```
