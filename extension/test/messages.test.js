import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MESSAGE_TYPES,
  createPlaybackMessage,
  validatePlaybackMessage,
  videoIdFromHref
} from '../src/shared/messages.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const observation = {
  videoId: 'dQw4w9WgXcQ',
  currentTime: 342.91,
  duration: 1250.4,
  paused: false,
  playbackRate: 1
};

test('creates an envelope that matches the shared playback contract', () => {
  const message = createPlaybackMessage(observation);

  assert.equal(message.schemaVersion, 1);
  assert.equal(message.type, MESSAGE_TYPES.PLAYBACK_STATE);
  assert.equal(message.payload.videoId, 'dQw4w9WgXcQ');
  assert.match(message.payload.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  assert.deepEqual(validatePlaybackMessage(message), { valid: true, errors: [] });
});

test('the checked-in playback fixture validates', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(repoRoot, 'fixtures/valid/playback-message.json'), 'utf8')
  );
  assert.deepEqual(validatePlaybackMessage(fixture), { valid: true, errors: [] });
});

test('rejects malformed playback messages', () => {
  const cases = [
    [null, /message must be an object/],
    [{ schemaVersion: 2, type: 'PLAYBACK_STATE', payload: {} }, /schemaVersion must be 1/],
    [createPlaybackMessage({ ...observation, videoId: 'short' }), /videoId/],
    [createPlaybackMessage({ ...observation, currentTime: -1 }), /currentTime/],
    [createPlaybackMessage({ ...observation, currentTime: Number.NaN }), /currentTime/],
    [createPlaybackMessage({ ...observation, playbackRate: 0 }), /playbackRate/],
    [createPlaybackMessage({ ...observation, paused: 'no' }), /paused/],
    [createPlaybackMessage({ ...observation, observedAt: '2026-08-27 16:03:42' }), /observedAt/]
  ];

  for (const [message, expected] of cases) {
    const result = validatePlaybackMessage(message);
    assert.equal(result.valid, false, JSON.stringify(message));
    assert.match(result.errors.join('; '), expected);
  }
});

test('reads the video id from the URL forms the content script sees', () => {
  assert.equal(videoIdFromHref('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFromHref('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFromHref('https://www.youtube.com/feed/subscriptions'), null);
  assert.equal(videoIdFromHref('not-a-url'), null);
});
