import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { REPO_ROOT } from '../../src/config.js';
import { AppError } from '../../src/errors.js';
import { validateAnalysisResponse } from '../../src/analysis/contract.js';
import { createStubProvider } from '../../src/analysis/providers/stub.js';
import { AnalysisResultCache } from '../../src/api/result-cache.js';
import { CACHE_STATUS, buildCacheKey, createAnalysisService } from '../../src/api/analysis-service.js';

const TRANSCRIPT = JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/valid/transcript.json'), 'utf8'));
const VIDEO_ID = TRANSCRIPT.videoId;
const URL_FOR = (videoId = VIDEO_ID) => `https://www.youtube.com/watch?v=${videoId}`;

const FIXED_NOW = () => new Date('2026-08-27T16:00:00.000Z');

/** Transcript service double: counts calls, can stall or fail on demand. */
function fakeTranscripts({ transcript = TRANSCRIPT, delayMs = 0, error } = {}) {
  const calls = [];

  return {
    calls,
    async getTranscript(request) {
      calls.push(request);
      if (delayMs > 0) {
        await new Promise((done, fail) => {
          const timer = setTimeout(done, delayMs);
          request.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            fail(new AppError('UPSTREAM_TIMEOUT', 'transcript aborted'));
          });
        });
      }
      if (error) throw error;
      return { ...transcript, videoId: request.videoId ?? transcript.videoId };
    }
  };
}

/** Stub analyzer that records how many model jobs actually ran. */
function countingProvider({ modelId = 'stub-rules-1.0.0' } = {}) {
  const stub = createStubProvider({ modelId });
  const calls = [];

  return {
    calls,
    name: stub.name,
    modelId,
    async generate(request) {
      calls.push(request);
      return stub.generate(request);
    }
  };
}

function fakeClock(start = 1_000_000) {
  let current = start;
  const clock = () => current;
  clock.advance = (ms) => {
    current += ms;
  };
  return clock;
}

const build = (overrides = {}) => {
  const transcripts = overrides.transcripts ?? fakeTranscripts();
  const provider = overrides.provider ?? countingProvider();
  const cache = overrides.cache ?? new AnalysisResultCache();
  const service = createAnalysisService({
    transcripts,
    provider,
    cache,
    now: FIXED_NOW,
    ...overrides.options
  });
  return { service, transcripts, provider, cache };
};

test('a cold request produces a contract-valid timeline', async () => {
  const { service, transcripts, provider } = build();

  const result = await service.analyze({ url: URL_FOR() });

  assert.deepEqual(validateAnalysisResponse(result.analysis), { valid: true, errors: [] });
  assert.equal(result.analysis.videoId, VIDEO_ID);
  assert.ok(result.analysis.events.length > 0);
  assert.equal(result.cache.status, CACHE_STATUS.miss);
  assert.equal(transcripts.calls.length, 1);
  assert.equal(provider.calls.length, 1);
});

test('a warm request avoids the transcript and the model entirely', async () => {
  const { service, transcripts, provider } = build();

  const cold = await service.analyze({ url: URL_FOR() });
  const warm = await service.analyze({ url: URL_FOR() });

  assert.equal(warm.cache.status, CACHE_STATUS.hit);
  assert.deepEqual(warm.analysis, cold.analysis);
  assert.equal(transcripts.calls.length, 1, 'no second transcript fetch');
  assert.equal(provider.calls.length, 1, 'no second model call');
  assert.equal(warm.cache.expiresAt, cold.cache.expiresAt);
});

