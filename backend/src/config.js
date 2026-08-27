// Single source of truth for runtime configuration, fixture locations, and
// secret handling. Every other module reads config from here.

import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigError } from './errors.js';
import { loadEnvFile } from './env.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Repository root, derived from this file's location (backend/src/config.js). */
export const REPO_ROOT = resolve(moduleDir, '..', '..');

/**
 * Canonical fixtures directory, owned by W1-T2.
 * Nothing in this repo may keep a second copy of a fixture; point here instead.
 */
export const DEFAULT_FIXTURES_DIR = resolve(REPO_ROOT, 'fixtures');

/**
 * Fixture lookup order for one analysis payload, relative to the fixtures dir.
 * REBASE POINT: if W1-T2 lands a different layout, edit only this list.
 * @param {string} videoId
 * @returns {string[]}
 */
export function analysisFixtureRelativePaths(videoId) {
  return [
    `analysis/valid/${videoId}.json`,
    `analysis/${videoId}.json`,
    `analysis/valid/analysis-${videoId}.json`
  ];
}

/** Directory scanned to list which video ids the mock can serve. */
export const ANALYSIS_FIXTURE_DIRS = ['analysis/valid', 'analysis'];

export const MODES = Object.freeze(['mock', 'live']);
export const SCENARIOS = Object.freeze([
  'ok',
  'processing',
  'no_transcript',
  'rate_limited',
  'backend_error',
  'upstream_timeout'
]);

const DEFAULTS = Object.freeze({
  ANALYSIS_MODE: 'mock',
  PORT: '8787',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'info',
  MOCK_LATENCY_MS: '0',
  MOCK_SCENARIO: 'ok'
});

/** Secrets that live mode needs, with the reason shown when one is missing. */
export const REQUIRED_LIVE_SECRETS = Object.freeze({
  GEMINI_API_KEY: 'structured argument analysis (W2-T2)'
});

/**
 * Read `.env` (repo root) into process.env without overwriting real env vars.
 * @param {Record<string, string | undefined>} [target]
 */
export function loadDotEnv(target = process.env) {
  return loadEnvFile(resolve(REPO_ROOT, '.env'), target);
}

function parseInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(
      `${name} must be an integer between ${min} and ${max}. Got "${value}". Fix it in .env (see .env.example).`
    );
  }
  return parsed;
}

/**
 * Build the frozen runtime config. Throws ConfigError with an actionable
 * message - never the offending secret value - when something is unusable.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const read = (key) => {
    const value = env[key];
    return value === undefined || value === '' ? DEFAULTS[key] : value;
  };

  const mode = String(read('ANALYSIS_MODE')).toLowerCase();
  if (!MODES.includes(mode)) {
    throw new ConfigError(
      `ANALYSIS_MODE must be one of ${MODES.join(' | ')}. Got "${mode}". Fix it in .env (see .env.example).`
    );
  }

  const scenario = String(read('MOCK_SCENARIO')).toLowerCase();
  if (!SCENARIOS.includes(scenario)) {
    throw new ConfigError(
      `MOCK_SCENARIO must be one of ${SCENARIOS.join(' | ')}. Got "${scenario}". Fix it in .env (see .env.example).`
    );
  }

  const fixturesDirRaw = env.FIXTURES_DIR;
  const fixturesDir =
    fixturesDirRaw === undefined || fixturesDirRaw === ''
      ? DEFAULT_FIXTURES_DIR
      : isAbsolute(fixturesDirRaw)
        ? fixturesDirRaw
        : resolve(REPO_ROOT, fixturesDirRaw);

  return Object.freeze({
    mode,
    port: parseInteger(read('PORT'), 'PORT', { min: 0, max: 65535 }),
    host: String(read('HOST')),
    logLevel: String(read('LOG_LEVEL')).toLowerCase(),
    fixturesDir,
    mockLatencyMs: parseInteger(read('MOCK_LATENCY_MS'), 'MOCK_LATENCY_MS', { min: 0, max: 60000 }),
    mockScenario: scenario
  });
}

/**
 * Fetch a required secret. Missing secrets fail loudly and actionably; the
 * value itself is never echoed, logged, or attached to the error.
 * @param {string} name
 * @param {Record<string, string | undefined>} [env]
 */
export function requireSecret(name, env = process.env) {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    const reason = REQUIRED_LIVE_SECRETS[name];
    throw new ConfigError(
      [
        `Missing required secret ${name}${reason ? ` (needed for ${reason})` : ''}.`,
        'Fix: cp .env.example .env, then set',
        `${name}=<your key>`,
        'in .env. Keep it out of git, the extension, and the app bundle.',
        'No secret is needed while ANALYSIS_MODE=mock.'
      ].join(' ')
    );
  }
  return value;
}

/**
 * Validate every secret a mode needs, up front, so startup fails before any
 * request does. Mock mode requires nothing.
 * @param {{ mode: string }} config
 * @param {Record<string, string | undefined>} [env]
 */
export function assertSecretsForMode(config, env = process.env) {
  if (config.mode !== 'live') return [];
  return Object.keys(REQUIRED_LIVE_SECRETS).map((name) => {
    requireSecret(name, env);
    return name;
  });
}

/** Presence-only secret report. Values are never rendered. */
export function describeSecrets(env = process.env) {
  return Object.entries(REQUIRED_LIVE_SECRETS).map(([name, reason]) => {
    const value = env[name];
    const present = value !== undefined && value.trim() !== '';
    return { name, reason, status: present ? 'set (value hidden)' : 'missing' };
  });
}

/**
 * Redact a secret-ish value for logs: never more than a 4-character prefix.
 * @param {unknown} value
 */
export function redact(value) {
  if (value === undefined || value === null || value === '') return '<unset>';
  const text = String(value);
  if (text.length <= 8) return '<redacted>';
  return `${text.slice(0, 4)}...<redacted>`;
}

/** Human-readable startup summary. Contains no secret values. */
export function describeConfig(config, env = process.env) {
  return [
    `mode           ${config.mode}${config.mode === 'mock' ? ' (no secrets required)' : ''}`,
    `listen         http://${config.host}:${config.port}`,
    `fixtures       ${config.fixturesDir}`,
    `log level      ${config.logLevel}`,
    `mock scenario  ${config.mockScenario}`,
    `mock latency   ${config.mockLatencyMs} ms`,
    ...describeSecrets(env).map((secret) => `${secret.name.padEnd(14)} ${secret.status}`)
  ];
}
