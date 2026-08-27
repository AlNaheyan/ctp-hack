import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_FIXTURES_DIR,
  assertSecretsForMode,
  describeConfig,
  describeSecrets,
  loadConfig,
  redact,
  requireSecret
} from '../src/config.js';
import { parseEnvFile } from '../src/env.js';
import { ConfigError } from '../src/errors.js';

test('defaults to mock mode with no environment set', () => {
  const config = loadConfig({});
  assert.equal(config.mode, 'mock');
  assert.equal(config.port, 8787);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.fixturesDir, DEFAULT_FIXTURES_DIR);
  assert.equal(config.mockScenario, 'ok');
  assert.equal(config.mockLatencyMs, 0);
});

test('rejects an unknown mode with an actionable message', () => {
  assert.throws(() => loadConfig({ ANALYSIS_MODE: 'production' }), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /ANALYSIS_MODE must be one of mock \| live/);
    assert.match(error.message, /\.env\.example/);
    return true;
  });
});

test('rejects a non-numeric port', () => {
  assert.throws(() => loadConfig({ PORT: 'eight' }), /PORT must be an integer/);
});

test('mock mode requires no secrets', () => {
  assert.deepEqual(assertSecretsForMode(loadConfig({}), {}), []);
});

test('live mode without a key fails with an actionable, value-free message', () => {
  const config = loadConfig({ ANALYSIS_MODE: 'live' });
  assert.throws(() => assertSecretsForMode(config, {}), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /Missing required secret GEMINI_API_KEY/);
    assert.match(error.message, /cp \.env\.example \.env/);
    assert.match(error.message, /ANALYSIS_MODE=mock/);
    return true;
  });
});

test('a missing secret error never contains the value of another secret', () => {
  const env = { OTHER_SECRET: 'super-secret-value' };
  try {
    requireSecret('GEMINI_API_KEY', env);
    assert.fail('expected requireSecret to throw');
  } catch (error) {
    assert.doesNotMatch(error.message, /super-secret-value/);
  }
});

test('live mode passes once the key is present', () => {
  const config = loadConfig({ ANALYSIS_MODE: 'live' });
  // lint-allow-secret: deliberate fake value, never a real credential.
  assert.deepEqual(assertSecretsForMode(config, { GEMINI_API_KEY: 'not-a-real-key' }), ['GEMINI_API_KEY']);
});

test('secret reporting shows presence only', () => {
  const described = describeSecrets({ GEMINI_API_KEY: 'AIzaTotallyRealKeyValue' });
  assert.deepEqual(described.map((entry) => entry.status), ['set (value hidden)']);
  assert.equal(JSON.stringify(described).includes('AIzaTotallyRealKeyValue'), false);
});

test('startup summary never renders a secret value', () => {
  const summary = describeConfig(loadConfig({}), { GEMINI_API_KEY: 'AIzaTotallyRealKeyValue' }).join('\n');
  assert.equal(summary.includes('AIzaTotallyRealKeyValue'), false);
  assert.match(summary, /GEMINI_API_KEY\s+set \(value hidden\)/);
});

test('redact keeps at most a four character prefix', () => {
  assert.equal(redact('AIzaSyLongLookingSecretValue'), 'AIza...<redacted>');
  assert.equal(redact('short'), '<redacted>');
  assert.equal(redact(''), '<unset>');
  assert.equal(redact(undefined), '<unset>');
});

test('env file parsing handles comments, quotes, and export', () => {
  const parsed = parseEnvFile(
    [
      '# comment',
      'ANALYSIS_MODE=mock',
      'export PORT=9000',
      'QUOTED="spaced value"',
      "SINGLE='another'",
      'TRAILING=value # trailing comment',
      'EMPTY=',
      'not a pair'
    ].join('\n')
  );

  assert.deepEqual(parsed, {
    ANALYSIS_MODE: 'mock',
    PORT: '9000',
    QUOTED: 'spaced value',
    SINGLE: 'another',
    TRAILING: 'value',
    EMPTY: ''
  });
});
