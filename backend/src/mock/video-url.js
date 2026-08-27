// Mock-only YouTube URL parsing.
//
// W2-T1 owns the production parser (including host allowlists and typed
// failures). This exists so the mock API and `curl` examples work in Wave 1;
// delete it once W2-T1's parser is available and import that instead.

import { AppError } from '../errors.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be'
]);

const PATH_PREFIXES = ['/shorts/', '/embed/', '/live/', '/v/'];

/**
 * Extract a canonical video id from a URL or a bare id.
 * @param {unknown} input
 * @returns {string | null} null when the input is not a recognisable video reference
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (VIDEO_ID.test(trimmed)) return trimmed;

  let url;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    throw new AppError(
      'UNSUPPORTED_HOST',
      `Host "${url.hostname}" is not a YouTube watch URL. Supported hosts: ${[...ALLOWED_HOSTS].join(', ')}.`
    );
  }

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const candidate = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID.test(candidate) ? candidate : null;
  }

  const queryId = url.searchParams.get('v');
  if (queryId !== null && VIDEO_ID.test(queryId)) return queryId;

  for (const prefix of PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      const candidate = url.pathname.slice(prefix.length).split('/')[0];
      if (VIDEO_ID.test(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Same as `extractVideoId`, but throws INVALID_URL instead of returning null.
 * @param {unknown} input
 * @returns {string}
 */
export function requireVideoId(input) {
  const videoId = extractVideoId(input);
  if (videoId === null) {
    throw new AppError(
      'INVALID_URL',
      'Could not read a YouTube video id. Send a watch URL such as https://www.youtube.com/watch?v=dQw4w9WgXcQ, a youtu.be link, or a bare 11-character id.'
    );
  }
  return videoId;
}
