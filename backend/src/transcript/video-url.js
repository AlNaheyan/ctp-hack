import { AppError } from '../errors.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be'
]);
const VIDEO_PATH_PREFIXES = ['/shorts/', '/embed/', '/live/', '/v/'];

/**
 * Extract a canonical YouTube video id from a watch/share URL or bare id.
 * Returns null for a supported host whose URL does not identify a video.
 * Throws for an unrelated host or unsafe protocol.
 *
 * @param {unknown} input
 * @returns {string | null}
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

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw invalidUrl('Only HTTP and HTTPS YouTube links are supported.');
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    throw invalidUrl(`Host "${url.hostname}" is not an allowed YouTube host.`);
  }

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const candidate = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID.test(candidate) ? candidate : null;
  }

  if (url.pathname === '/watch' || url.pathname === '/watch/') {
    const candidate = url.searchParams.get('v');
    return candidate !== null && VIDEO_ID.test(candidate) ? candidate : null;
  }

  for (const prefix of VIDEO_PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) {
      const candidate = url.pathname.slice(prefix.length).split('/')[0];
      return VIDEO_ID.test(candidate) ? candidate : null;
    }
  }

  return null;
}

/**
 * Extract a video id or throw the shared typed URL error.
 * @param {unknown} input
 */
export function requireVideoId(input) {
  const videoId = extractVideoId(input);
  if (videoId === null) {
    throw invalidUrl(
      'Could not read a YouTube video id. Send a watch URL such as https://www.youtube.com/watch?v=dQw4w9WgXcQ, a youtu.be share link, or a bare 11-character id.'
    );
  }
  return videoId;
}

function invalidUrl(message) {
  return new AppError('INVALID_YOUTUBE_URL', message);
}
