// End-to-end HTTP tests over the real wiring: fixture transcripts, the offline
// stub analyzer, the real cache, and the real routes. No network, no key.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { validateAgainstSchema } from '../../src/analysis/contract.js';
import { validateAnalysisResponse } from '../../src/analysis/contract.js';
import { createAnalysisApiService } from '../../src/api/factory.js';
import { startApiServer } from '../../src/api/server.js';

const VIDEO_ID = 'demoTalk001';
const URL_FOR = (videoId = VIDEO_ID) => `https://www.youtube.com/watch?v=${videoId}`;

const config = loadConfig({ ANALYSIS_MODE: 'mock', PORT: '0', HOST: '127.0.0.1' });
const silentLogger = createLogger({ level: 'error', stream: { write() {} } });

let api;
let service;

before(async () => {
  ({ service } = createAnalysisApiService(config, { logger: silentLogger, env: {} }));
  api = await startApiServer({ service, config, logger: silentLogger });
});

after(async () => {
  await api.close();
});

const post = (path, body) =>
  fetch(`${api.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

test('GET /healthz reports mode, versions, and counters without secrets', async () => {
  const response = await fetch(`${api.url}/healthz`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.mode, 'mock');
  assert.equal(body.analyzer.provider, 'stub');
  assert.equal(body.analyzer.schemaVersion, 1);
  assert.ok(Number.isInteger(body.cache.entries));
  assert.match(response.headers.get('x-request-id'), /^req_[A-Za-z0-9]+$/);
  assert.equal(/api[_-]?key/i.test(JSON.stringify(body)), false);
});

test('POST /v1/analyze turns a watch URL into a contract-valid timeline', async () => {
  const response = await post('/v1/analyze', { url: URL_FOR() });
  const analysis = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(validateAnalysisResponse(analysis), { valid: true, errors: [] });
  assert.equal(analysis.videoId, VIDEO_ID);
  assert.ok(analysis.events.length > 0);

  assert.equal(response.headers.get('x-analysis-cache'), 'miss');
  assert.equal(response.headers.get('x-analysis-model'), 'stub-rules-1.0.0');
  assert.ok(response.headers.get('x-analysis-prompt-version'));
  assert.match(response.headers.get('cache-control'), /^private, max-age=\d+$/);
  assert.equal(response.headers.get('age'), '0');
});

test('payload logging records the exact successful body returned to the frontend', async () => {
  const lines = [];
  const payloadConfig = loadConfig({
    ANALYSIS_MODE: 'mock',
    PORT: '0',
    HOST: '127.0.0.1',
    LOG_PAYLOADS: 'true'
  });
  const payloadLogger = createLogger({
    level: 'info',
    stream: { write(line) { lines.push(JSON.parse(line)); } }
  });
  const wired = createAnalysisApiService(payloadConfig, { logger: payloadLogger, env: {} });
  const isolated = await startApiServer({ service: wired.service, config: payloadConfig, logger: payloadLogger });

  try {
    const response = await fetch(`${isolated.url}/v1/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: URL_FOR() })
    });
    const body = await response.json();
    const payloadLog = lines.find(({ message }) => message === 'frontend response payload');
    assert.deepEqual(payloadLog.response, body);
  } finally {
    await isolated.close();
  }
});

test('the second request is served from cache', async () => {
  const response = await post('/v1/analyze', { url: URL_FOR() });
  await response.body?.cancel();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-analysis-cache'), 'hit');
});

test('GET /v1/analysis/:videoId returns the same payload', async () => {
  const [fromPost, fromGet] = await Promise.all([
    post('/v1/analyze', { url: URL_FOR() }).then((response) => response.json()),
    fetch(`${api.url}/v1/analysis/${VIDEO_ID}`).then((response) => response.json())
  ]);

  assert.deepEqual(fromGet, fromPost);
});

test('forceRefresh bypasses the cache from body or query', async () => {
  const fromBody = await post('/v1/analyze', { url: URL_FOR(), forceRefresh: true });
  await fromBody.body?.cancel();
  assert.equal(fromBody.headers.get('x-analysis-cache'), 'bypass');

  const fromQuery = await fetch(`${api.url}/v1/analysis/${VIDEO_ID}?forceRefresh=1`);
  await fromQuery.body?.cancel();
  assert.equal(fromQuery.headers.get('x-analysis-cache'), 'bypass');
});

test('concurrent identical requests run at most one analysis job', async () => {
  const fresh = createAnalysisApiService(config, { logger: silentLogger, env: {} });
  const isolated = await startApiServer({ service: fresh.service, config, logger: silentLogger });

  try {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        fetch(`${isolated.url}/v1/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: URL_FOR() })
        })
      )
    );

    for (const response of responses) {
      assert.equal(response.status, 200);
      await response.body?.cancel();
    }

    const statuses = responses.map((response) => response.headers.get('x-analysis-cache'));
    assert.equal(statuses.filter((status) => status === 'miss').length, 1, 'exactly one cold request');
    assert.equal(fresh.service.health().requests.cold, 1);
  } finally {
    await isolated.close();
  }
});

test('a non-YouTube URL is a typed 400 that matches the error contract', async () => {
  const response = await post('/v1/analyze', { url: 'https://vimeo.com/watch?v=demoTalk001' });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_YOUTUBE_URL');
  assert.equal(body.error.retryable, false);
  assert.deepEqual(validateAgainstSchema(body, 'api-error'), []);
  assert.equal(body.error.requestId, response.headers.get('x-request-id'));
});

test('a video with no fixture is a typed 404 in mock mode', async () => {
  const response = await post('/v1/analyze', { videoId: 'missingVid1' });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'VIDEO_NOT_FOUND');
  assert.deepEqual(validateAgainstSchema(body, 'api-error'), []);
  assert.ok(body.error.details.availableVideoIds.includes(VIDEO_ID));
});

test('an unsupported language is typed and contract-shaped', async () => {
  const response = await post('/v1/analyze', { url: URL_FOR(), language: 'de' });
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, 'UNSUPPORTED_LANGUAGE');
  assert.deepEqual(validateAgainstSchema(body, 'api-error'), []);
});

test('malformed and oversized bodies are rejected', async () => {
  const malformed = await post('/v1/analyze', '{not json');
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 400);
  assert.equal(malformedBody.error.code, 'INVALID_REQUEST');

  const oversized = await post('/v1/analyze', { url: URL_FOR(), padding: 'x'.repeat(70 * 1024) });
  const oversizedBody = await oversized.json();
  assert.equal(oversized.status, 413);
  assert.equal(oversizedBody.error.code, 'INVALID_REQUEST');
});

test('a missing URL is rejected before any work', async () => {
  const response = await post('/v1/analyze', {});
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'INVALID_YOUTUBE_URL');
});

test('unknown routes explain what exists', async () => {
  const response = await fetch(`${api.url}/v1/nope`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'INVALID_REQUEST');
  assert.match(body.error.message, /\/v1\/analyze/);
});

test('CORS preflight succeeds so the extension can call the API', async () => {
  const response = await fetch(`${api.url}/v1/analyze`, { method: 'OPTIONS' });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('every request carries a correlation id', async () => {
  const first = await fetch(`${api.url}/healthz`);
  const second = await fetch(`${api.url}/healthz`);
  await Promise.all([first.body?.cancel(), second.body?.cancel()]);

  assert.notEqual(first.headers.get('x-request-id'), second.headers.get('x-request-id'));
});
