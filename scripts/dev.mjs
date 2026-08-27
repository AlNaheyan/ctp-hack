#!/usr/bin/env node
// One-command local startup: preflight checks, then the backend in mock mode.
//
//   npm run dev
//
// Everything else in the stack is manual by design (Chrome loads the unpacked
// extension, Xcode builds the app); the next steps are printed below.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE_MAJOR = 20;

const problems = [];
const notes = [];

const [major] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE_MAJOR) {
  problems.push(`Node ${MIN_NODE_MAJOR}+ is required. This is Node ${process.versions.node}.`);
}

if (!existsSync(resolve(repoRoot, 'fixtures'))) {
  problems.push('fixtures/ is missing. The mock API has nothing to serve. See fixtures/README.md.');
}

if (!existsSync(resolve(repoRoot, '.env'))) {
  notes.push('No .env found - using defaults (mock mode needs no secrets). Run: cp .env.example .env');
}

if (problems.length > 0) {
  process.stderr.write(`\nCannot start the local stack:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n`);
  process.exit(1);
}

process.stdout.write(
  [
    '',
    'Boring Notch discussion analyzer - local stack',
    ...notes.map((note) => `  note: ${note}`),
    '',
    '  Next steps in other windows:',
    '    Chrome  chrome://extensions -> Developer mode -> Load unpacked -> extension/',
    '    macOS   xcodebuild build -project boringNotch.xcodeproj -scheme boringNotch \\',
    '              -configuration Debug -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO',
    '    Docs    docs/setup/local-stack.md',
    ''
  ].join('\n')
);

const child = spawn(process.execPath, [resolve(repoRoot, 'backend/src/index.js')], {
  cwd: repoRoot,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
