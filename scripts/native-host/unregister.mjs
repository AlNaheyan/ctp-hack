#!/usr/bin/env node

import { readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { HOST_NAME } from './register.mjs';

export function manifestPath(homeDirectory = homedir()) {
  return resolve(
    homeDirectory,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts',
    `${HOST_NAME}.json`
  );
}

export async function unregister({ homeDirectory = homedir() } = {}) {
  const path = manifestPath(homeDirectory);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { path, removed: false };
    throw new Error(`Refusing to remove unreadable manifest at ${path}: ${error.message}`);
  }
  if (manifest.name !== HOST_NAME) {
    throw new Error(`Refusing to remove manifest with unexpected name ${JSON.stringify(manifest.name)}.`);
  }
  await unlink(path);
  return { path, removed: true };
}

async function main() {
  const result = await unregister();
  process.stdout.write(result.removed ? `Removed ${result.path}\n` : `Not registered: ${result.path}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Unregistration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
