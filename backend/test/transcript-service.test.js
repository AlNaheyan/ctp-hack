import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from '../src/errors.js';
import { MemoryTranscriptCache } from '../src/transcript/cache.js';
import { createTranscriptService } from '../src/transcript/service.js';

const VIDEO_ID = 'dQw4w9WgXcQ';

const providerResult = () => ({
  videoId: VIDEO_ID,
  language: 'en',
  captionSource: 'manual',
  cues: [{ startMs: 1234, durationMs: 500, text: 'sensitive transcript text' }]
});

test('service parses a URL, normalizes provider output, caches it, and never logs text', async () => {
  let calls = 0;
  const logs = [];
  const service = createTranscriptService({
    provider: { async fetchTranscript() { calls += 1; return providerResult(); } },
    cache: new MemoryTranscriptCache(),
    clock: () => Date.parse('2026-08-27T16:00:00Z'),
    logger: {
      debug(message, fields) { logs.push({ message, fields }); },
      info(message, fields) { logs.push({ message, fields }); }
    }
  });

  const request = { url: `https://youtu.be/${VIDEO_ID}`, language: 'en-US' };
  const first = await service.getTranscript(request);
  const second = await service.getTranscript(request);

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(first.segments[0].startTime, 1.234);
  assert.equal(JSON.stringify(logs).includes('sensitive transcript text'), false);
  assert.deepEqual(
    Object.keys(logs[0].fields).sort(),
    ['cacheKey', 'captionSource', 'language', 'segmentCount', 'videoId'].sort()
  );
});

test('forceRefresh bypasses a populated cache', async () => {
  let calls = 0;
  const service = createTranscriptService({
    provider: { async fetchTranscript() { calls += 1; return providerResult(); } }
  });
  await service.getTranscript({ videoId: VIDEO_ID, language: 'en' });
  await service.getTranscript({ videoId: VIDEO_ID, language: 'en', forceRefresh: true });
  assert.equal(calls, 2);
});

test('service applies a bounded timeout to the provider call', async () => {
  const service = createTranscriptService({
    timeoutMs: 20,
    provider: {
      fetchTranscript({ signal }) {
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
    }
  });

  await assert.rejects(service.getTranscript({ videoId: VIDEO_ID }), (error) => {
    assert.equal(error.code, 'UPSTREAM_TIMEOUT');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('service preserves provider typed errors and hides unknown failures', async () => {
  const typed = createTranscriptService({
    provider: { async fetchTranscript() { throw new AppError('CAPTIONS_DISABLED', 'No captions.'); } }
  });
  await assert.rejects(typed.getTranscript({ videoId: VIDEO_ID }), { code: 'CAPTIONS_DISABLED' });

  const unknown = createTranscriptService({
    provider: { async fetchTranscript() { throw new Error('provider internals and tokens'); } }
  });
  await assert.rejects(unknown.getTranscript({ videoId: VIDEO_ID }), (error) => {
    assert.equal(error.code, 'TRANSCRIPT_UNAVAILABLE');
    assert.doesNotMatch(error.message, /provider internals|tokens/);
    return true;
  });
});

test('invalid language and caption-source preferences are typed request failures', async () => {
  const service = createTranscriptService({ provider: { fetchTranscript() { assert.fail('must not call provider'); } } });
  await assert.rejects(service.getTranscript({ videoId: VIDEO_ID, language: '../en' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(service.getTranscript({ videoId: VIDEO_ID, captionSource: 'translated' }), { code: 'INVALID_REQUEST' });
});
