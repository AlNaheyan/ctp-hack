import { createHash } from 'node:crypto';

import { AppError, SCHEMA_VERSION } from '../errors.js';

const SOURCE_VALUES = new Set(['manual', 'automatic']);
const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * Convert provider cues in milliseconds to the canonical transcript contract.
 * Invalid provider data is never clamped: it becomes a typed ingestion failure.
 *
 * @param {{ videoId: string, language: string, captionSource: string, cues: Array<object> }} input
 * @param {{ clock?: () => number }} [options]
 */
export function normalizeTranscript(input, { clock = Date.now } = {}) {
  if (!VIDEO_ID.test(input.videoId)) return unusable('The provider returned an invalid video id.');
  if (!LANGUAGE.test(input.language)) return unusable('The provider returned an invalid caption language.');
  if (!SOURCE_VALUES.has(input.captionSource)) return unusable('The provider returned an invalid caption source.');
  if (!Array.isArray(input.cues)) return unusable('The caption response did not contain cue records.');

  const candidates = [];
  for (const cue of input.cues) {
    const startMs = cue?.startMs;
    const durationMs = cue?.durationMs;
    if (!Number.isFinite(startMs) || startMs < 0 || !Number.isFinite(durationMs) || durationMs < 0) {
      return unusable('A caption cue contained invalid timing.');
    }

    const text = cleanCaptionText(cue.text);
    if (text === '') continue;

    const speaker = cleanCaptionText(cue.speaker);
    candidates.push({
      startTime: startMs / 1000,
      endTime: (startMs + durationMs) / 1000,
      text,
      ...(speaker === '' ? {} : { speaker })
    });
  }

  candidates.sort((left, right) =>
    left.startTime - right.startTime ||
    left.endTime - right.endTime ||
    left.text.localeCompare(right.text, 'en')
  );

  if (candidates.length === 0) return unusable('The selected caption track contained no usable text.');

  const occurrences = new Map();
  const segments = candidates.map((candidate) => {
    const identity = [
      input.videoId,
      input.language.toLowerCase(),
      input.captionSource,
      candidate.startTime,
      candidate.endTime,
      candidate.speaker ?? '',
      candidate.text
    ].join('\u001f');
    const digest = createHash('sha256').update(identity).digest('hex').slice(0, 20);
    const occurrence = occurrences.get(digest) ?? 0;
    occurrences.set(digest, occurrence + 1);
    return {
      id: `seg_${digest}${occurrence === 0 ? '' : `_${occurrence + 1}`}`,
      ...candidate
    };
  });

  const fetchedAt = new Date(clock());
  if (Number.isNaN(fetchedAt.getTime())) throw new TypeError('clock must return a valid epoch timestamp');

  return {
    schemaVersion: SCHEMA_VERSION,
    videoId: input.videoId,
    language: input.language,
    captionSource: input.captionSource,
    fetchedAt: fetchedAt.toISOString(),
    segments
  };
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function cleanCaptionText(value) {
  if (typeof value !== 'string') return '';
  return decodeEntities(value)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|apos|gt|lt|quot);/gi, (entity, key) => {
    if (key[0] !== '#') return named[key.toLowerCase()] ?? entity;
    const hexadecimal = key[1]?.toLowerCase() === 'x';
    const point = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    try {
      return Number.isInteger(point) ? String.fromCodePoint(point) : entity;
    } catch {
      return entity;
    }
  });
}

function unusable(message) {
  throw new AppError('TRANSCRIPT_UNAVAILABLE', message);
}
