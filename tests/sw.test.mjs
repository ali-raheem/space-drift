// Runs sw.js in a sandbox with fake Cache Storage to check it is a good neighbour
// to other apps on the same origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function boot(location, existingCaches = []) {
  const stores = new Map(existingCaches.map((k) => [k, new Map()]));
  const listeners = {};
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (k) => stores.delete(k),
    open: async (k) => {
      if (!stores.has(k)) stores.set(k, new Map());
      const store = stores.get(k);
      return {
        addAll: async (reqs) => reqs.forEach((r) => store.set(r.url, 'cached')),
        put: async (url, res) => store.set(url, res),
        match: async (url) => store.get(url),
      };
    },
    // A worker that calls this would be reading other apps' caches.
    match: () => { throw new Error('caches.match() searches every cache on the origin'); },
  };
  const self = {
    location: new URL(location),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const Request = class { constructor(url) { this.url = new URL(url, self.location).href; } };
  vm.runInNewContext(source, { self, caches, URL, Request, Response: { error: () => 'error' }, fetch: async () => { throw new Error('offline'); }, Promise, Set, console });
  const run = async (type, event = {}) => {
    let pending;
    listeners[type]({ ...event, waitUntil: (p) => (pending = p), respondWith: (p) => (pending = p) });
    return { responded: pending !== undefined, value: await pending };
  };
  return { stores, run };
}

test('caches are named by app and deployment path', async () => {
  const { stores, run } = boot('https://example.com/apps/space/sw.js?v=1.2.3');
  await run('install');
  assert.deepEqual([...stores.keys()], ['space-drift:/apps/space/:1.2.3']);
  assert.ok(stores.get('space-drift:/apps/space/:1.2.3').has('https://example.com/apps/space/index.html'));
});

test('activation deletes only this deployment\'s older caches', async () => {
  const others = ['rsb-1.1.2', 'colour-studio-abc', 'space-drift:/other/:1.0.0', 'workbox-precache'];
  const { stores, run } = boot('https://example.com/apps/space/sw.js?v=2.0.0', [...others, 'space-drift:/apps/space/:1.0.0']);
  await run('install');
  await run('activate');
  assert.deepEqual([...stores.keys()].sort(), [...others, 'space-drift:/apps/space/:2.0.0'].sort());
});

test('it only answers for its own files, from its own cache', async () => {
  const { run } = boot('https://example.com/apps/space/sw.js?v=1');
  await run('install');
  const req = (url, mode = 'no-cors') => ({ request: { url, method: 'GET', mode } });
  assert.equal((await run('fetch', req('https://example.com/rsb/index.html', 'navigate'))).responded, false);
  assert.equal((await run('fetch', req('https://example.com/apps/space/other.json'))).responded, false);
  assert.equal((await run('fetch', req('https://cdn.example.net/x.js'))).responded, false);
  const own = await run('fetch', req('https://example.com/apps/space/js/app.js?x=1'));
  assert.equal(own.responded, true);
  assert.equal(own.value, 'cached'); // offline fallback came from our cache
});
