// Wiring for the analysis API.
//
// The one place that decides which transcript source and which model provider a
// configuration gets:
//
//   mock -> fixture transcripts + stub analyzer  (offline, no secrets)
//   live -> YouTube captions   + Gemini          (needs GEMINI_API_KEY)
//
// Both modes run the same transcript service, analyzer, cache, and routes; only
// the two external boundaries change.

import { MemoryTranscriptCache, createTranscriptService } from '../transcript/index.js';
import { YouTubeCaptionProvider } from '../transcript/youtube-provider.js';
import { createProvider } from '../analysis/index.js';
import { AnalysisResultCache } from './result-cache.js';
import { createAnalysisService } from './analysis-service.js';
import { createFixtureTranscriptProvider } from './fixture-transcripts.js';

/**
 * @param {object} config from loadConfig()
 * @param {{ logger?: object, env?: Record<string, string | undefined> }} [options]
 */
export function createAnalysisApiService(config, { logger, env = process.env } = {}) {
  const transcriptProvider =
    config.mode === 'live'
      ? new YouTubeCaptionProvider()
      : createFixtureTranscriptProvider({ fixturesDir: config.fixturesDir });

  const transcripts = createTranscriptService({
    provider: transcriptProvider,
    cache: new MemoryTranscriptCache({ ttlMs: config.transcriptCacheTtlMs }),
    timeoutMs: config.transcriptTimeoutMs,
    logger
  });

  const service = createAnalysisService({
    transcripts,
    // Throws an actionable ConfigError in live mode when the key is missing.
    provider: createProvider(config, env),
    cache: new AnalysisResultCache({ ttlMs: config.analysisCacheTtlMs }),
    language: config.transcriptLanguage,
    requestTimeoutMs: config.apiRequestTimeoutMs,
    logger
  });

  return {
    service,
    transcripts,
    /** Video ids servable offline, for the startup banner and docs. */
    fixtureVideoIds: config.mode === 'live' ? [] : transcriptProvider.availableVideoIds()
  };
}
