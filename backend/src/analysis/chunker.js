// Transcript chunking.
//
// Long transcripts exceed a single model request, so they are split on segment
// boundaries with a fixed overlap. Segments are never split or reworded: every
// chunk carries the original ids, speakers, and times, so a finding can always
// be mapped back to a real transcript interval.
//
// Overlapping segments are analysed in both chunks on purpose - it lets the
// model see the setup for a contradiction that lands just after a boundary. The
// duplicate findings that produces are removed in postprocess.js.

/** Default character budget per chunk, counted over segment text. */
export const DEFAULT_MAX_CHUNK_CHARS = 6000;

/** Default number of trailing segments repeated at the start of the next chunk. */
export const DEFAULT_OVERLAP_SEGMENTS = 2;

/** Hard ceiling on segments per chunk, independent of the character budget. */
export const DEFAULT_MAX_CHUNK_SEGMENTS = 120;

/**
 * @typedef {object} Chunk
 * @property {number} index
 * @property {object[]} segments  original segment objects, in order
 * @property {number} startTime   first segment startTime
 * @property {number} endTime     last segment endTime
 * @property {number} charCount   total text characters in the chunk
 * @property {number} overlapCount leading segments repeated from the previous chunk
 */

/**
 * Split transcript segments into overlapping chunks.
 *
 * @param {object[]} segments transcript segments, already sorted by startTime
 * @param {object} [options]
 * @param {number} [options.maxChars]
 * @param {number} [options.overlapSegments]
 * @param {number} [options.maxSegments]
 * @returns {Chunk[]}
 */
export function chunkTranscript(segments, options = {}) {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxSegments = options.maxSegments ?? DEFAULT_MAX_CHUNK_SEGMENTS;
  const requestedOverlap = options.overlapSegments ?? DEFAULT_OVERLAP_SEGMENTS;

  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (maxChars < 1) throw new RangeError('maxChars must be at least 1');
  if (maxSegments < 1) throw new RangeError('maxSegments must be at least 1');
  if (requestedOverlap < 0) throw new RangeError('overlapSegments must be >= 0');

  // The overlap can never consume a whole chunk, otherwise the window stops
  // advancing and chunking never terminates.
  const overlap = Math.min(requestedOverlap, Math.max(0, maxSegments - 1));

  /** @type {Chunk[]} */
  const chunks = [];
  let cursor = 0;
  let overlapCount = 0;

  while (cursor < segments.length) {
    const taken = [];
    let charCount = 0;

    while (cursor + taken.length < segments.length && taken.length < maxSegments) {
      const candidate = segments[cursor + taken.length];
      const length = String(candidate.text ?? '').length;

      // Always take at least one segment, even one larger than the budget: a
      // single oversized segment gets a chunk of its own rather than being cut.
      if (taken.length > 0 && charCount + length > maxChars) break;

      taken.push(candidate);
      charCount += length;
    }

    chunks.push({
      index: chunks.length,
      segments: taken,
      startTime: taken[0].startTime,
      endTime: taken[taken.length - 1].endTime,
      charCount,
      overlapCount
    });

    const consumed = cursor + taken.length;
    if (consumed >= segments.length) break;

    // Step back by the overlap, but never far enough to lose forward progress.
    const step = Math.max(1, taken.length - overlap);
    overlapCount = taken.length - step;
    cursor += step;
  }

  return chunks;
}
