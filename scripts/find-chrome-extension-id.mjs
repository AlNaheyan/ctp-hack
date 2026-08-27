#!/usr/bin/env node

import { readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const extensionPath = process.argv[2];
if (!extensionPath) {
  throw new Error('Usage: node scripts/find-chrome-extension-id.mjs <extension-directory>');
}

const chromeRoot = resolve(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
const expectedPath = await realpath(extensionPath);
const profileEntries = await readdir(chromeRoot, { withFileTypes: true });
const matchingIds = new Set();

for (const entry of profileEntries) {
  if (!entry.isDirectory() || (entry.name !== 'Default' && !entry.name.startsWith('Profile '))) continue;

  try {
    const preferences = JSON.parse(
      await readFile(resolve(chromeRoot, entry.name, 'Secure Preferences'), 'utf8')
    );

    for (const [id, settings] of Object.entries(preferences.extensions?.settings ?? {})) {
      if (!/^[a-p]{32}$/.test(id) || typeof settings?.path !== 'string') continue;

      let installedPath;
      try {
        installedPath = await realpath(settings.path);
      } catch {
        continue;
      }

      if (installedPath === expectedPath) matchingIds.add(id);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

if (matchingIds.size === 0) {
  throw new Error(
    `Chrome does not have the unpacked extension at ${expectedPath}. Load it at chrome://extensions, then rerun run.sh.`
  );
}

if (matchingIds.size > 1) {
  throw new Error(`Chrome reported multiple IDs for ${expectedPath}: ${[...matchingIds].join(', ')}`);
}

process.stdout.write([...matchingIds][0]);
