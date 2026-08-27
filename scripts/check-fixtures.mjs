#!/usr/bin/env node
// Structural fixture check.
//
//   npm run check:fixtures
//
// PROVISIONAL: W1-T2 owns real schema validation. This enforces only the
// invariants the mock API and the timeline matcher depend on, so Wave 1 lanes
// are not blocked. When W1-T2 lands its validation command, call that from
// scripts/smoke.mjs and delete this file.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePlaybackMessage } from '../extension/src/shared/messages.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = process.env.FIXTURES_DIR
  ? resolve(repoRoot, process.env.FIXTURES_DIR)
  : resolve(repoRoot, 'fixtures');

const RFC_3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const isFiniteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * @param {unknown} payload
 * @returns {string[]} errors
 */
export function checkAnalysisPayload(payload) {
  const errors = [];

  if (typeof payload !== 'object' || payload === null) return ['payload must be an object'];

  if (payload.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof payload.videoId !== 'string' || !VIDEO_ID.test(payload.videoId)) {
    errors.push('videoId must be an 11-character YouTube id');
  }
  if (typeof payload.title !== 'string' || payload.title.trim() === '') errors.push('title must be a non-empty string');

  for (const field of ['generatedAt', 'expiresAt']) {
    if (typeof payload[field] !== 'string' || !RFC_3339_UTC.test(payload[field])) {
      errors.push(`${field} must be an RFC 3339 UTC timestamp`);
    }
  }

  if (
    typeof payload.generatedAt === 'string' &&
    typeof payload.expiresAt === 'string' &&
    Date.parse(payload.expiresAt) <= Date.parse(payload.generatedAt)
  ) {
    errors.push('expiresAt must be after generatedAt');
  }

  if (!Array.isArray(payload.events)) return [...errors, 'events must be an array'];

  const seenIds = new Set();
  let previousTrigger = -Infinity;

  payload.events.forEach((event, index) => {
    const at = `events[${index}]`;

    if (typeof event !== 'object' || event === null) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (typeof event.id !== 'string' || event.id === '') errors.push(`${at}.id must be a non-empty string`);
    else if (seenIds.has(event.id)) errors.push(`${at}.id "${event.id}" is duplicated`);
    else seenIds.add(event.id);

    for (const field of ['startTime', 'triggerTime', 'endTime']) {
      if (!isFiniteNonNegative(event[field])) errors.push(`${at}.${field} must be a finite number >= 0`);
    }

    if (
      isFiniteNonNegative(event.startTime) &&
      isFiniteNonNegative(event.triggerTime) &&
      isFiniteNonNegative(event.endTime) &&
      !(event.startTime <= event.triggerTime && event.triggerTime <= event.endTime)
    ) {
      errors.push(`${at}: startTime <= triggerTime <= endTime is violated`);
    }

    if (isFiniteNonNegative(event.triggerTime)) {
      if (event.triggerTime < previousTrigger) errors.push(`${at}: events must be sorted by triggerTime`);
      previousTrigger = event.triggerTime;
    }

    for (const field of ['speaker', 'type', 'title', 'summary']) {
      if (typeof event[field] !== 'string' || event[field].trim() === '') {
        errors.push(`${at}.${field} must be a non-empty string`);
      }
    }

    if (typeof event.confidence !== 'number' || !(event.confidence >= 0 && event.confidence <= 1)) {
      errors.push(`${at}.confidence must be a number in [0, 1]`);
    }
  });

  return errors;
}

function jsonFilesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(directory, entry.name));
}

function run() {
  if (!existsSync(fixturesDir)) {
    process.stderr.write(`\nFixtures directory not found: ${fixturesDir}\nSee fixtures/README.md.\n\n`);
    return 1;
  }

  if (existsSync(resolve(repoRoot, 'contracts'))) {
    process.stdout.write('note: contracts/ exists - prefer the W1-T2 validation command over this structural check\n');
  }

  const results = [];

  for (const file of [...jsonFilesIn(resolve(fixturesDir, 'analysis/valid')), ...jsonFilesIn(resolve(fixturesDir, 'analysis'))]) {
    let errors;
    try {
      errors = checkAnalysisPayload(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) {
      errors = [`invalid JSON (${error.message})`];
    }
    results.push({ file, errors });
  }

  for (const file of jsonFilesIn(resolve(fixturesDir, 'playback/valid'))) {
    let errors;
    try {
      errors = validatePlaybackMessage(JSON.parse(readFileSync(file, 'utf8'))).errors;
    } catch (error) {
      errors = [`invalid JSON (${error.message})`];
    }
    results.push({ file, errors });
  }

  if (results.length === 0) {
    process.stderr.write(`\nNo fixtures found under ${fixturesDir}. See fixtures/README.md.\n\n`);
    return 1;
  }

  let failed = 0;
  for (const { file, errors } of results) {
    const name = relative(repoRoot, file);
    if (errors.length === 0) {
      process.stdout.write(`  ok    ${name}\n`);
    } else {
      failed += 1;
      process.stdout.write(`  FAIL  ${name}\n${errors.map((e) => `          - ${e}`).join('\n')}\n`);
    }
  }

  process.stdout.write(`\n${results.length - failed}/${results.length} fixtures pass structural checks\n`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(run());
}
