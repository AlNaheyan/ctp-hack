// Model output validation.
//
// Everything a provider returns is untrusted: it can be prose instead of JSON,
// invent segment ids, use a type outside the enum, or exceed the contract field
// limits. This module parses it, drops what cannot be repaired locally, clamps
// what can, and records why - so the analyzer never forwards an unusable event
// and the drop reasons stay visible for debugging.

import { isInsightType } from './taxonomy.js';

/** Contract ceilings from contracts/analysis-response.schema.json. */
export const FIELD_MAX = Object.freeze({ title: 200, summary: 1000, evidence: 2000 });

export const DROP_REASONS = Object.freeze({
  notAnObject: 'not_an_object',
  unknownSegment: 'unknown_segment',
  unknownType: 'unknown_type',
  invalidConfidence: 'invalid_confidence',
  emptyText: 'empty_text'
});

/** Raised when output cannot be used at all. The analyzer answers with one repair attempt. */
export class ModelOutputError extends Error {
  /** @param {string} message @param {{ raw?: string }} [options] */
  constructor(message, options = {}) {
    super(message);
    this.name = 'ModelOutputError';
    this.raw = options.raw;
  }
}

/**
 * Parse a model response into an object.
 * Tolerates ```json fences and leading/trailing prose, because providers add
 * them even when asked not to; anything else is a repairable failure.
 * @param {string} text
 */
export function parseModelJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ModelOutputError('the model returned an empty response', { raw: text });
  }

  const withoutFences = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const candidates = [withoutFences];
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    candidates.push(withoutFences.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }

  throw new ModelOutputError('the model response was not valid JSON', { raw: text });
}

/**
 * Pull the findings array out of a parsed response.
 * @param {unknown} parsed
 * @returns {unknown[]}
 */
export function extractFindings(parsed) {
  if (Array.isArray(parsed)) return parsed;

  if (typeof parsed === 'object' && parsed !== null) {
    const { findings } = /** @type {Record<string, unknown>} */ (parsed);
    if (Array.isArray(findings)) return findings;
    // An explicit empty object is a valid "nothing found" answer.
    if (Object.keys(parsed).length === 0) return [];
  }

  throw new ModelOutputError('the model response had no findings array');
}

const normalize = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function truncate(text, max) {
  const trimmed = String(text).trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/**
 * Is the quote actually present in the segment it claims to come from?
 * Compared on letters and digits only, so punctuation or casing drift from the
 * model still counts as grounded.
 */
export function isGrounded(evidence, segmentText) {
  const quote = normalize(evidence);
  const source = normalize(segmentText);
  if (quote === '' || source === '') return false;
  return source.includes(quote) || quote.includes(source);
}

/**
 * Validate and normalize raw findings against the transcript they claim to describe.
 *
 * @param {unknown} parsed parsed model response
 * @param {object} options
 * @param {Map<string, object>} options.segmentsById segments the model was shown
 * @returns {{ findings: object[], dropped: { reason: string, segmentId?: string, type?: string }[], groundingFallbacks: number, truncated: number }}
 */
export function normalizeFindings(parsed, { segmentsById }) {
  const raw = extractFindings(parsed);

  const findings = [];
  const dropped = [];
  let groundingFallbacks = 0;
  let truncated = 0;

  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      dropped.push({ reason: DROP_REASONS.notAnObject });
      continue;
    }

    const { segmentId, type, title, summary, confidence, evidence } = /** @type {any} */ (candidate);

    const segment = typeof segmentId === 'string' ? segmentsById.get(segmentId) : undefined;
    if (segment === undefined) {
      // The model referenced a segment it was never shown - the one failure we
      // cannot repair, because there is no real interval to point at.
      dropped.push({ reason: DROP_REASONS.unknownSegment, segmentId: String(segmentId) });
      continue;
    }

    if (!isInsightType(type)) {
      dropped.push({ reason: DROP_REASONS.unknownType, segmentId, type: String(type) });
      continue;
    }

    if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
      dropped.push({ reason: DROP_REASONS.invalidConfidence, segmentId, type });
      continue;
    }

    if (typeof title !== 'string' || title.trim() === '' || typeof summary !== 'string' || summary.trim() === '') {
      dropped.push({ reason: DROP_REASONS.emptyText, segmentId, type });
      continue;
    }

    const groundedEvidence =
      typeof evidence === 'string' && evidence.trim() !== '' && isGrounded(evidence, segment.text);

    if (!groundedEvidence) groundingFallbacks += 1;

    const finalTitle = truncate(title, FIELD_MAX.title);
    const finalSummary = truncate(summary, FIELD_MAX.summary);
    const finalEvidence = truncate(groundedEvidence ? evidence : segment.text, FIELD_MAX.evidence);

    if (finalTitle.length < title.trim().length || finalSummary.length < summary.trim().length) truncated += 1;

    findings.push({
      segmentId,
      type,
      title: finalTitle,
      summary: finalSummary,
      // Out-of-range confidence is clamped rather than dropped: the finding is
      // still usable, only the model's self-report was malformed.
      confidence: Math.min(1, Math.max(0, confidence)),
      evidence: finalEvidence,
      grounded: groundedEvidence
    });
  }

  return { findings, dropped, groundingFallbacks, truncated };
}
