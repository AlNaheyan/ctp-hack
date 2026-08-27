// Offline tests for the Gemini adapter: fetch is injected, so nothing here
// touches the network or needs an API key.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_GEMINI_MODEL, createGeminiProvider, toGeminiSchema } from '../../src/analysis/providers/gemini.js';
import { RESPONSE_SCHEMA } from '../../src/analysis/prompt.js';

const FAKE_KEY = 'not-a-real-key'; // lint-allow-secret

const okResponse = (text) => ({
  ok: true,
  status: 200,
  async json() {
    return {
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      modelVersion: 'gemini-2.5-flash-001',
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45 }
    };
  }
});

const errorResponse = (status, status_ = undefined) => ({
  ok: false,
  status,
  async json() {
    return status_ ? { error: { status: status_, message: 'provider detail that must not leak' } } : {};
  }
});

const request = { system: 'system text', user: 'user text', responseSchema: RESPONSE_SCHEMA };

test('the neutral schema is translated into the provider dialect', () => {
  const translated = toGeminiSchema(RESPONSE_SCHEMA);

  assert.equal(translated.type, 'OBJECT');
  assert.equal(translated.properties.findings.type, 'ARRAY');
  assert.equal(translated.properties.findings.items.type, 'OBJECT');
  assert.equal(translated.properties.findings.items.properties.confidence.type, 'NUMBER');
  assert.deepEqual(translated.propertyOrdering, ['findings']);
  assert.ok(translated.properties.findings.items.properties.type.enum.includes('strawman'));
});

test('the request carries the key as a header and asks for structured JSON', async () => {
  let seen;
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return okResponse('{"findings":[]}');
    }
  });

  const result = await provider.generate(request);

  assert.match(seen.url, /models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(seen.init.headers['x-goog-api-key'], FAKE_KEY);
  assert.equal(seen.url.includes(FAKE_KEY), false, 'the key never lands in the URL');

  const body = JSON.parse(seen.init.body);
  assert.equal(body.systemInstruction.parts[0].text, 'system text');
  assert.equal(body.contents[0].parts[0].text, 'user text');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');

  assert.equal(result.text, '{"findings":[]}');
  assert.equal(result.modelId, 'gemini-2.5-flash-001');
  assert.deepEqual(result.usage, { promptTokens: 120, responseTokens: 45 });
});

test('the model id is configurable and reported', () => {
  const provider = createGeminiProvider({ apiKey: FAKE_KEY, model: 'gemini-2.5-pro' });

  assert.equal(provider.modelId, 'gemini-2.5-pro');
  assert.equal(createGeminiProvider({ apiKey: FAKE_KEY }).modelId, DEFAULT_GEMINI_MODEL);
});

test('a missing key is a programming error, caught before any request', () => {
  assert.throws(() => createGeminiProvider({ apiKey: '' }), (error) => {
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.match(error.message, /requireSecret/);
    return true;
  });
});

test('HTTP failures map onto contract error codes without leaking the body', async () => {
  const cases = [
    [401, 'UNAUTHENTICATED', false],
    [403, 'PERMISSION_DENIED', false],
    [429, 'RESOURCE_EXHAUSTED', true],
    [500, 'INTERNAL', true],
    [400, 'INVALID_ARGUMENT', false]
  ];

  for (const [status, providerStatus, retryable] of cases) {
    const provider = createGeminiProvider({
      apiKey: FAKE_KEY,
      fetchImpl: async () => errorResponse(status, providerStatus)
    });

    await assert.rejects(() => provider.generate(request), (error) => {
      assert.equal(error.code, 'ANALYSIS_FAILED', `status ${status}`);
      assert.equal(error.retryable, retryable, `status ${status}`);
      assert.equal(error.details.providerStatus, providerStatus);
      assert.equal(/provider detail that must not leak/.test(JSON.stringify(error.details)), false);
      assert.equal(error.message.includes(FAKE_KEY), false, 'the key never reaches an error message');
      return true;
    });
  }
});

test('a credential rejection points at .env without printing the value', async () => {
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: async () => errorResponse(401, 'UNAUTHENTICATED')
  });

  await assert.rejects(() => provider.generate(request), (error) => {
    assert.match(error.message, /GEMINI_API_KEY in \.env/);
    assert.match(error.message, /never logged/);
    return true;
  });
});

test('a network failure or hang becomes UPSTREAM_TIMEOUT', async () => {
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    timeoutMs: 25,
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
  });

  await assert.rejects(() => provider.generate(request), (error) => {
    assert.equal(error.code, 'UPSTREAM_TIMEOUT');
    assert.equal(error.details.timeoutMs, 25);
    return true;
  });
});

test('a caller-cancelled request is not reported as a timeout', async () => {
  const controller = new AbortController();
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: (url, init) =>
      new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        controller.abort();
      })
  });

  await assert.rejects(() => provider.generate({ ...request, signal: controller.signal }), (error) => {
    assert.equal(error.code, 'ANALYSIS_FAILED');
    assert.match(error.message, /cancelled/);
    return true;
  });
});

test('a safety block is reported with its reason', async () => {
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { promptFeedback: { blockReason: 'SAFETY' } };
      }
    })
  });

  await assert.rejects(() => provider.generate(request), (error) => {
    assert.equal(error.code, 'ANALYSIS_FAILED');
    assert.equal(error.details.blockReason, 'SAFETY');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('an empty completion is retryable rather than silently empty', async () => {
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] };
      }
    })
  });

  await assert.rejects(() => provider.generate(request), (error) => {
    assert.equal(error.code, 'ANALYSIS_FAILED');
    assert.equal(error.retryable, true);
    assert.equal(error.details.finishReason, 'MAX_TOKENS');
    return true;
  });
});

test('multi-part responses are concatenated', async () => {
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { candidates: [{ content: { parts: [{ text: '{"findings"' }, { text: ':[]}' }] } }] };
      }
    })
  });

  assert.equal((await provider.generate(request)).text, '{"findings":[]}');
});
