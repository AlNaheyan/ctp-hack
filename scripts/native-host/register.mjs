#!/usr/bin/env node

import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOST_NAME = 'com.ctphack.discussionnotch.bridge';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const packagePath = resolve(repositoryRoot, 'Packages', 'NativeMessagingHost');

export function validateExtensionId(value) {
  if (typeof value !== 'string' || !/^[a-p]{32}$/.test(value)) {
    throw new Error('Extension ID must be exactly 32 lowercase letters in the range a-p. Copy it from chrome://extensions.');
  }
  return value;
}

export function buildManifest({ extensionId, hostPath }) {
  validateExtensionId(extensionId);
  if (typeof hostPath !== 'string' || !isAbsolute(hostPath)) {
    throw new Error('Native host executable path must be absolute.');
  }
  return {
    name: HOST_NAME,
    description: 'Boring Notch discussion playback bridge',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
}

export async function register({
  extensionId,
  homeDirectory = homedir(),
  skipBuild = false,
  run = spawnSync
}) {
  validateExtensionId(extensionId);

  if (!skipBuild) {
    const result = run('swift', [
      'build',
      '--package-path', packagePath,
      '--configuration', 'release',
      '--product', 'boring-notch-native-host'
    ], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`swift build failed with exit code ${result.status}`);
  }

  const hostPath = resolve(packagePath, '.build', 'release', 'boring-notch-native-host');
  if (!skipBuild) await chmod(hostPath, 0o755);
  const manifestDirectory = resolve(
    homeDirectory,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts'
  );
  const manifestPath = resolve(manifestDirectory, `${HOST_NAME}.json`);
  const temporaryPath = `${manifestPath}.tmp`;
  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(buildManifest({ extensionId, hostPath }), null, 2)}\n`, {
    mode: 0o600
  });
  await rename(temporaryPath, manifestPath);
  return { hostPath, manifestPath };
}

async function main() {
  const extensionId = process.argv[2];
  if (!extensionId) {
    throw new Error('Usage: npm run native:register -- <extension-id-from-chrome://extensions>');
  }
  const result = await register({ extensionId });
  process.stdout.write(`Registered ${HOST_NAME}\nManifest: ${result.manifestPath}\nHost: ${result.hostPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Registration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
