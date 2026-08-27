import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANALYSIS_CACHE_TTL_MS, AnalysisResultCache } from '../../src/api/result-cache.js';

const value = (videoId = 'demoTalk001') => ({
  analysis: { schemaVersion: 1, videoId, events: [{ id: 'evt_a' }] },
  meta: { modelId: 'stub-rules-1.0.0' }
});

function fakeClock(start = 1_000_000) {
  let current = start;
  const clock = () => current;
  clock.advance = (ms) => {
    current += ms;
  };
  return clock;
}

test('the default TTL is the 24 hour reuse window from the roadmap', () => {
  assert.equal(ANALYSIS_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
});

test('a stored analysis is returned with age and remaining lifetime', () => {
  const clock = fakeClock();
  const cache = new AnalysisResultCache({ clock });

  cache.set('key', value());
  clock.advance(90 * 1000);

  const entry = cache.get('key');
  assert.equal(entry.analysis.videoId, 'demoTalk001');
  assert.equal(entry.ageSeconds, 90);
  assert.equal(entry.expiresInSeconds, 24 * 60 * 60 - 90);
});

test('entries expire exactly at the TTL', () => {
  const clock = fakeClock();
  const cache = new AnalysisResultCache({ ttlMs: 1000, clock });

  cache.set('key', value());
  clock.advance(999);
  assert.notEqual(cache.get('key'), undefined);

  clock.advance(1);
  assert.equal(cache.get('key'), undefined);
  assert.equal(cache.describe().expirations, 1);
});

test('stored values are cloned, so a caller cannot mutate the cache', () => {
  const cache = new AnalysisResultCache();
  const stored = value();

  cache.set('key', stored);
  stored.analysis.events.push({ id: 'evt_b' });

  const first = cache.get('key');
  assert.equal(first.analysis.events.length, 1);

  first.analysis.events.push({ id: 'evt_c' });
  assert.equal(cache.get('key').analysis.events.length, 1);
});

test('eviction is least-recently-used', () => {
  const cache = new AnalysisResultCache({ maxEntries: 2 });

  cache.set('a', value('a1'));
  cache.set('b', value('b1'));
  cache.get('a'); // 'a' becomes the most recently used
  cache.set('c', value('c1'));

  assert.notEqual(cache.get('a'), undefined);
  assert.equal(cache.get('b'), undefined, 'the least recently used entry is evicted');
  assert.notEqual(cache.get('c'), undefined);
  assert.equal(cache.describe().evictions, 1);
});

test('the health view reports counters only', () => {
  const cache = new AnalysisResultCache();
  cache.set('key', value());
  cache.get('key');
  cache.get('missing');

  const described = cache.describe();
  assert.deepEqual(Object.keys(described).sort(), [
    'entries',
    'evictions',
    'expirations',
    'hits',
    'maxEntries',
    'misses',
    'stores',
    'ttlMs'
  ]);
  assert.equal(described.hits, 1);
  assert.equal(described.misses, 1);
  assert.equal(JSON.stringify(described).includes('demoTalk001'), false, 'no payload data in the health view');
});

test('invalid construction is rejected early', () => {
  assert.throws(() => new AnalysisResultCache({ ttlMs: 0 }), TypeError);
  assert.throws(() => new AnalysisResultCache({ maxEntries: -1 }), TypeError);
});
