#!/usr/bin/env node
// Pull-request smoke check.
//
//   npm run smoke
//
// Fast, offline, and deterministic: lint, unit tests, fixture validation, and a
// live round trip against the mock API on an ephemeral port. It does not build
// the macOS app - see the manual checklist printed at the end and in
// docs/setup/local-stack.md.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../backend/src/config.js';
import { createLogger } from '../backend/src/logger.js';
import { startMockServer } from '../backend/src/mock/server.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_VIDEO_ID = 'dQw4w9WgXcQ';

const steps = [];

function record(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  process.stdout.write(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` - ${detail}` : ''}\n`);
  return ok;
}

function runNode(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  const ok = result.status === 0;
  if (!ok) {
    process.stdout.write(`${(result.stdout ?? '').trim()}\n${(result.stderr ?? '').trim()}\n`);
  }
  return record(name, ok, ok ? '' : `exit ${result.status}`);
}

function hasRootScript(scriptName) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts?.[scriptName]);
  } catch {
    return false;
  }
}

function runNpmScript(name, scriptName) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', '--silent', scriptName], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  const ok = result.status === 0;
  if (!ok) process.stdout.write(`${(result.stdout ?? '').trim()}\n${(result.stderr ?? '').trim()}\n`);
  return record(name, ok, ok ? '' : `exit ${result.status}`);
}

async function checkMockApi() {
  const config = { ...loadConfig({ ...process.env, PORT: '0', HOST: '127.0.0.1' }) };
  const logger = createLogger({ level: 'error' });
  const mock = await startMockServer({ config, logger });

  try {
    const health = await fetch(`${mock.url}/healthz`);
    const healthBody = await health.json();
    record(
      'mock API GET /healthz',
      health.status === 200 && healthBody.status === 'ok',
      `${health.status}, ${healthBody.availableVideoIds?.length ?? 0} fixture(s)`
    );

    const analyze = await fetch(`${mock.url}/v1/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${DEMO_VIDEO_ID}` })
    });
    const analysis = await analyze.json();
    const sorted =
      Array.isArray(analysis.events) &&
      analysis.events.every((event, index, all) => index === 0 || all[index - 1].triggerTime <= event.triggerTime);

    record(
      'mock API POST /v1/analyze returns the golden fixture',
      analyze.status === 200 &&
        analysis.schemaVersion === 1 &&
        analysis.videoId === DEMO_VIDEO_ID &&
        Array.isArray(analysis.events) &&
        analysis.events.length > 0 &&
        sorted,
      `${analyze.status}, ${analysis.events?.length ?? 0} events`
    );

    const getById = await fetch(`${mock.url}/v1/analysis/${DEMO_VIDEO_ID}`);
    record('mock API GET /v1/analysis/:videoId', getById.status === 200, String(getById.status));
    await getById.body?.cancel();

    const noTranscript = await fetch(`${mock.url}/v1/analysis/${DEMO_VIDEO_ID}?scenario=no_transcript`);
    const noTranscriptBody = await noTranscript.json();
    record(
      'mock API failure scenario is typed',
      noTranscript.status === 422 && noTranscriptBody.error?.code === 'TRANSCRIPT_UNAVAILABLE',
      `${noTranscript.status} ${noTranscriptBody.error?.code ?? '?'}`
    );

    const badUrl = await fetch(`${mock.url}/v1/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/watch?v=nope' })
    });
    const badUrlBody = await badUrl.json();
    record(
      'mock API rejects a non-YouTube URL',
      badUrl.status === 400 && ['UNSUPPORTED_HOST', 'INVALID_URL'].includes(badUrlBody.error?.code),
      `${badUrl.status} ${badUrlBody.error?.code ?? '?'}`
    );
  } finally {
    await mock.close();
  }
}

process.stdout.write('\nW1-T4 smoke check\n\n');

runNode('lint', [resolve(repoRoot, 'scripts/lint.mjs')]);
runNode('unit tests', ['--test']);

if (hasRootScript('validate:fixtures')) {
  runNpmScript('fixture validation (W1-T2)', 'validate:fixtures');
} else {
  runNode('fixture structural check', [resolve(repoRoot, 'scripts/check-fixtures.mjs')]);
}

record('extension manifest present', existsSync(resolve(repoRoot, 'extension/manifest.json')));
record('.env.example present', existsSync(resolve(repoRoot, '.env.example')));
// git check-ignore: 0 = ignored, 1 = not ignored, anything else (or a missing
// git, or not a checkout) means we cannot ask git - read .gitignore instead.
const gitIgnoresEnv = spawnSync('git', ['check-ignore', '-q', '.env'], { cwd: repoRoot });
const envIsIgnored =
  gitIgnoresEnv.status === 0 ||
  (gitIgnoresEnv.status !== 1 &&
    readFileSync(resolve(repoRoot, '.gitignore'), 'utf8')
      .split('\n')
      .some((line) => line.trim() === '.env'));

record('.env is git-ignored', envIsIgnored, 'secrets stay out of the repository');

await checkMockApi();

const failed = steps.filter((step) => !step.ok);

process.stdout.write(
  [
    '',
    `${steps.length - failed.length}/${steps.length} automated checks passed`,
    '',
    'Manual checks this script cannot make (do them before requesting review):',
    '  [ ] Xcode: xcodebuild build -project boringNotch.xcodeproj -scheme boringNotch \\',
    '        -configuration Debug -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO   (macOS only)',
    '  [ ] Chrome: chrome://extensions -> Load unpacked -> extension/ loads with no errors',
    '  [ ] A YouTube watch page logs one observation in the service-worker console',
    '  [ ] No secret, key, or personal signing value is in the diff',
    ''
  ].join('\n')
);

// Set the code rather than calling process.exit(): the mock server is already
// closed and an abrupt exit trips a libuv assertion on Windows.
process.exitCode = failed.length === 0 ? 0 : 1;
