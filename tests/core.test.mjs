import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, makeNoise, sectorName, bodyName } from '../js/rng.js';
import { storageKey, loadSettings, saveSettings, DEFAULTS, SPEEDS } from '../js/settings.js';

test('the RNG is deterministic per seed', () => {
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const seq = (r) => Array.from({ length: 5 }, () => r.next());
  assert.deepEqual(seq(a), seq(b));
  assert.notDeepEqual(seq(new Rng(42)), seq(c));
  assert.equal(sectorName(new Rng(7)), sectorName(new Rng(7)));
});

test('weighted picks never choose a zero-weight key', () => {
  const r = new Rng(1);
  for (let i = 0; i < 2000; i++) assert.notEqual(r.weighted({ a: 1, b: 0, c: 2 }), 'b');
});

test('noise stays in [0, 1]', () => {
  const { noise3, fbm3 } = makeNoise(9);
  const r = new Rng(3);
  for (let i = 0; i < 5000; i++) {
    const x = r.float(-50, 50), y = r.float(-50, 50), z = r.float(-50, 50);
    const n = noise3(x, y, z), f = fbm3(x, y, z, 5);
    assert.ok(n >= 0 && n <= 1 && f >= 0 && f <= 1);
  }
});

test('names are non-empty strings', () => {
  const r = new Rng(5);
  for (let i = 0; i < 100; i++) {
    for (const kind of ['planet', 'star', 'remnant']) assert.ok(bodyName(r, kind).length > 2);
    assert.ok(sectorName(r).split(' ').length >= 3);
  }
});

test('the storage key is namespaced by app and deployment directory', () => {
  assert.equal(storageKey('/'), 'space-drift:/:settings');
  assert.equal(storageKey('/apps/space/'), 'space-drift:/apps/space/:settings');
  assert.equal(storageKey('/apps/space/index.html'), 'space-drift:/apps/space/:settings');
});

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = String(v)) };
}

test('settings round-trip under one key and leave other apps\' keys alone', () => {
  const store = fakeStorage({ 'rsb.recent': '[1,2]', theme: 'dark' });
  const key = storageKey('/space/');
  assert.deepEqual(loadSettings(store, key), DEFAULTS);
  saveSettings(store, key, { speedIndex: 4, captions: false, keepAwake: false, junk: 1 });
  assert.deepEqual(loadSettings(store, key), { speedIndex: 4, captions: false, keepAwake: false });
  assert.deepEqual(Object.keys(store.data).sort(), ['rsb.recent', 'space-drift:/space/:settings', 'theme']);
  assert.equal(store.data['rsb.recent'], '[1,2]');
});

test('bad or missing stored settings fall back to defaults', () => {
  const key = storageKey('/');
  assert.deepEqual(loadSettings(fakeStorage({ [key]: '{nope' }), key), DEFAULTS);
  assert.deepEqual(loadSettings(fakeStorage({ [key]: JSON.stringify({ speedIndex: SPEEDS.length }) }), key), DEFAULTS);
  assert.deepEqual(loadSettings(null, key), DEFAULTS);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(throwing, key), DEFAULTS);
  saveSettings(throwing, key, DEFAULTS); // must not throw
});
