// App wiring: render loop, HUD, controls, settings, wake lock and offline support.

import { Journey } from './scene.js';
import { Soundtrack } from './audio.js';
import { randomSeed } from './rng.js';
import { SPEEDS, storageKey, loadSettings, saveSettings } from './settings.js';
import { VERSION, BUILT } from './version.js';

const CAPTION_SECONDS = 7;

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), hud: $('hud'), caption: $('caption'), settings: $('settings'),
  pause: $('btn-pause'), speed: $('btn-speed'), warp: $('btn-warp'), next: $('btn-next'),
  fullBtn: $('btn-full'), settingsBtn: $('btn-settings'),
  install: $('set-install'), sound: $('set-sound'), soundHint: $('sound-hint'), volumeRow: $('set-volume'), volume: $('volume'),
  captions: $('set-captions'), awake: $('set-awake'), full: $('set-full'),
  hide: $('set-hide'), newJourney: $('set-new'), link: $('set-link'), seed: $('seed'), version: $('version'),
};

const useIcon = (button, name) => button.querySelector('use').setAttribute('href', `#i-${name}`);
const setSwitch = (row, on) => row.setAttribute('aria-checked', String(on));

const KEY = storageKey(location.pathname);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const settings = loadSettings(storage, KEY);
const persist = () => saveSettings(storage, KEY, settings);

const journey = new Journey(el.canvas);
const soundtrack = new Soundtrack();
soundtrack.enabled = settings.sound;
soundtrack.volume = settings.volume;
journey.onSector = (sector, arrived) => soundtrack.setSector(sector, arrived);
let paused = false;

// --- seed / URL ------------------------------------------------------------------

const hex = (seed) => seed.toString(16).padStart(8, '0');
function seedFromHash(hash = location.hash) {
  const m = hash.match(/seed=([0-9a-f]{1,8})/i);
  return m ? parseInt(m[1], 16) >>> 0 : null;
}
function begin(seed = randomSeed()) {
  history.replaceState(null, '', `#seed=${hex(seed)}`);
  el.seed.textContent = `seed ${hex(seed)}`;
  journey.start(seed);
}
const journeyUrl = () => `${location.origin}${location.pathname}#seed=${hex(journey.seed)}`;

// --- captions --------------------------------------------------------------------

let captionTimer = null;
journey.onCaption = ({ kicker, title, sub }) => {
  el.caption.querySelector('.kicker').textContent = kicker ?? '';
  el.caption.querySelector('.title').textContent = title ?? '';
  el.caption.querySelector('.sub').textContent = sub ?? '';
  el.caption.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => el.caption.classList.remove('show'), CAPTION_SECONDS * 1000);
};
// --- sound -----------------------------------------------------------------------

function renderSound() {
  setSwitch(el.sound, settings.sound);
  useIcon(el.sound, settings.sound ? 'sound' : 'sound-off');
  el.volumeRow.hidden = !settings.sound;
  el.volume.value = String(settings.volume);
  // Browsers block audio until the first click/tap/key on the page.
  el.soundHint.textContent = settings.sound && !soundtrack.running ? 'starts after your first click, tap or key press' : '';
}
function toggleSound() {
  settings.sound = !settings.sound;
  persist();
  soundtrack.setEnabled(settings.sound);
  renderSound();
}
el.sound.addEventListener('click', toggleSound);
el.volume.addEventListener('input', () => {
  settings.volume = Number(el.volume.value);
  soundtrack.setVolume(settings.volume);
});
el.volume.addEventListener('change', persist);
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, () => {
    soundtrack.unlock();
    setTimeout(renderSound, 200);
  }, { capture: true });
}

function renderCaptions() {
  el.caption.classList.toggle('off', !settings.captions);
  setSwitch(el.captions, settings.captions);
}
function toggleCaptions() {
  settings.captions = !settings.captions;
  persist();
  renderCaptions();
}

// --- loop ------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    journey.frame(dt);
    soundtrack.update(journey);
  }
  requestAnimationFrame(frame);
}

// --- controls --------------------------------------------------------------------

function setPaused(p) {
  paused = p;
  soundtrack.setPaused(p || document.visibilityState !== 'visible');
  useIcon(el.pause, paused ? 'play' : 'pause');
  el.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  el.pause.setAttribute('aria-pressed', String(paused));
}
function renderSpeed() {
  const s = SPEEDS[settings.speedIndex];
  journey.speedScale = s;
  el.speed.textContent = s < 1 ? `${s}×`.replace(/^0/, '') : `${s}×`;
}
function changeSpeed(delta) {
  settings.speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, settings.speedIndex + delta));
  persist();
  renderSpeed();
}
const cycleSpeed = () => changeSpeed(settings.speedIndex === SPEEDS.length - 1 ? -settings.speedIndex : 1);

function warpNow() {
  if (journey.phase !== 'cruise') return;
  if (!journey.nextEvent('warp')) {
    journey.onCaption({ kicker: 'Warp drive', title: 'Unavailable', sub: 'too close to a massive body' });
  }
  if (paused) setPaused(false);
}
function nextEncounter() {
  if (journey.phase !== 'cruise') return;
  journey.nextEvent();
  if (paused) setPaused(false);
}

