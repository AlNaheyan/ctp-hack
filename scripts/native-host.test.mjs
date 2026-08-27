import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { HOST_NAME, buildManifest, register, validateExtensionId } from './native-host/register.mjs';
import { manifestPath, unregister } from './native-host/unregister.mjs';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

test('manifest contains one exact extension origin and an absolute host path', () => {
  const manifest = buildManifest({ extensionId: EXTENSION_ID, hostPath: '/tmp/boring-notch-native-host' });
  assert.equal(manifest.name, HOST_NAME);
  assert.equal(manifest.type, 'stdio');
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
  assert.equal(manifest.allowed_origins.length, 1);
});

test('extension IDs and host paths are strictly validated', () => {
  for (const invalid of ['abc', 'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP', `${EXTENSION_ID}a`, 'z'.repeat(32)]) {
    assert.throws(() => validateExtensionId(invalid), /32 lowercase letters/);
  }
  assert.throws(() => buildManifest({ extensionId: EXTENSION_ID, hostPath: 'relative/host' }), /absolute/);
});

test('registration writes the computed per-user Chrome manifest atomically', async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'native-host-register-'));
  const result = await register({ extensionId: EXTENSION_ID, homeDirectory, skipBuild: true });
  const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
  assert.equal(result.manifestPath, manifestPath(homeDirectory));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
  assert.ok(
    manifest.path.replaceAll('\\', '/').endsWith('/Packages/NativeMessagingHost/.build/release/boring-notch-native-host')
  );
});

test('unregistration is idempotent and refuses a foreign manifest', async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), 'native-host-unregister-'));
  const path = manifestPath(homeDirectory);
  assert.deepEqual(await unregister({ homeDirectory }), { path, removed: false });

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ name: 'someone.else' }));
  await assert.rejects(unregister({ homeDirectory }), /unexpected name/);

  await writeFile(path, JSON.stringify({ name: HOST_NAME }));
  assert.deepEqual(await unregister({ homeDirectory }), { path, removed: true });
  assert.deepEqual(await unregister({ homeDirectory }), { path, removed: false });
});
