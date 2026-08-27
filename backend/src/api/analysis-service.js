// Analysis orchestration.
//
//   URL -> video id -> transcript (W2-T1) -> analysis (W2-T2) -> 24 h cache
//
// The only place that composes the two Wave 2 services. It owns the final
// cache, request coalescing, and the overall request deadline; it owns no HTTP
// concepts, so it stays testable without a server.

import { AppError } from '../errors.js';
import { PROMPT_VERSION, TAXONOMY_VERSION, ANALYSIS_SCHEMA_VERSION, analyzeTranscript } from '../analysis/index.js';
import { requireVideoId } from '../transcript/video-url.js';
import { AnalysisResultCache } from './result-cache.js';

/** A cold request must finish inside this budget, transcript and model included. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

export const CACHE_STATUS = Object.freeze({
  hit: 'hit',
  miss: 'miss',
  bypass: 'bypass',
  coalesced: 'coalesced'
});

const silentLogger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

/**
 * Cache identity for a request, known before any network call.
 *
 * Includes everything the roadmap requires - video, language, schema version,
 * model, prompt version - plus the taxonomy version, because changing what an
 * insight type means invalidates a stored timeline just as surely.
 */
export function buildCacheKey({ videoId, language, modelId }) {
  return [
    videoId,
    String(language).toLowerCase(),
    `schema${ANALYSIS_SCHEMA_VERSION}`,
    modelId,
    PROMPT_VERSION,
    TAXONOMY_VERSION
  ].join('|');
}

/**
 * @param {object} options
 * @param {{ getTranscript: Function }} options.transcripts W2-T1 service
 * @param {import('../analysis/providers/index.js').ModelProvider} options.provider W2-T2 provider
 * @param {AnalysisResultCache} [options.cache]
 * @param {string} [options.language] default caption language
 * @param {number} [options.requestTimeoutMs]
 * @param {() => Date} [options.now] injected clock for deterministic tests
 * @param {object} [options.logger]
 * @param {boolean} [options.logPayloads]
 */
export function createAnalysisService({
  transcripts,
  provider,
  cache = new AnalysisResultCache(),
  language: defaultLanguage = 'en-US',
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  now = () => new Date(),
  logger = silentLogger,
  logPayloads = false
}) {
  if (typeof transcripts?.getTranscript !== 'function') {
    throw new TypeError('transcripts must implement getTranscript(request)');
  }
  if (typeof provider?.generate !== 'function') {
    throw new TypeError('provider must implement generate(request)');
  }

  /** Coalescing map: one running job per cache key. */
  const inFlight = new Map();
  const stats = { requests: 0, coalesced: 0, cold: 0, failures: 0 };

  /** Produce a fresh analysis. Only ever called once per key at a time. */
  async function produce({ videoId, language, signal }) {
    const transcript = await transcripts.getTranscript({ videoId, language, signal });

    const { analysis, meta } = await analyzeTranscript(transcript, {
      provider,
      title: transcript.title,
      now,
      signal,
      logger,
      logPayloads
    });

    return { analysis, meta, transcriptLanguage: transcript.language };
  }

  /**
   * Analyse one video.
   *
   * @param {object} request
   * @param {string} [request.url] YouTube watch URL
   * @param {string} [request.videoId] canonical id, accepted instead of a URL
   * @param {string} [request.language] BCP 47 caption preference
   * @param {boolean} [request.forceRefresh] skip the cache read and recompute
   * @param {AbortSignal} [request.signal]
   * @returns {Promise<{ analysis: object, meta: object, cache: object }>}
   */
  async function analyze({ url, videoId: suppliedVideoId, language, forceRefresh = false, signal } = {}) {
    stats.requests += 1;

    // Rejects INVALID_YOUTUBE_URL before any network call or model spend.
    const videoId = requireVideoId(url ?? suppliedVideoId);
    const requestedLanguage = language ?? defaultLanguage;
    const key = buildCacheKey({ videoId, language: requestedLanguage, modelId: provider.modelId });

    if (!forceRefresh) {
      const cached = cache.get(key);
      if (cached !== undefined) {
        logger.debug('analysis cache hit', { videoId, cacheKey: key, ageSeconds: cached.ageSeconds });
        return {
          analysis: cached.analysis,
          meta: cached.meta,
          cache: {
            status: CACHE_STATUS.hit,
            key,
            storedAt: new Date(cached.storedAt).toISOString(),
            expiresAt: new Date(cached.expiresAt).toISOString(),
            ageSeconds: cached.ageSeconds,
            expiresInSeconds: cached.expiresInSeconds
          }
        };
      }
    }

    const running = inFlight.get(key);
    if (running !== undefined) {
      // Someone is already analysing this video: wait for their result rather
      // than starting a second transcript fetch and a second model job.
      stats.coalesced += 1;
      logger.debug('analysis request coalesced', { videoId, cacheKey: key });
      const shared = await running;
      return { ...shared, cache: { ...shared.cache, status: CACHE_STATUS.coalesced } };
    }

    const deadline = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      deadline.abort(new Error('analysis request timeout'));
    }, requestTimeoutMs);

    const abortFromCaller = () => deadline.abort(signal.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });

    stats.cold += 1;

    const job = (async () => {
      const startedAt = Date.now();
      const { analysis, meta, transcriptLanguage } = await produce({
        videoId,
        language: requestedLanguage,
        signal: deadline.signal
      });

      cache.set(key, { analysis, meta });

      // The caption track may resolve to a different language than requested
      // (en-US -> en). Store it under both so the next request hits either way.
      const resolvedKey = buildCacheKey({ videoId, language: transcriptLanguage, modelId: provider.modelId });
      if (resolvedKey !== key) cache.set(resolvedKey, { analysis, meta });

      const stored = cache.get(key);

      logger.info('analysis produced', {
        videoId,
        cacheKey: key,
        events: analysis.events.length,
        model: meta.modelId,
        durationMs: Date.now() - startedAt
      });

      return {
        analysis,
        meta,
        cache: {
          status: forceRefresh ? CACHE_STATUS.bypass : CACHE_STATUS.miss,
          key,
          storedAt: new Date(stored?.storedAt ?? Date.now()).toISOString(),
          expiresAt: new Date(stored?.expiresAt ?? Date.now()).toISOString(),
          ageSeconds: 0,
          expiresInSeconds: stored?.expiresInSeconds ?? 0
        }
      };
    })();

    inFlight.set(key, job);

    try {
      return await job;
    } catch (error) {
      stats.failures += 1;

      if (timedOut) {
        throw new AppError('UPSTREAM_TIMEOUT', `The analysis request exceeded ${requestTimeoutMs} ms.`, {
          cause: error,
          details: { timeoutMs: requestTimeoutMs }
        });
      }
      if (error instanceof AppError) throw error;

      // Anything untyped is a bug here, not a provider failure: never let an
      // internal message or stack reach the client.
      logger.error('analysis failed', { videoId, message: error?.message });
      throw new AppError('INTERNAL_ERROR', 'The analysis could not be completed.', { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
      inFlight.delete(key);
    }
  }

  /** Health view. Contains no secrets and no cache keys. */
  function health() {
    return {
      analyzer: {
        provider: provider.name,
        model: provider.modelId,
        promptVersion: PROMPT_VERSION,
        taxonomyVersion: TAXONOMY_VERSION,
        schemaVersion: ANALYSIS_SCHEMA_VERSION
      },
      transcript: { defaultLanguage },
      cache: cache.describe(),
      requests: { ...stats, inFlight: inFlight.size },
      requestTimeoutMs
    };
  }

  return Object.freeze({ analyze, health, cache });
}
