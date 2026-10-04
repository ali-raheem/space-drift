import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);

test('the service worker caches every script, stylesheet and icon', () => {
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  const cached = new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]));
  for (const dir of ['js', 'css', 'icons']) {
    for (const f of readdirSync(new URL(`${dir}/`, root))) {
      assert.ok(cached.has(`${dir}/${f}`), `${dir}/${f} is missing from ASSETS in sw.js`);
    }
  }
});

test('version.js has a semver version and an ISO build time', async () => {
  const { VERSION, BUILT } = await import('../js/version.js');
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(!Number.isNaN(Date.parse(BUILT)));
});

test('the manifest pins a unique app id and stays inside its own directory', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  // Must stay exactly this once released: installed copies are keyed on it, and
  // an id derived from start_url could collide with another app on the origin.
  assert.equal(manifest.id, '/space-drift/');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) readFileSync(new URL(icon.src, root));
});
