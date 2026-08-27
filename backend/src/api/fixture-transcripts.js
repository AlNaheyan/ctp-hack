// Fixture-backed transcript provider for mock mode.
//
// Replaces only the network boundary: it implements the same
// fetchTranscript(request) contract as the YouTube provider, so mock mode runs
// the real transcript service, the real normalizer, and the real orchestration
// - just without YouTube. Nothing here is used when ANALYSIS_MODE=live.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEFAULT_FIXTURES_DIR, FIXTURE_MANIFEST_RELATIVE_PATH } from '../config.js';
import { AppError } from '../errors.js';

/**
 * Read every valid transcript fixture named by W1-T2's manifest.
 * @param {string} fixturesDir
 * @returns {Map<string, object>} videoId -> transcript
 */
export function loadTranscriptFixtures(fixturesDir = DEFAULT_FIXTURES_DIR) {
  const manifestPath = resolve(fixturesDir, FIXTURE_MANIFEST_RELATIVE_PATH);
  /** @type {Map<string, object>} */
  const byVideoId = new Map();

  if (!existsSync(manifestPath)) return byVideoId;

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  for (const entry of manifest.fixtures ?? []) {
    if (entry.contract !== 'transcript' || entry.valid !== true) continue;

    const path = resolve(fixturesDir, entry.path);
    if (!existsSync(path)) continue;

    const transcript = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof transcript.videoId === 'string') byVideoId.set(transcript.videoId, transcript);
  }

  return byVideoId;
}

/**
 * Turn a normalized transcript fixture back into provider cues, so the
 * normalizer runs on the mock path exactly as it does on the live one.
 * @param {object} transcript
 */
export function toProviderCues(transcript) {
  return transcript.segments.map((segment) => ({
    startMs: Math.round(segment.startTime * 1000),
    durationMs: Math.round((segment.endTime - segment.startTime) * 1000),
    text: segment.text,
    speaker: segment.speaker
  }));
}

/**
 * @param {{ fixturesDir?: string }} [options]
 * @returns {{ fetchTranscript: Function, availableVideoIds: () => string[] }}
 */
export function createFixtureTranscriptProvider({ fixturesDir = DEFAULT_FIXTURES_DIR } = {}) {
  const fixtures = loadTranscriptFixtures(fixturesDir);

  return {
    availableVideoIds: () => [...fixtures.keys()].sort(),

    async fetchTranscript({ videoId, language, captionSource }) {
      const transcript = fixtures.get(videoId);

      if (transcript === undefined) {
        throw new AppError(
          'VIDEO_NOT_FOUND',
          `No transcript fixture for "${videoId}". Mock mode serves only fixtures; add one to fixtures/manifest.json, or run with ANALYSIS_MODE=live.`,
          { details: { availableVideoIds: [...fixtures.keys()].sort() } }
        );
      }

      // A caption source the fixture cannot satisfy fails the same way the real
      // provider would, so mock clients see real error handling.
      if (captionSource !== undefined && captionSource !== transcript.captionSource) {
        throw new AppError(
          'UNSUPPORTED_LANGUAGE',
          `The fixture for "${videoId}" only has ${transcript.captionSource} captions.`,
          { details: { available: [transcript.captionSource] } }
        );
      }

      const requestedBase = String(language ?? transcript.language).split('-')[0].toLowerCase();
      if (requestedBase !== transcript.language.split('-')[0].toLowerCase()) {
        throw new AppError(
          'UNSUPPORTED_LANGUAGE',
          `The fixture for "${videoId}" is ${transcript.language}, not ${language}.`,
          { details: { available: [transcript.language] } }
        );
      }

      return {
        videoId: transcript.videoId,
        language: transcript.language,
        captionSource: transcript.captionSource,
        cues: toProviderCues(transcript)
      };
    }
  };
}