function showSettings(open) {
  el.settings.hidden = !open;
  el.settingsBtn.setAttribute('aria-pressed', String(open));
}
const toggleSettings = () => showSettings(el.settings.hidden);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
function renderFullscreen() {
  const on = !!document.fullscreenElement;
  setSwitch(el.full, on);
  el.fullBtn.setAttribute('aria-pressed', String(on));
}
function setHudHidden(hidden) {
  el.hud.classList.toggle('hidden', hidden);
}

async function copyLink() {
  const target = el.seed;
  try {
    await navigator.clipboard.writeText(journeyUrl());
    target.textContent = 'link copied';
  } catch {
    target.textContent = 'copy failed';
  }
  setTimeout(() => (target.textContent = `seed ${hex(journey.seed)}`), 1400);
}

el.pause.addEventListener('click', () => setPaused(!paused));
el.speed.addEventListener('click', cycleSpeed);
el.warp.addEventListener('click', warpNow);
el.next.addEventListener('click', nextEncounter);
el.fullBtn.addEventListener('click', toggleFullscreen);
el.settingsBtn.addEventListener('click', toggleSettings);
el.captions.addEventListener('click', toggleCaptions);
el.awake.addEventListener('click', () => {
  settings.keepAwake = !settings.keepAwake;
  persist();
  setSwitch(el.awake, settings.keepAwake);
  syncWakeLock();
});
el.full.addEventListener('click', toggleFullscreen);
el.hide.addEventListener('click', () => {
  showSettings(false);
  setHudHidden(true);
});
el.newJourney.addEventListener('click', () => begin());
el.link.addEventListener('click', copyLink);
el.canvas.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('fullscreenchange', renderFullscreen);
// iPhone Safari has no element fullscreen; "Add to Home Screen" is the way there.
el.full.hidden = el.fullBtn.hidden = !document.documentElement.requestFullscreen;

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case ' ': setPaused(!paused); break;
    case '+': case '=': changeSpeed(1); break;
    case '-': case '_': changeSpeed(-1); break;
    case 'w': case 'W': warpNow(); break;
    case 'n': case 'N': nextEncounter(); break;
    case 'c': case 'C': toggleCaptions(); break;
    case 'm': case 'M': toggleSound(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 's': case 'S': toggleSettings(); break;
    case 'h': case 'H': setHudHidden(!el.hud.classList.contains('hidden')); break;
    case 'Escape': if (el.settings.hidden) return; showSettings(false); break;
    default: return;
  }
  e.preventDefault();
  wakeHud();
});

// Auto-hide the controls and cursor after a few idle seconds so it works as a
// screensaver. A tap while they're hidden only brings them back; it must not press
// the invisible button underneath, so the click that follows it is swallowed.
let idleTimer = null;
let swallowClick = false;
function wakeHud() {
  el.hud.classList.remove('idle');
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!el.settings.hidden) return;
    el.hud.classList.add('idle');
    document.body.classList.add('idle');
  }, 3500);
}
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wakeHud(); });
window.addEventListener('pointerdown', () => {
  swallowClick = el.hud.classList.contains('idle') || el.hud.classList.contains('hidden');
  setHudHidden(false);
  wakeHud();
}, { capture: true });
window.addEventListener('click', (e) => {
  if (swallowClick) {
    e.preventDefault();
    e.stopPropagation();
  }
  swallowClick = false;
}, { capture: true });

// --- install ---------------------------------------------------------------------

// Chromium hands us a deferred prompt; iOS Safari has no install API, so there the
// row explains Share → Add to Home Screen instead. Elsewhere it stays hidden.
let installPrompt = null;
const runningInstalled = navigator.standalone === true ||
  matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function renderInstall() {
  const hint = el.install.querySelector('small');
  if (installPrompt) hint.textContent = 'opens fullscreen, works offline';
  else if (isIOS) hint.textContent = 'in Safari, tap Share, then Add to Home Screen';
  el.install.hidden = runningInstalled || (!installPrompt && !isIOS);
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  el.install.hidden = true;
});
el.install.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null; // a prompt can only be shown once
  prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') el.install.hidden = true;
  else renderInstall();
});

// --- wake lock -------------------------------------------------------------------

let wakeLock = null;
async function syncWakeLock() {
  const want = settings.keepAwake && document.visibilityState === 'visible';
  try {
    if (want && (!wakeLock || wakeLock.released) && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (!want && wakeLock && !wakeLock.released) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed (e.g. battery saver); fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') last = performance.now();
  soundtrack.setPaused(paused || document.visibilityState !== 'visible');
  syncWakeLock();
});

// --- misc ------------------------------------------------------------------------

const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
journey.reducedMotion = motionQuery.matches;
motionQuery.addEventListener?.('change', (e) => (journey.reducedMotion = e.matches));

window.addEventListener('resize', () => {
  journey.resize();
  if (paused) journey.frame(0);
});
window.addEventListener('hashchange', () => {
  const seed = seedFromHash();
  if (seed !== null && seed !== journey.seed) begin(seed);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Scope is this directory only, so it never intercepts sibling apps on the origin.
  navigator.serviceWorker.register(`./sw.js?v=${VERSION}`, { scope: './' }).catch(() => {});
}

el.version.textContent = `v${VERSION} · built ${new Date(BUILT).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
el.version.title = BUILT;
renderSpeed();
renderCaptions();
renderSound();
renderFullscreen();
renderInstall();
setSwitch(el.awake, settings.keepAwake);
begin(seedFromHash() ?? randomSeed());
wakeHud();
syncWakeLock();
requestAnimationFrame(frame);
