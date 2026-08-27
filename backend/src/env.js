// Minimal .env loader. Deliberately dependency-free so a clean checkout can run
// the mock stack with nothing but Node installed.

import { existsSync, readFileSync } from 'node:fs';

/**
 * Parse the contents of a .env file.
 * Supports `KEY=value`, `export KEY=value`, `#` comments, and quoted values.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const parsed = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator === -1) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);

    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(' #');
      if (comment !== -1) value = value.slice(0, comment).trim();
    }

    parsed[key] = value;
  }

  return parsed;
}

/**
 * Load a .env file into `target` without overwriting values that are already
 * set. Real environment variables always win over the file.
 * @param {string} filePath
 * @param {Record<string, string | undefined>} [target]
 * @returns {{ loaded: boolean, keys: string[] }}
 */
export function loadEnvFile(filePath, target = process.env) {
  if (!existsSync(filePath)) return { loaded: false, keys: [] };

  const parsed = parseEnvFile(readFileSync(filePath, 'utf8'));
  const keys = [];

  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) {
      target[key] = value;
      keys.push(key);
    }
  }

  return { loaded: true, keys };
}
