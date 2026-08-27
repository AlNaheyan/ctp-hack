// Analysis orchestration.
//
//   normalized transcript -> one provider request -> validate -> events
//
// Provider-neutral: it is handed a ModelProvider and never imports one. W3-T1
// owns caching and HTTP exposure; everything this returns is either a
// contract-valid analysis response or a typed AppError.

import { AppError } from '../errors.js';
import { validateAnalysisResponse, validateTranscript, SIZE_LIMITS } from './contract.js';
import { buildChunkPrompt, buildRepairPrompt, buildSystemPrompt, PROMPT_VERSION, RESPONSE_SCHEMA } from './prompt.js';
import { buildEvents } from './postprocess.js';
import { ModelOutputError, normalizeFindings, parseModelJson } from './validator.js';
import { TAXONOMY_VERSION } from './taxonomy.js';

export const ANALYSIS_SCHEMA_VERSION = 1;

/** Analyses are reusable for 24 hours (roadmap cache rule). */
export const DEFAULT_CACHE_TTL_SECONDS = 24 * 60 * 60;

/** One repair attempt for the full transcript, then a typed failure. */
export const MAX_REPAIR_ATTEMPTS_PER_CHUNK = 1;

const countBy = (items, key) =>
  items.reduce((totals, item) => ({ ...totals, [item[key]]: (totals[item[key]] ?? 0) + 1 }), {});

/**
 * Cache identity for one analysis. W3-T1 stores results under this key; any
 * change to the model, prompt, or taxonomy therefore misses the old entry
 * instead of serving a stale timeline.
 */
export function cacheKeyFor({ videoId, language, modelId }) {
  return [
    videoId,
    language ?? 'unknown',
    `schema${ANALYSIS_SCHEMA_VERSION}`,
    modelId,
    PROMPT_VERSION,
    TAXONOMY_VERSION
  ].join('|');
}

/**
 * Drop the weakest events until the payload fits the contract ceiling. Only
 * reachable on very long transcripts; recorded in meta so it is never silent.
 */
function trimToSizeLimit(analysis) {
  let removed = 0;

  while (Buffer.byteLength(JSON.stringify(analysis), 'utf8') > SIZE_LIMITS.analysis && analysis.events.length > 0) {
    const weakest = analysis.events.reduce((lowest, event) =>
      event.confidence < lowest.confidence ? event : lowest
    );
    analysis.events = analysis.events.filter((event) => event !== weakest);
    removed += 1;
  }

  return removed;
}

/**
 * Analyse the full transcript in one request, allowing a single repair attempt
 * for unusable output.
 * @returns {{ findings: object[], dropped: object[], groundingFallbacks: number, truncated: number, repairs: number }}
 */
async function analyzeChunk({ chunk, provider, system, context, segmentsById, signal }) {
  const user = buildChunkPrompt(chunk, context);
  const request = { system, user, responseSchema: RESPONSE_SCHEMA, signal };

  const first = await provider.generate(request);

  try {
    return { ...normalizeFindings(parseModelJson(first.text), { segmentsById }), repairs: 0 };
  } catch (error) {
    if (!(error instanceof ModelOutputError)) throw error;

    // The provider is stateless, so the repair request repeats the transcript
    // and appends what was wrong with the previous answer.
    const repaired = await provider.generate({
      ...request,
      user: `${user}\n\n${buildRepairPrompt(first.text, error.message)}`
    });

    try {
      return { ...normalizeFindings(parseModelJson(repaired.text), { segmentsById }), repairs: 1 };
    } catch (repairError) {
      if (!(repairError instanceof ModelOutputError)) throw repairError;
      throw new AppError(
        'ANALYSIS_FAILED',
        'The analysis provider returned unusable output twice. The transcript was not analysed.',
        { details: { chunkIndex: chunk.index, problem: repairError.message }, cause: repairError }
      );
    }
  }
}

/**
 * Turn a normalized transcript into a contract-valid analysis response.
 *
 * @param {object} transcript transcript matching contracts/transcript.schema.json
 * @param {object} options
 * @param {import('./providers/index.js').ModelProvider} options.provider
 * @param {string} [options.title] discussion title for the response payload
 * @param {() => Date} [options.now] injected clock, for deterministic tests
 * @param {number} [options.minConfidence] drop findings below this confidence
 * @param {number} [options.cacheTtlSeconds]
 * @param {AbortSignal} [options.signal]
 * @param {{ info: Function, warn: Function, debug: Function }} [options.logger]
 * @param {boolean} [options.logPayloads] log the exact segments supplied to the model
 * @returns {Promise<{ analysis: object, meta: object }>}
 */
