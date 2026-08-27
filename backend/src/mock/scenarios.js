// Failure and latency simulation for the mock API.
//
// Every lane can reproduce a slow start, a missing transcript, or a backend
// outage without touching YouTube or Gemini. Scenarios are mock-only; the real
// API (W3-T1) reaches these states for real reasons.

import { AppError, SCHEMA_VERSION } from '../errors.js';
import { SCENARIOS } from '../config.js';

export { SCENARIOS };

/** @type {Record<string, string>} */
export const SCENARIO_DESCRIPTIONS = {
  ok: 'Return the golden analysis fixture.',
  processing: '202 with a retry hint, for the submitting/processing UI states.',
  no_transcript: '422 TRANSCRIPT_UNAVAILABLE, for the no-transcript state.',
  rate_limited: '429 RATE_LIMITED with a retry hint.',
  backend_error: '502 ANALYSIS_FAILED, for the backend-error state.',
  upstream_timeout: '504 UPSTREAM_TIMEOUT, for the offline/timeout state.'
};

/**
 * Pick the scenario for one request: query, then header, then config default.
 * @param {URL} url
 * @param {import('node:http').IncomingMessage} request
 * @param {{ mockScenario: string }} config
 */
export function resolveScenario(url, request, config) {
  const requested =
    url.searchParams.get('scenario') ??
    (typeof request.headers['x-mock-scenario'] === 'string'
      ? request.headers['x-mock-scenario']
      : null);

  if (requested === null || requested === '') return config.mockScenario;

  const scenario = requested.toLowerCase();
  if (!SCENARIOS.includes(scenario)) {
    throw new AppError(
      'INVALID_REQUEST',
      `Unknown scenario "${requested}". Use one of: ${SCENARIOS.join(', ')}.`
    );
  }
  return scenario;
}

/**
 * Per-request latency override, for exercising loading states.
 * @param {URL} url
 * @param {{ mockLatencyMs: number }} config
 */
export function resolveLatencyMs(url, config) {
  const requested = url.searchParams.get('latencyMs');
  if (requested === null) return config.mockLatencyMs;

  const parsed = Number(requested);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60000) {
    throw new AppError('INVALID_REQUEST', 'latencyMs must be an integer between 0 and 60000.');
  }
  return parsed;
}

/**
 * Apply a non-ok scenario.
 * @param {string} scenario
 * @param {string} videoId
 * @returns {{ status: number, body: unknown, headers?: Record<string, string> } | null}
 *   null means "carry on and serve the fixture"
 */
export function applyScenario(scenario, videoId) {
  switch (scenario) {
    case 'ok':
      return null;
    case 'processing':
      // PROVISIONAL shape: W3-T1 owns the real async contract if it needs one.
      return {
        status: 202,
        headers: { 'retry-after': '3' },
        body: {
          schemaVersion: SCHEMA_VERSION,
          status: 'processing',
          videoId,
          retryAfterSeconds: 3
        }
      };
    case 'no_transcript':
      throw new AppError(
        'TRANSCRIPT_UNAVAILABLE',
        'This video has no usable captions. Try another video or a different caption language.'
      );
    case 'rate_limited':
      throw new AppError('RATE_LIMITED', 'Too many analysis requests. Retry in a few seconds.');
    case 'backend_error':
      throw new AppError('ANALYSIS_FAILED', 'The analysis provider returned an unusable response.');
    case 'upstream_timeout':
      throw new AppError('UPSTREAM_TIMEOUT', 'The analysis request timed out. Retry the submission.');
    default:
      throw new AppError('INVALID_REQUEST', `Unknown scenario "${scenario}".`);
  }
}
