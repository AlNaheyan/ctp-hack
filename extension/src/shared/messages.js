// Playback message helpers shared by the service worker and the test harness.
//
// The wire shape follows the roadmap playback contract. W1-T2 owns the schema
// and W2-T3 owns the real observer; this module exists so every lane can build
// and assert on the same message today.

export const SCHEMA_VERSION = 1;

export const MESSAGE_TYPES = Object.freeze({
  PLAYBACK_STATE: 'PLAYBACK_STATE',
  CONNECTION_STATE: 'CONNECTION_STATE'
});

/**
 * @typedef {object} PlaybackObservation
 * @property {string} videoId
 * @property {number} currentTime seconds
 * @property {number} duration seconds
 * @property {boolean} paused
 * @property {number} playbackRate
 * @property {string} [observedAt] RFC 3339 UTC; defaults to now
 */

/**
 * Wrap a raw observation in the versioned envelope.
 * @param {PlaybackObservation} observation
 */
export function createPlaybackMessage(observation) {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: MESSAGE_TYPES.PLAYBACK_STATE,
    payload: {
      videoId: observation.videoId,
      currentTime: observation.currentTime,
      duration: observation.duration,
      paused: observation.paused,
      playbackRate: observation.playbackRate,
      observedAt: observation.observedAt ?? new Date().toISOString()
    }
  };
}

const isFiniteNonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const RFC_3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Structural validation only - enough to catch a malformed producer before the
 * transport. W1-T2 schema validation supersedes this at integration time.
 * @param {unknown} message
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlaybackMessage(message) {
  const errors = [];

  if (typeof message !== 'object' || message === null) {
    return { valid: false, errors: ['message must be an object'] };
  }

  const { schemaVersion, type, payload } = /** @type {Record<string, any>} */ (message);

  if (schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (type !== MESSAGE_TYPES.PLAYBACK_STATE) errors.push(`type must be ${MESSAGE_TYPES.PLAYBACK_STATE}`);

  if (typeof payload !== 'object' || payload === null) {
    errors.push('payload must be an object');
    return { valid: errors.length === 0, errors };
  }

  if (typeof payload.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(payload.videoId)) {
    errors.push('payload.videoId must be an 11-character YouTube id');
  }
  if (!isFiniteNonNegative(payload.currentTime)) errors.push('payload.currentTime must be a finite number >= 0');
  if (!isFiniteNonNegative(payload.duration)) errors.push('payload.duration must be a finite number >= 0');
  if (typeof payload.paused !== 'boolean') errors.push('payload.paused must be a boolean');
  if (!isFiniteNonNegative(payload.playbackRate) || payload.playbackRate === 0) {
    errors.push('payload.playbackRate must be a finite number > 0');
  }
  if (typeof payload.observedAt !== 'string' || !RFC_3339_UTC.test(payload.observedAt)) {
    errors.push('payload.observedAt must be an RFC 3339 UTC timestamp');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Read the video id out of a YouTube URL. Mirrors the mock backend parser and
 * is replaced by the W2-T3 observer implementation.
 * @param {string} href
 * @returns {string | null}
 */
export function videoIdFromHref(href) {
  try {
    const url = new URL(href);
    const queryId = url.searchParams.get('v');
    if (queryId && /^[A-Za-z0-9_-]{11}$/.test(queryId)) return queryId;

    for (const prefix of ['/shorts/', '/embed/', '/live/']) {
      if (url.pathname.startsWith(prefix)) {
        const candidate = url.pathname.slice(prefix.length).split('/')[0];
        if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}
