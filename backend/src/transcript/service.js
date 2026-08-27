import { AppError } from '../errors.js';
import { MemoryTranscriptCache, buildTranscriptCacheKey } from './cache.js';
import { normalizeTranscript } from './normalizer.js';
import { requireVideoId } from './video-url.js';
import { YouTubeCaptionProvider } from './youtube-provider.js';

const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;
const SOURCES = new Set(['manual', 'automatic']);

/**
 * Service boundary consumed by W3-T1.
 *
 * getTranscript({ url | videoId, language?, captionSource?, forceRefresh?, signal? })
 *   -> Promise<NormalizedTranscriptV1>
 */
export function createTranscriptService({
  provider = new YouTubeCaptionProvider(),
  cache = new MemoryTranscriptCache(),
  timeoutMs = 10_000,
  clock = Date.now,
  logger = silentLogger,
  logPayloads = false
} = {}) {
  if (typeof provider?.fetchTranscript !== 'function') {
    throw new TypeError('provider must implement fetchTranscript(request)');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive integer');

  return Object.freeze({
    async getTranscript({ url, videoId: suppliedVideoId, language = 'en-US', captionSource, forceRefresh = false, signal } = {}) {
      const videoId = requireVideoId(url ?? suppliedVideoId);
      validatePreferences(language, captionSource);

      if (!forceRefresh) {
        for (const key of preferredCacheKeys({ videoId, language, captionSource })) {
          const cached = cache.get(key);
          if (cached !== undefined) {
            logger.debug('transcript cache hit', {
              videoId,
              language: cached.language,
              captionSource: cached.captionSource,
              segmentCount: cached.segments.length
            });
            return cached;
          }
        }
      }

      const timeout = timeoutSignal(signal, timeoutMs);
      let providerResult;
      try {
        providerResult = await provider.fetchTranscript({ videoId, language, captionSource, signal: timeout.signal });
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (timeout.didTimeout()) {
          throw new AppError('UPSTREAM_TIMEOUT', `Transcript retrieval exceeded ${timeoutMs} ms.`, {
            cause: error
          });
        }
        if (timeout.signal.aborted) {
          throw new AppError('TRANSCRIPT_UNAVAILABLE', 'Transcript retrieval was cancelled.', {
            cause: error,
            retryable: true
          });
        }
        throw new AppError('TRANSCRIPT_UNAVAILABLE', 'Could not retrieve captions from YouTube.', {
          cause: error,
          retryable: true
        });
      } finally {
        timeout.cleanup();
      }

      const transcript = normalizeTranscript(providerResult, { clock });
      if (logPayloads) {
        logger.info('transcript payload', { videoId, transcript });
      }
      const cacheKey = buildTranscriptCacheKey(transcript);
      cache.set(cacheKey, transcript);
      logger.info('transcript retrieved', {
        videoId,
        language: transcript.language,
        captionSource: transcript.captionSource,
        segmentCount: transcript.segments.length,
        cacheKey
      });
      return transcript;
    }
  });
}

export function preferredCacheKeys({ videoId, language, captionSource }) {
  const languages = [language];
  const base = language.split('-')[0];
  if (base.toLowerCase() !== language.toLowerCase()) languages.push(base);
  const sources = captionSource === undefined ? ['manual', 'automatic'] : [captionSource];
  return languages.flatMap((candidateLanguage) =>
    sources.map((candidateSource) =>
      buildTranscriptCacheKey({ videoId, language: candidateLanguage, captionSource: candidateSource })
    )
  );
}

function validatePreferences(language, captionSource) {
  if (typeof language !== 'string' || !LANGUAGE.test(language)) {
    throw new AppError('INVALID_REQUEST', 'language must be a BCP 47 language tag such as en or en-US.');
  }
  if (captionSource !== undefined && !SOURCES.has(captionSource)) {
    throw new AppError('INVALID_REQUEST', 'captionSource must be manual or automatic.');
  }
}

function timeoutSignal(parent, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('transcript timeout'));
  }, timeoutMs);

  const abortFromParent = () => controller.abort(parent.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener('abort', abortFromParent, { once: true });

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abortFromParent);
    }
  };
}

const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {}
});
