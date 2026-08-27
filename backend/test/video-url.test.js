import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractVideoId, requireVideoId } from '../src/mock/video-url.js';

test('accepts the supported YouTube URL forms', () => {
  const forms = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abc123',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'www.youtube.com/watch?v=dQw4w9WgXcQ',
    'dQw4w9WgXcQ'
  ];

  for (const form of forms) {
    assert.equal(extractVideoId(form), 'dQw4w9WgXcQ', form);
  }
});

test('rejects non-YouTube hosts with UNSUPPORTED_HOST', () => {
  assert.throws(() => extractVideoId('https://vimeo.com/watch?v=dQw4w9WgXcQ'), (error) => {
    assert.equal(error.code, 'UNSUPPORTED_HOST');
    assert.equal(error.status, 400);
    return true;
  });
});

test('returns null for YouTube URLs without a video id', () => {
  assert.equal(extractVideoId('https://www.youtube.com/'), null);
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(extractVideoId(''), null);
  assert.equal(extractVideoId(undefined), null);
});

test('requireVideoId throws INVALID_URL with guidance', () => {
  assert.throws(() => requireVideoId('https://www.youtube.com/feed/subscriptions'), (error) => {
    assert.equal(error.code, 'INVALID_URL');
    assert.match(error.message, /watch\?v=/);
    return true;
  });
});
