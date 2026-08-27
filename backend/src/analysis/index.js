// Public surface of the analysis package.
//
// W3-T1 should import from here and nowhere deeper:
//
//   const provider = createProvider(config);
//   const { analysis, meta } = await analyzeTranscript(transcript, { provider, title });
//
// `analysis` is a contract-valid analysis response, ready to cache and serve.
// `meta` is internal bookkeeping (model, prompt version, cache key, counters)
// and must not be merged into the response payload.

export {
  ANALYSIS_SCHEMA_VERSION,
  DEFAULT_CACHE_TTL_SECONDS,
  MAX_REPAIR_ATTEMPTS_PER_CHUNK,
  analyzeTranscript,
  cacheKeyFor
} from './analyzer.js';

export { INSIGHT_TYPES, TAXONOMY, TAXONOMY_VERSION } from './taxonomy.js';
export { PROMPT_VERSION, promptFingerprint } from './prompt.js';
export { DEFAULT_MAX_CHUNK_CHARS, DEFAULT_OVERLAP_SEGMENTS, chunkTranscript } from './chunker.js';
export { validateAnalysisResponse, validateTranscript } from './contract.js';
export { createProvider, createGeminiProvider, createStubProvider } from './providers/index.js';
