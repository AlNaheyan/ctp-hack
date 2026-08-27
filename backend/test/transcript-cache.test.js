import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MemoryTranscriptCache, buildTranscriptCacheKey } from '../src/transcript/cache.js';

const key = buildTranscriptCacheKey({
  videoId: 'dQw4w9WgXcQ',
  language: 'EN-us',
  captionSource: 'manual'
});

test('cache keys include video id, normalized language, and caption source', () => {
  assert.equal(key, 'dQw4w9WgXcQ:en-us:manual');
  assert.notEqual(key, buildTranscriptCacheKey({
    videoId: 'dQw4w9WgXcQ',
    language: 'en-US',
    captionSource: 'automatic'
  }));
});

test('cache returns defensive copies and expires entries', () => {
  let now = 1000;
  const cache = new MemoryTranscriptCache({ ttlMs: 100, clock: () => now });
  const value = { segments: [{ text: 'source' }] };
  cache.set(key, value);

  value.segments[0].text = 'mutated outside';
  const first = cache.get(key);
  assert.equal(first.segments[0].text, 'source');
  first.segments[0].text = 'mutated result';
  assert.equal(cache.get(key).segments[0].text, 'source');

  now = 1100;
  assert.equal(cache.get(key), undefined);
});

test('cache evicts the least recently used entry at its size bound', () => {
  const cache = new MemoryTranscriptCache({ maxEntries: 2 });
  cache.set('a', { value: 'a' });
  cache.set('b', { value: 'b' });
  cache.get('a');
  cache.set('c', { value: 'c' });
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual(cache.get('a'), { value: 'a' });
});
