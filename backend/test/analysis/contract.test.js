import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { REPO_ROOT } from '../../src/config.js';
import { validateAnalysisResponse, validateTranscript } from '../../src/analysis/contract.js';

const fixture = (path) => JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures', path), 'utf8'));

test('the canonical valid fixtures pass', () => {
  assert.deepEqual(validateAnalysisResponse(fixture('valid/analysis-response.json')), { valid: true, errors: [] });
  assert.deepEqual(validateTranscript(fixture('valid/transcript.json')), { valid: true, errors: [] });
});

test('each invalid analysis fixture fails for its own reason', () => {
  const cases = [
    ['invalid/analysis-unsorted-events.json', /sorted by triggerTime/],
    ['invalid/analysis-duplicate-event-ids.json', /duplicated/],
    ['invalid/analysis-bad-time-bounds.json', /startTime <= triggerTime <= endTime|must be >= 0/],
    ['invalid/analysis-unsupported-schema-version.json', /schemaVersion must equal 1/]
  ];

  for (const [path, expected] of cases) {
    const result = validateAnalysisResponse(fixture(path));
    assert.equal(result.valid, false, path);
    assert.match(result.errors.join('; '), expected, path);
  }
});

test('the invalid transcript fixture fails on its time bounds', () => {
  const result = validateTranscript(fixture('invalid/transcript-bad-time-bounds.json'));

  assert.equal(result.valid, false);
  assert.match(result.errors.join('; '), /startTime must be <= endTime|must be >= 0/);
});

test('unknown optional fields are ignored, as the compatibility policy requires', () => {
  const analysis = fixture('valid/analysis-response.json');
  analysis.futureField = { anything: true };
  analysis.events[0].experimentalScore = 0.5;

  assert.deepEqual(validateAnalysisResponse(analysis), { valid: true, errors: [] });
});

test('a payload over the contract size ceiling is rejected', () => {
  const analysis = fixture('valid/analysis-response.json');
  analysis.events = Array.from({ length: 4000 }, (_, index) => ({
    ...analysis.events[0],
    id: `evt_bulk_${index}`,
    triggerTime: 20 + index / 1000,
    startTime: 20,
    endTime: 5000,
    summary: 'S'.repeat(500)
  }));

  const result = validateAnalysisResponse(analysis);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('; '), /over the 1048576 byte analysis limit/);
});

test('enum and pattern rules come from the schema file itself', () => {
  const analysis = fixture('valid/analysis-response.json');
  analysis.events[0].type = 'whataboutism';
  assert.match(validateAnalysisResponse(analysis).errors.join('; '), /must be one of unsupported_claim/);

  const withBadId = fixture('valid/analysis-response.json');
  withBadId.events[0].id = '9-starts-with-a-digit';
  assert.match(validateAnalysisResponse(withBadId).errors.join('; '), /does not match/);
});
