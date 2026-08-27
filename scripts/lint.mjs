#!/usr/bin/env node
// Dependency-free lint for the backend, the extension, and the fixtures.
//
//   npm run lint
//
// Checks:
//   1. every JavaScript file parses
//   2. every JSON file parses
//   3. the extension manifest stays loadable unpacked (no packed key, minimal
//      permissions, no secrets)
//   4. no credential-shaped string is tracked anywhere in the repo
//   5. .env is not tracked

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'DerivedData',
  'build',
  '.build',
  '.swiftpm',
  'Pods',
  'Carthage'
]);

const SCANNABLE = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.swift',
  '.plist',
  '.entitlements',
  '.yml',
  '.yaml',
  '.sh',
  '.pbxproj',
  '.xcconfig'
]);

const MAX_SCAN_BYTES = 2 * 1024 * 1024;

const SECRET_PATTERNS = [
  { name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'assigned GEMINI_API_KEY', pattern: /GEMINI_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/ },
  { name: 'OpenAI-style key', pattern: /\bsk-[A-Za-z0-9]{24,}\b/ },
  { name: 'private key block', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ }
];

const failures = [];
const checked = { js: 0, json: 0, scanned: 0 };

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.devcontainer') continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

const allFiles = walk(repoRoot);
const inOwnedTree = (file) => {
  const rel = relative(repoRoot, file);
  return ['backend', 'extension', 'scripts', 'fixtures'].includes(rel.split(sep)[0]);
};

// 1. JavaScript parses.
for (const file of allFiles.filter((f) => inOwnedTree(f) && ['.js', '.mjs', '.cjs'].includes(extname(f)))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    checked.js += 1;
  } catch (error) {
    failures.push(`${relative(repoRoot, file)}: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`);
  }
}

// 2. JSON parses.
for (const file of allFiles.filter((f) => inOwnedTree(f) && extname(f) === '.json')) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
    checked.json += 1;
  } catch (error) {
    failures.push(`${relative(repoRoot, file)}: invalid JSON (${error.message})`);
  }
}

// 3. Extension manifest stays dev-loadable.
const manifestPath = resolve(repoRoot, 'extension/manifest.json');
try {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) failures.push('extension/manifest.json: manifest_version must be 3');
  if ('key' in manifest) {
    failures.push('extension/manifest.json: remove "key" - the dev build must load unpacked without a production key');
  }
  if ('oauth2' in manifest || 'client_id' in manifest) {
    failures.push('extension/manifest.json: no credentials belong in the manifest');
  }
  for (const host of manifest.host_permissions ?? []) {
    if (!host.startsWith('https://www.youtube.com') && !host.startsWith('https://youtube.com')) {
      failures.push(`extension/manifest.json: host permission "${host}" is broader than YouTube`);
    }
  }
  if ((manifest.permissions ?? []).includes('nativeMessaging')) {
    // Not an error, just a reminder that the host registration must land with it.
    process.stdout.write('note: manifest requests nativeMessaging - W3-T2 must ship the host manifest and registration script\n');
  }
} catch (error) {
  failures.push(`extension/manifest.json: ${error.message}`);
}

// 4. No credential-shaped strings anywhere tracked.
for (const file of allFiles) {
  if (!SCANNABLE.has(extname(file))) continue;
  if (statSync(file).size > MAX_SCAN_BYTES) continue;
  if (file === resolve(repoRoot, 'scripts/lint.mjs')) continue; // patterns live here

  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  checked.scanned += 1;

  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = text.match(pattern);
    if (match === null) continue;

    const lineNumber = text.slice(0, match.index).split('\n').length;
    // Escape hatch for fixtures and tests that must contain a credential-shaped
    // literal. Put `lint-allow-secret` on the line or the line above it.
    const context = `${lines[lineNumber - 2] ?? ''}\n${lines[lineNumber - 1] ?? ''}`;
    if (context.includes('lint-allow-secret')) continue;

    failures.push(
      `${relative(repoRoot, file)}:${lineNumber}: possible ${name}. Remove it, rotate the credential, and keep secrets in .env only. If it is a deliberate fake, mark the line with lint-allow-secret.`
    );
  }
}

// 5. .env is not tracked.
try {
  const tracked = execFileSync('git', ['ls-files', '.env', '**/.env'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (tracked !== '') {
    failures.push(`.env is tracked by git (${tracked.split('\n').join(', ')}). Run: git rm --cached <file> and rotate the secrets.`);
  }
} catch {
  process.stdout.write('note: git not available, skipped the tracked-.env check\n');
}

if (failures.length > 0) {
  process.stderr.write(`\nlint FAILED (${failures.length})\n${failures.map((f) => `  - ${f}`).join('\n')}\n\n`);
  process.exit(1);
}

process.stdout.write(
  `lint OK - ${checked.js} JS files parsed, ${checked.json} JSON files parsed, ${checked.scanned} files scanned for credentials\n`
);
