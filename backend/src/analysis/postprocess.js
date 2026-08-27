// Findings -> contract events.
//
// Timings are derived from the transcript, never from the model: an event
// always spans exactly the segment it was grounded in, which is what makes
// "every event points to a real transcript interval" true by construction.

/** Two events of the same type whose intervals overlap are treated as one finding. */
export const DEDUPE_BY = Object.freeze({ id: 'duplicate_id', overlap: 'overlapping_same_type' });

const round2 = (value) => Math.round(value * 100) / 100;

/** Speaker shown when the caption source did not identify one. */
export const UNKNOWN_SPEAKER = 'Unknown speaker';

/**
 * Stable, human-readable event id derived from source identity rather than an
 * array index, so the same finding keeps its id across re-analysis.
 * Matches the contract stableId pattern: ^[A-Za-z][A-Za-z0-9_-]{0,127}$
 * @param {string} type
 * @param {string} segmentId
 */
export function eventId(type, segmentId) {
  const safe = `evt_${type}_${segmentId}`.replace(/[^A-Za-z0-9_-]/g, '_');
  const withLetter = /^[A-Za-z]/.test(safe) ? safe : `e${safe}`;
  return withLetter.slice(0, 128);
}

/**
 * The notification point for a finding: the middle of its segment, so the card
 * appears while the statement is still on screen rather than after it.
 * @param {object} segment
 */
export function triggerTimeFor(segment) {
  const trigger = round2(segment.startTime + (segment.endTime - segment.startTime) / 2);
  return Math.min(Math.max(trigger, segment.startTime), segment.endTime);
}

function toEvent(finding, segment) {
  return {
    id: eventId(finding.type, finding.segmentId),
    startTime: segment.startTime,
    triggerTime: triggerTimeFor(segment),
    endTime: segment.endTime,
    speaker: segment.speaker ?? UNKNOWN_SPEAKER,
    type: finding.type,
    title: finding.title,
    summary: finding.summary,
    confidence: finding.confidence,
    evidence: finding.evidence
  };
}

const overlaps = (a, b) => a.startTime <= b.endTime && b.startTime <= a.endTime;

/**
 * Keep the strongest of a set of duplicates: highest confidence, then earliest
 * trigger, then lowest id, so the result is deterministic.
 */
function preferred(a, b) {
  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  if (a.triggerTime !== b.triggerTime) return a.triggerTime < b.triggerTime ? a : b;
  return a.id <= b.id ? a : b;
}

/**
 * Build the final event list.
 *
 * @param {object[]} findings normalized findings from validator.js
 * @param {object} options
 * @param {Map<string, object>} options.segmentsById
 * @param {number} [options.minConfidence] drop findings below this (default 0: keep everything)
 * @returns {{ events: object[], removed: { reason: string, id: string }[] }}
 */
export function buildEvents(findings, { segmentsById, minConfidence = 0 }) {
  const removed = [];

  /** @type {Map<string, object>} */
  const byId = new Map();

  for (const finding of findings) {
    const segment = segmentsById.get(finding.segmentId);
    if (segment === undefined) continue;
    if (finding.confidence < minConfidence) {
      removed.push({ reason: 'below_min_confidence', id: eventId(finding.type, finding.segmentId) });
      continue;
    }

    const event = toEvent(finding, segment);
    const existing = byId.get(event.id);

    if (existing === undefined) {
      byId.set(event.id, event);
      continue;
    }

    // Same segment and type reported by two overlapping chunks.
    removed.push({ reason: DEDUPE_BY.id, id: event.id });
    byId.set(event.id, preferred(existing, event));
  }

  const sorted = [...byId.values()].sort(
    (a, b) => a.triggerTime - b.triggerTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  /** @type {object[]} */
  const kept = [];

  for (const event of sorted) {
    const clash = kept.find((candidate) => candidate.type === event.type && overlaps(candidate, event));

    if (clash === undefined) {
      kept.push(event);
      continue;
    }

    // Two different segments, same issue type, overlapping windows: one finding.
    const winner = preferred(clash, event);
    removed.push({ reason: DEDUPE_BY.overlap, id: winner === clash ? event.id : clash.id });
    if (winner !== clash) kept[kept.indexOf(clash)] = event;
  }

  kept.sort((a, b) => a.triggerTime - b.triggerTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { events: kept, removed };
}
