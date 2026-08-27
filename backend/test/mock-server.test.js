import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { startMockServer } from '../src/mock/server.js';

const DEMO_VIDEO_ID = 'demoTalk001';
const DEMO_URL = `https://www.youtube.com/watch?v=${DEMO_VIDEO_ID}`;

let mock;

const silentLogger = createLogger({ level: 'error', stream: { write() {} } });

before(async () => {
  mock = await startMockServer({
    config: loadConfig({ PORT: '0', HOST: '127.0.0.1' }),
    logger: silentLogger
  });
});

after(async () => {
  await mock.close();
});

const post = (path, body, init = {}) =>
  fetch(`${mock.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body)
  });

test('GET /healthz reports mode and available fixtures without secrets', async () => {
  const response = await fetch(`${mock.url}/healthz`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.mode, 'mock');
  assert.ok(body.availableVideoIds.includes(DEMO_VIDEO_ID));
  assert.equal(JSON.stringify(body).toLowerCase().includes('api_key'), false);
});

test('GET /v1/fixtures lists ids and scenarios', async () => {
  const response = await fetch(`${mock.url}/v1/fixtures`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.availableVideoIds.includes(DEMO_VIDEO_ID));
  assert.ok(Object.keys(body.scenarios).includes('no_transcript'));
});

test('POST /v1/analyze serves the golden fixture for a watch URL', async () => {
  const response = await post('/v1/analyze', { url: DEMO_URL });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.videoId, DEMO_VIDEO_ID);
  assert.ok(body.events.length > 0);
  assert.equal(response.headers.get('x-analysis-cache'), 'hit');
});

test('forceRefresh is visible to the caller', async () => {
  const response = await post('/v1/analyze', { url: DEMO_URL, forceRefresh: true });
  await response.body?.cancel();
  assert.equal(response.headers.get('x-analysis-cache'), 'bypass');
});

test('GET /v1/analysis/:videoId returns the same payload', async () => {
  const [fromPost, fromGet] = await Promise.all([
    post('/v1/analyze', { url: DEMO_URL }).then((r) => r.json()),
    fetch(`${mock.url}/v1/analysis/${DEMO_VIDEO_ID}`).then((r) => r.json())
  ]);
  assert.deepEqual(fromGet, fromPost);
});

test('a bare video id is accepted', async () => {
  const response = await post('/v1/analyze', { videoId: DEMO_VIDEO_ID });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.videoId, DEMO_VIDEO_ID);
});

test('a non-YouTube host is rejected with a typed error', async () => {
  const response = await post('/v1/analyze', { url: 'https://example.com/watch?v=dQw4w9WgXcQ' });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.error.code, 'INVALID_YOUTUBE_URL');
  assert.equal(body.error.retryable, false);
});

test('an unreadable URL is rejected with INVALID_YOUTUBE_URL', async () => {
  const response = await post('/v1/analyze', { url: 'https://www.youtube.com/feed/subscriptions' });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_YOUTUBE_URL');
});

test('a missing fixture returns a mock-specific typed error', async () => {
  const response = await post('/v1/analyze', { videoId: 'abcdefghijk' });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'VIDEO_NOT_FOUND');
  assert.ok(body.error.details.availableVideoIds.includes(DEMO_VIDEO_ID));
});

test('failure scenarios are reproducible per request', async () => {
  const cases = [
    ['no_transcript', 422, 'TRANSCRIPT_UNAVAILABLE', false],
    ['rate_limited', 429, 'ANALYSIS_FAILED', true],
    ['backend_error', 502, 'ANALYSIS_FAILED', true],
    ['upstream_timeout', 504, 'UPSTREAM_TIMEOUT', true]
  ];

  for (const [scenario, status, code, retryable] of cases) {
    const response = await post(`/v1/analyze?scenario=${scenario}`, { url: DEMO_URL });
    const body = await response.json();
    assert.equal(response.status, status, scenario);
    assert.equal(body.error.code, code, scenario);
    assert.equal(body.error.retryable, retryable, scenario);
  }
});

test('the processing scenario returns 202 with a retry hint', async () => {
  const response = await post('/v1/analyze?scenario=processing', { url: DEMO_URL });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.status, 'processing');
  assert.equal(response.headers.get('retry-after'), '3');
});

test('the scenario header works for clients that cannot set a query string', async () => {
  const response = await post('/v1/analyze', { url: DEMO_URL }, { headers: { 'x-mock-scenario': 'backend_error' } });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(body.error.code, 'ANALYSIS_FAILED');
});

test('an unknown scenario is rejected', async () => {
  const response = await post('/v1/analyze?scenario=explode', { url: DEMO_URL });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_REQUEST');
});

test('per-request latency is bounded and honoured', async () => {
  const startedAt = Date.now();
  const response = await post('/v1/analyze?latencyMs=120', { url: DEMO_URL });
  await response.body?.cancel();
  assert.ok(Date.now() - startedAt >= 100, 'expected the injected delay');

  const rejected = await post('/v1/analyze?latencyMs=999999', { url: DEMO_URL });
  const body = await rejected.json();
  assert.equal(rejected.status, 400);
  assert.equal(body.error.code, 'INVALID_REQUEST');
});

test('a malformed body is rejected before parsing a URL', async () => {
  const response = await fetch(`${mock.url}/v1/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json'
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_REQUEST');
});

test('an oversized body is rejected', async () => {
  const response = await fetch(`${mock.url}/v1/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: DEMO_URL, padding: 'x'.repeat(70 * 1024) })
  });
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.error.code, 'INVALID_REQUEST');
});

test('unknown routes explain what exists', async () => {
  const response = await fetch(`${mock.url}/v1/nope`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'INVALID_REQUEST');
  assert.match(body.error.message, /\/healthz/);
});

test('CORS preflight succeeds so the extension can call the mock', async () => {
  const response = await fetch(`${mock.url}/v1/analyze`, { method: 'OPTIONS' });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});
