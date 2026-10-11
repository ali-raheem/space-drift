# Space Drift

[![CI](https://github.com/ali-raheem/space-drift/actions/workflows/ci.yml/badge.svg)](https://github.com/ali-raheem/space-drift/actions/workflows/ci.yml) [![GitHub Pages](https://github.com/ali-raheem/space-drift/actions/workflows/pages.yml/badge.svg)](https://github.com/ali-raheem/space-drift/actions/workflows/pages.yml)

**▶ Try it live: [shoryuken.me/space](https://shoryuken.me/space/)** · mirror on [GitHub Pages](https://ali-raheem.github.io/space-drift/) · installable, works offline

<p align="center">
  <a href="https://shoryuken.me/space/"><img src="docs/screenshots/desktop.webp" alt="Space Drift on a desktop browser" width="74%"></a>
  <a href="https://shoryuken.me/space/"><img src="docs/screenshots/mobile.webp" alt="Space Drift on a phone" width="22%"></a>
</p>

An endless, hands-off journey through procedurally generated space. You cruise
past planets with moons and rings, stars and binary pairs, black holes with lensed
accretion disks, nebulae, asteroid fields, comets and pulsars. Every so often the
ship jumps to warp or dives through a wormhole into a new sector with its own sky.

A synthesised ambient soundtrack plays along. Each sector has its own key and
mode, and the music glides into the new key when you arrive. Wind rises with warp
and the wormhole tunnel, and a low rumble grows as a black hole comes close.

Go fullscreen and leave it running as a screensaver.

There is no build step, there are no dependencies and nothing is fetched from the
network. It's plain HTML/CSS/JS modules plus a service worker, so it installs as a
PWA and works offline.

## Run it

```bash
python3 -m http.server 8080   # or: npm run serve
```

Open `http://localhost:8080/`. It has to be served over HTTP (not `file://`).

## Controls

| Key | Action |
|---|---|
| Space | Pause / resume |
| `+` / `-` | Cruising speed (¼× – 4×, remembered) |
| `W` | Warp now |
| `N` | Skip to the next encounter |
| `C` | Captions on/off (remembered) |
| `M` | Soundtrack on/off (remembered; volume is in settings) |
| `F` / double-click | Fullscreen |
| `H` | Hide the interface (tap to bring it back) |
| `S` | Settings: install, sound and volume, captions, keep awake, new journey, copy link, version |
| `Esc` | Close settings |

The controls and the mouse cursor fade after a few idle seconds. While the tab is
visible it holds a screen wake lock, which you can turn off in settings. With
`prefers-reduced-motion`, warp is slower, the camera sways less and the wormhole
exit fades through black instead of flashing.

Each journey comes from a seed kept in the URL (`#seed=00c0ffee`), and the same
seed gives the same sequence of sectors and encounters. Use *Copy link to this
journey* in settings to share one.

## Sharing an origin with other apps

The app is designed to sit next to other apps on the same domain, e.g.
`example.com/rsb/` and `example.com/space/`:

- **Manifest id** is pinned to `/space-drift/`, so it doesn't depend on
  `start_url` and won't collide with another app. Never change it after release,
  or existing installs will turn into a separate, duplicate app.
- **Service worker** is registered with scope `./` and handles requests only for
  its own listed files. Its cache names are `space-drift:<path>:<version>`. On
  update it deletes only its own older caches, and it never calls
  `caches.match()`, which would search other apps' caches.
- **localStorage** holds a single key, `space-drift:<path>:settings`, with a few
  preferences. Nothing else is read or written.

`tests/sw.test.mjs` runs `sw.js` against fake Cache Storage to check all of this.

## Deploying

Copy these to any static host, in any subdirectory:

```
index.html  manifest.webmanifest  sw.js  css/  js/  icons/
```

Run `npm run bump` before each release. The service worker cache is keyed on the
version, so this makes installed copies pick up the new files.

## Development

```bash
npm test           # node --test tests/*.test.mjs
npm run bump       # bump js/version.js (+ package.json); `-- minor` / `-- major`
npm run icons      # regenerate PNG icons (needs Pillow); icons/icon.svg is hand-written
```