test('cache metadata carries timestamps and no secrets', async () => {
  const { service } = build();

  const { cache } = await service.analyze({ url: URL_FOR() });

  assert.match(cache.storedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(cache.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.parse(cache.expiresAt) > Date.parse(cache.storedAt));
  assert.equal(/api[_-]?key/i.test(JSON.stringify(cache)), false);
});

test('forceRefresh recomputes and replaces the cached entry', async () => {
  const { service, provider } = build();

  await service.analyze({ url: URL_FOR() });
  const refreshed = await service.analyze({ url: URL_FOR(), forceRefresh: true });

  assert.equal(refreshed.cache.status, CACHE_STATUS.bypass);
  assert.equal(provider.calls.length, 2);

  const afterRefresh = await service.analyze({ url: URL_FOR() });
  assert.equal(afterRefresh.cache.status, CACHE_STATUS.hit);
  assert.equal(provider.calls.length, 2, 'the refreshed result was cached');
});

test('concurrent identical requests start at most one analysis job', async () => {
  const { service, transcripts, provider } = build({ transcripts: fakeTranscripts({ delayMs: 40 }) });

  const results = await Promise.all(Array.from({ length: 5 }, () => service.analyze({ url: URL_FOR() })));

  assert.equal(transcripts.calls.length, 1, 'one transcript fetch for five callers');
  assert.equal(provider.calls.length, 1, 'one model job for five callers');

  const statuses = results.map((result) => result.cache.status).sort();
  assert.equal(statuses.filter((status) => status === CACHE_STATUS.coalesced).length, 4);
  assert.equal(statuses.filter((status) => status === CACHE_STATUS.miss).length, 1);

  for (const result of results) assert.deepEqual(result.analysis, results[0].analysis);
});

test('concurrent requests for different videos are not coalesced together', async () => {
  const { service, transcripts } = build({ transcripts: fakeTranscripts({ delayMs: 20 }) });

  await Promise.all([service.analyze({ videoId: VIDEO_ID }), service.analyze({ videoId: 'otherVid001' })]);

  assert.equal(transcripts.calls.length, 2);
});

test('the cache key covers video, language, schema, model, prompt, and taxonomy', () => {
  const key = buildCacheKey({ videoId: VIDEO_ID, language: 'en-US', modelId: 'gemini-3.6-flash' });
  const parts = key.split('|');

  assert.equal(parts[0], VIDEO_ID);
  assert.equal(parts[1], 'en-us', 'language is normalized');
  assert.equal(parts[2], 'schema1');
  assert.equal(parts[3], 'gemini-3.6-flash');
  assert.equal(parts.length, 6, 'plus prompt and taxonomy versions');
});

test('a different model does not reuse another model result', async () => {
  const cache = new AnalysisResultCache();
  const first = build({ cache, provider: countingProvider({ modelId: 'model-a' }) });
  const second = build({ cache, provider: countingProvider({ modelId: 'model-b' }) });

  await first.service.analyze({ url: URL_FOR() });
  const result = await second.service.analyze({ url: URL_FOR() });

  assert.equal(result.cache.status, CACHE_STATUS.miss);
  assert.equal(second.provider.calls.length, 1);
});

test('a different requested language is a different cache entry', async () => {
  const { service, provider } = build();

  await service.analyze({ url: URL_FOR(), language: 'en-US' });
  await service.analyze({ url: URL_FOR(), language: 'fr' });

  assert.equal(provider.calls.length, 2);
});

test('a resolved caption language is cached alongside the requested one', async () => {
  const transcripts = fakeTranscripts({ transcript: { ...TRANSCRIPT, language: 'en' } });
  const { service, provider } = build({ transcripts });

  await service.analyze({ url: URL_FOR(), language: 'en-US' });
  const byResolved = await service.analyze({ url: URL_FOR(), language: 'en' });

  assert.equal(byResolved.cache.status, CACHE_STATUS.hit);
  assert.equal(provider.calls.length, 1);
});

test('an expired entry is recomputed', async () => {
  const clock = fakeClock();
  const cache = new AnalysisResultCache({ ttlMs: 60_000, clock });
  const { service, provider } = build({ cache });

  await service.analyze({ url: URL_FOR() });
  clock.advance(60_001);
  const afterExpiry = await service.analyze({ url: URL_FOR() });

  assert.equal(afterExpiry.cache.status, CACHE_STATUS.miss);
  assert.equal(provider.calls.length, 2);
});

test('an unusable URL is rejected before any network call', async () => {
  const { service, transcripts } = build();

  await assert.rejects(() => service.analyze({ url: 'https://example.com/watch?v=demoTalk001' }), (error) => {
    assert.equal(error.code, 'INVALID_YOUTUBE_URL');
    return true;
  });

  assert.equal(transcripts.calls.length, 0);
});

test('typed ingestion failures reach the caller unchanged', async () => {
  const { service } = build({
    transcripts: fakeTranscripts({ error: new AppError('CAPTIONS_DISABLED', 'This video has captions disabled.') })
  });

  await assert.rejects(() => service.analyze({ url: URL_FOR() }), (error) => {
    assert.equal(error.code, 'CAPTIONS_DISABLED');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('an untyped internal failure is flattened, not leaked', async () => {
  const { service } = build({
    transcripts: fakeTranscripts({ error: new Error('connect ECONNREFUSED 10.0.0.5:443') })
  });

  await assert.rejects(() => service.analyze({ url: URL_FOR() }), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.equal(error.message.includes('ECONNREFUSED'), false);
    return true;
  });
});

test('a failed request is not cached and does not block the next one', async () => {
  const failing = fakeTranscripts({ error: new AppError('TRANSCRIPT_UNAVAILABLE', 'temporary') });
  const { service, cache } = build({ transcripts: failing });

  await assert.rejects(() => service.analyze({ url: URL_FOR() }));
  assert.equal(cache.describe().entries, 0);

  await assert.rejects(() => service.analyze({ url: URL_FOR() }), (error) => {
    assert.equal(error.code, 'TRANSCRIPT_UNAVAILABLE');
    return true;
  });
  assert.equal(failing.calls.length, 2, 'the in-flight entry was released after the failure');
});

test('a request that exceeds the deadline fails as UPSTREAM_TIMEOUT', async () => {
  const { service } = build({
    transcripts: fakeTranscripts({ delayMs: 5000 }),
    options: { requestTimeoutMs: 30 }
  });

  await assert.rejects(() => service.analyze({ url: URL_FOR() }), (error) => {
    assert.equal(error.code, 'UPSTREAM_TIMEOUT');
    assert.equal(error.retryable, true);
    assert.equal(error.details.timeoutMs, 30);
    return true;
  });
});

test('a caller abort cancels the work', async () => {
  const controller = new AbortController();
  const { service } = build({ transcripts: fakeTranscripts({ delayMs: 2000 }) });

  const pending = service.analyze({ url: URL_FOR(), signal: controller.signal });
  controller.abort();

  await assert.rejects(() => pending);
});

test('health reports versions and counters without secrets', async () => {
  const { service } = build();
  await service.analyze({ url: URL_FOR() });

  const health = service.health();

  assert.equal(health.analyzer.provider, 'stub');
  assert.equal(health.analyzer.schemaVersion, 1);
  assert.ok(health.analyzer.promptVersion.length > 0);
  assert.equal(health.cache.entries, 1);
  assert.equal(health.requests.cold, 1);
  assert.equal(/api[_-]?key|gemini_api/i.test(JSON.stringify(health)), false);
});

test('the service refuses obviously wrong dependencies', () => {
  assert.throws(() => createAnalysisService({ transcripts: {}, provider: countingProvider() }), TypeError);
  assert.throws(() => createAnalysisService({ transcripts: fakeTranscripts(), provider: {} }), TypeError);
});
