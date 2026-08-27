// Google Gemini adapter.
//
// The only provider-specific file in the pipeline: request shape, structured
// output config, and error mapping live here so the analyzer stays neutral.
// The API key is read once, sent as a header, and never logged, echoed into an
// error message, or attached to error details.

import { AppError } from '../../errors.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Gemini wants OpenAPI-style schemas with upper-case type names, so the neutral
 * schema from prompt.js is translated rather than passed through.
 * @param {object} schema
 * @returns {object}
 */
export function toGeminiSchema(schema) {
  if (schema === null || typeof schema !== 'object') return schema;

  const translated = {};

  if (schema.type !== undefined) translated.type = String(schema.type).toUpperCase();
  if (schema.description !== undefined) translated.description = schema.description;
  if (schema.enum !== undefined) translated.enum = [...schema.enum];
  if (schema.required !== undefined) translated.required = [...schema.required];
  if (schema.items !== undefined) translated.items = toGeminiSchema(schema.items);

  if (schema.properties !== undefined) {
    translated.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)])
    );
    // Deterministic key order makes responses easier to diff between runs.
    translated.propertyOrdering = Object.keys(schema.properties);
  }

  return translated;
}

function combineSignals(signals) {
  const present = signals.filter(Boolean);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(present);

  const controller = new AbortController();
  for (const signal of present) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/**
 * Map a provider failure onto the contract error enum. Provider response bodies
 * are never forwarded: only the HTTP status and, when present, the provider's
 * own short status string.
 * @param {number} status
 * @param {string | undefined} providerStatus
 */
function mapHttpError(status, providerStatus) {
  const details = { providerStatus: providerStatus ?? `http_${status}` };

  if (status === 401 || status === 403) {
    return new AppError(
      'ANALYSIS_FAILED',
      'The analysis provider rejected the credentials. Check GEMINI_API_KEY in .env; the value is never logged.',
      { details, retryable: false }
    );
  }
  if (status === 429) {
    return new AppError('ANALYSIS_FAILED', 'The analysis provider is rate limiting requests.', {
      details,
      retryable: true
    });
  }
  if (status >= 500) {
    return new AppError('ANALYSIS_FAILED', 'The analysis provider is unavailable.', { details, retryable: true });
  }
  return new AppError('ANALYSIS_FAILED', `The analysis provider rejected the request (HTTP ${status}).`, {
    details,
    retryable: false
  });
}

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {string} [options.model]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl] injected in tests; no network by default in CI
 * @param {string} [options.baseUrl]
 * @returns {import('./index.js').ModelProvider}
 */
export function createGeminiProvider({
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL
}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new AppError('INTERNAL_ERROR', 'createGeminiProvider requires an API key. Load it through config.requireSecret().');
  }

  return {
    name: 'gemini',
    modelId: model,

    async generate({ system, user, responseSchema, signal }) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new Error('timeout')), timeoutMs);

      let response;
      try {
        response = await fetchImpl(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey
          },
          signal: combineSignals([timeout.signal, signal]),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              ...(responseSchema ? { responseSchema: toGeminiSchema(responseSchema) } : {})
            }
          })
        });
      } catch (cause) {
        if (signal?.aborted) throw new AppError('ANALYSIS_FAILED', 'The analysis request was cancelled.', { cause });
        throw new AppError('UPSTREAM_TIMEOUT', `The analysis provider did not respond within ${timeoutMs} ms.`, {
          cause,
          details: { timeoutMs }
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        let providerStatus;
        try {
          const body = await response.json();
          providerStatus = body?.error?.status;
        } catch {
          // Body is not JSON; the status code alone is enough to classify it.
        }
        throw mapHttpError(response.status, providerStatus);
      }

      const body = await response.json();

      const blockReason = body?.promptFeedback?.blockReason;
      if (blockReason) {
        throw new AppError('ANALYSIS_FAILED', 'The analysis provider blocked this transcript.', {
          details: { blockReason },
          retryable: false
        });
      }

      const candidate = body?.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .map((part) => part?.text ?? '')
        .join('')
        .trim();

      if (text === '') {
        throw new AppError('ANALYSIS_FAILED', 'The analysis provider returned an empty response.', {
          details: { finishReason: candidate?.finishReason ?? 'unknown' },
          retryable: true
        });
      }

      return {
        text,
        modelId: body?.modelVersion ?? model,
        finishReason: candidate?.finishReason,
        usage: body?.usageMetadata
          ? {
              promptTokens: body.usageMetadata.promptTokenCount,
              responseTokens: body.usageMetadata.candidatesTokenCount
            }
          : undefined
      };
    }
  };
}
