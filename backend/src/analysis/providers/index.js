// Provider selection.
//
// The analyzer never imports a provider directly - it receives one. This is the
// only place that decides which implementation a given configuration gets, so
// adding a provider later means adding a case here and nothing else.

import { requireSecret } from '../../config.js';
import { createGeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini.js';
import { createStubProvider } from './stub.js';

/**
 * @typedef {object} GenerateRequest
 * @property {string} system   system instruction
 * @property {string} user     user message containing the quoted transcript
 * @property {object} [responseSchema] provider-neutral shape of the expected JSON
 * @property {AbortSignal} [signal]
 *
 * @typedef {object} GenerateResult
 * @property {string} text                 raw model text, expected to be JSON
 * @property {string} [modelId]            resolved model id, when the provider reports one
 * @property {string} [finishReason]
 * @property {{ promptTokens?: number, responseTokens?: number }} [usage]
 *
 * @typedef {object} ModelProvider
 * @property {string} name
 * @property {string} modelId
 * @property {(request: GenerateRequest) => Promise<GenerateResult>} generate
 */

export { createGeminiProvider, createStubProvider, DEFAULT_GEMINI_MODEL };

/**
 * Build the provider for a runtime configuration.
 * `mock` mode never requires a secret; `live` mode fails immediately, and
 * actionably, when the key is missing.
 *
 * @param {{ mode: string, geminiModel?: string, analysisTimeoutMs?: number }} config
 * @param {Record<string, string | undefined>} [env]
 * @param {{ logger?: object }} [options]
 * @returns {ModelProvider}
 */
export function createProvider(config, env = process.env, { logger } = {}) {
  if (config.mode === 'live') {
    return createGeminiProvider({
      apiKey: requireSecret('GEMINI_API_KEY', env),
      model: config.geminiModel ?? DEFAULT_GEMINI_MODEL,
      timeoutMs: config.analysisTimeoutMs,
      logger,
      logPayloads: config.logPayloads
    });
  }

  return createStubProvider();
}
