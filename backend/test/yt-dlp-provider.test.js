import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  YtDlpCaptionProvider,
  preferredLanguages,
  selectCaptionFile
} from '../src/transcript/yt-dlp-provider.js';

const VIDEO_ID = 'tKUE8UYhl9w';
const payload = {
  events: [{ tStartMs: 1000, dDurationMs: 500, segs: [{ utf8: 'A caption' }] }]
};

test('prefers exact, original, then base-language captions', () => {
  assert.deepEqual(preferredLanguages('en-US'), ['en-US', 'en-orig', 'en']);
  assert.equal(
    selectCaptionFile([`${VIDEO_ID}.en.json3`, `${VIDEO_ID}.en-orig.json3`], VIDEO_ID, preferredLanguages('en-US')),
    `${VIDEO_ID}.en-orig.json3`
  );
});

test('prefers manual captions and normalizes yt-dlp JSON3 cues', async () => {
  const calls = [];
  const provider = new YtDlpCaptionProvider({
    runner: async (request) => {
      calls.push(request.source);
      return { language: 'en', payload };
    }
  });

  const result = await provider.fetchTranscript({ videoId: VIDEO_ID, language: 'en-US' });
  assert.deepEqual(calls, ['manual']);
  assert.equal(result.captionSource, 'manual');
  assert.deepEqual(result.cues, [{ startMs: 1000, durationMs: 500, text: 'A caption' }]);
});

test('falls back from manual to automatic captions', async () => {
  const calls = [];
  const provider = new YtDlpCaptionProvider({
    runner: async (request) => {
      calls.push(request.source);
      return request.source === 'automatic' ? { language: 'en', payload } : null;
    }
  });

  const result = await provider.fetchTranscript({ videoId: VIDEO_ID, language: 'en-US' });
  assert.deepEqual(calls, ['manual', 'automatic']);
  assert.equal(result.captionSource, 'automatic');
});
