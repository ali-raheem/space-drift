// Persisted preferences. Other apps may share this origin (e.g. several apps under
// one domain), so everything this app stores lives under a single key that is
// namespaced by app *and* deployment path, and nothing else is ever touched.
// Storage is injectable so this can be tested under Node.

export const APP_KEY = 'space-drift';
export const SPEEDS = [0.25, 0.5, 1, 2, 4];
export const DEFAULTS = Object.freeze({ speedIndex: 2, captions: true, keepAwake: true });

/** e.g. "space-drift:/apps/space/:settings" for a copy served from /apps/space/. */
export function storageKey(pathname) {
  const dir = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]*$/, '');
  return `${APP_KEY}:${dir || '/'}:settings`;
}

export function loadSettings(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    const out = { ...DEFAULTS };
    if (Number.isInteger(saved.speedIndex) && saved.speedIndex >= 0 && saved.speedIndex < SPEEDS.length) out.speedIndex = saved.speedIndex;
    if (typeof saved.captions === 'boolean') out.captions = saved.captions;
    if (typeof saved.keepAwake === 'boolean') out.keepAwake = saved.keepAwake;
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(storage, key, settings) {
  try {
    storage?.setItem(key, JSON.stringify({
      speedIndex: settings.speedIndex, captions: settings.captions, keepAwake: settings.keepAwake,
    }));
  } catch { /* private mode / quota: preferences just won't stick */ }
}