export async function analyzeTranscript(transcript, options) {
  const {
    provider,
    title,
    now = () => new Date(),
    minConfidence = 0,
    cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
    signal,
    logger,
    logPayloads = false
  } = options ?? {};

  if (provider === undefined || typeof provider.generate !== 'function') {
    throw new AppError('INTERNAL_ERROR', 'analyzeTranscript requires a provider with a generate() function.');
  }

  const startedAt = Date.now();

  if (typeof transcript !== 'object' || transcript === null) {
    throw new AppError('INVALID_REQUEST', 'A transcript object is required.');
  }
  if (transcript.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    throw new AppError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Transcript schemaVersion ${transcript.schemaVersion} is not supported. This build reads version ${ANALYSIS_SCHEMA_VERSION}.`
    );
  }

  const transcriptCheck = validateTranscript(transcript);
  if (!transcriptCheck.valid) {
    throw new AppError('INVALID_REQUEST', 'The transcript does not satisfy the transcript contract.', {
      details: { errors: transcriptCheck.errors.slice(0, 10) }
    });
  }

  const segmentsById = new Map(transcript.segments.map((segment) => [segment.id, segment]));
  const fullTranscript = {
    index: 0,
    overlapCount: 0,
    charCount: transcript.segments.reduce((total, segment) => total + segment.text.length, 0),
    startTime: transcript.segments[0].startTime,
    endTime: transcript.segments.at(-1).endTime,
    segments: transcript.segments
  };

  const system = buildSystemPrompt();
  const context = { videoTitle: title, language: transcript.language };

  if (logPayloads) {
    logger?.info?.('analysis input payload', {
      videoId: transcript.videoId,
      segmentCount: fullTranscript.segments.length,
      segments: fullTranscript.segments
    });
  }

  const allFindings = [];
  const allDropped = [];
  let groundingFallbacks = 0;
  let truncated = 0;
  let repairAttempts = 0;

  // Keep the entire discussion in one model request so later exchanges can be
  // evaluated against any earlier statement, question, or premise.
  const result = await analyzeChunk({ chunk: fullTranscript, provider, system, context, segmentsById, signal });
  allFindings.push(...result.findings);
  allDropped.push(...result.dropped);
  groundingFallbacks += result.groundingFallbacks;
  truncated += result.truncated;
  repairAttempts += result.repairs;

  const { events, removed } = buildEvents(allFindings, { segmentsById, minConfidence });

  const generatedAt = now();
  const analysis = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    videoId: transcript.videoId,
    title: title?.trim() || `Discussion analysis for ${transcript.videoId}`,
    generatedAt: generatedAt.toISOString(),
    expiresAt: new Date(generatedAt.getTime() + cacheTtlSeconds * 1000).toISOString(),
    events
  };

  const sizeTrimmed = trimToSizeLimit(analysis);

  const check = validateAnalysisResponse(analysis);
  if (!check.valid) {
    // Reaching here is a bug in this pipeline, not bad model output: everything
    // the model influenced has already been validated or dropped.
    throw new AppError('INTERNAL_ERROR', 'The analyzer produced a payload that fails the analysis contract.', {
      details: { errors: check.errors.slice(0, 10) }
    });
  }

  const meta = {
    providerName: provider.name,
    modelId: provider.modelId,
    promptVersion: PROMPT_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    language: transcript.language,
    segmentCount: transcript.segments.length,
    chunkCount: 1,
    findingsReturned: allFindings.length,
    eventsKept: analysis.events.length,
    dropped: countBy(allDropped, 'reason'),
    removed: countBy(removed, 'reason'),
    groundingFallbacks,
    truncated,
    repairAttempts,
    sizeTrimmed,
    durationMs: Date.now() - startedAt,
    cacheKeyParts: {
      videoId: transcript.videoId,
      language: transcript.language,
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      modelId: provider.modelId,
      promptVersion: PROMPT_VERSION,
      taxonomyVersion: TAXONOMY_VERSION
    },
    cacheKey: cacheKeyFor({
      videoId: transcript.videoId,
      language: transcript.language,
      modelId: provider.modelId
    })
  };

  logger?.info?.('analysis complete', {
    videoId: transcript.videoId,
    provider: meta.providerName,
    model: meta.modelId,
    chunks: meta.chunkCount,
    events: meta.eventsKept,
    repairs: meta.repairAttempts,
    durationMs: meta.durationMs
  });

  return { analysis, meta };
}
