import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_FIXTURES_DIR } from '../src/config.js';
import { findAnalysisFixturePath, listAnalysisFixtureIds, loadAnalysisFixture } from '../src/fixtures.js';

const DEMO_VIDEO_ID = 'demoTalk001';

test('the canonical fixtures directory holds at least the demo video', () => {
  const ids = listAnalysisFixtureIds(DEFAULT_FIXTURES_DIR);
  assert.ok(ids.includes(DEMO_VIDEO_ID), `expected ${DEMO_VIDEO_ID} in ${ids.join(', ')}`);
});

test('fixtures are read from the canonical location, never a backend copy', () => {
  const path = findAnalysisFixturePath(DEMO_VIDEO_ID, DEFAULT_FIXTURES_DIR);
  assert.ok(path !== null);
  assert.match(path.replaceAll('\\', '/'), /\/fixtures\/valid\/analysis-response\.json$/);
});

test('the demo fixture matches the shared analysis contract', () => {
  const { payload } = loadAnalysisFixture(DEMO_VIDEO_ID, DEFAULT_FIXTURES_DIR);

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.videoId, DEMO_VIDEO_ID);
  assert.ok(payload.events.length >= 4);

  const speakers = new Set(payload.events.map((event) => event.speaker));
  const types = new Set(payload.events.map((event) => event.type));
  assert.ok(speakers.size >= 2, 'expected at least two speakers');
  assert.ok(types.size >= 4, 'expected at least four insight types');

  payload.events.forEach((event, index) => {
    assert.ok(event.startTime <= event.triggerTime && event.triggerTime <= event.endTime, `bounds at index ${index}`);
    assert.ok(event.confidence >= 0 && event.confidence <= 1, `confidence at index ${index}`);
    if (index > 0) {
      assert.ok(payload.events[index - 1].triggerTime <= event.triggerTime, 'events must be sorted by triggerTime');
    }
  });
});

test('a missing fixture reports where to add it and what exists', () => {
  assert.throws(() => loadAnalysisFixture('abcdefghijk', DEFAULT_FIXTURES_DIR), (error) => {
    assert.equal(error.code, 'VIDEO_NOT_FOUND');
    assert.match(error.message, /manifest\.json/);
    assert.ok(error.details.availableVideoIds.includes(DEMO_VIDEO_ID));
    return true;
  });
});
