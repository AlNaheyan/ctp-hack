import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTranscriptService } from '../src/transcript/service.js';

const enabled = process.env.RUN_YOUTUBE_LIVE_TEST === '1';

test('known public video returns a normalized transcript', { skip: !enabled, timeout: 20_000 }, async () => {
  const service = createTranscriptService({ timeoutMs: 15_000 });
  const transcript = await service.getTranscript({
    // Video used in YouTube's official captions API documentation examples.
    videoId: 'PRU2ShMzQRg',
    language: 'en'
  });

  assert.equal(transcript.schemaVersion, 1);
  assert.equal(transcript.videoId, 'PRU2ShMzQRg');
  assert.ok(transcript.segments.length > 0);
  assert.ok(transcript.segments.every((segment) => segment.startTime <= segment.endTime));
});
