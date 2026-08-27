import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(extensionRoot, 'manifest.json'), 'utf8'));

test('the manifest can be loaded unpacked without a production key', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal('key' in manifest, false, 'a packed "key" would tie the dev build to one extension id');
  assert.equal('oauth2' in manifest, false);
  assert.ok(manifest.version);
});

test('every file the manifest references exists', () => {
  const referenced = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((entry) => entry.js ?? [])
  ];

  for (const file of referenced) {
    assert.ok(existsSync(resolve(extensionRoot, file)), `${file} is referenced but missing`);
  }
});

test('permissions stay minimal for playback plus native connection state', () => {
  assert.deepEqual(manifest.host_permissions, ['https://www.youtube.com/*']);
  assert.deepEqual(manifest.permissions, ['nativeMessaging', 'storage']);
});

test('the content script stays a classic script', () => {
  const source = readFileSync(resolve(extensionRoot, manifest.content_scripts[0].js[0]), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, 'MV3 content scripts are not ES modules');
  assert.doesNotMatch(source, /^\s*export\s/m);
});

test('the service worker is an ES module', () => {
  assert.equal(manifest.background.type, 'module');
  const source = readFileSync(resolve(extensionRoot, manifest.background.service_worker), 'utf8');
  assert.match(source, /^import\s/m);
});
