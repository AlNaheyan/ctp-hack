import { AppError } from '../errors.js';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_WATCH_BYTES = 5 * 1024 * 1024;
const MAX_CAPTION_BYTES = 5 * 1024 * 1024;
const YOUTUBE_ORIGIN = 'https://www.youtube.com';

/**
 * Public-video caption adapter. It discovers timed-text tracks from the public
 * watch page because YouTube's official captions.download API requires OAuth
 * permission to edit the video. Keep this behind TranscriptProvider: the watch
 * page is an upstream implementation detail and may change independently.
 */
export class YouTubeCaptionProvider {
  constructor({
    fetchImpl = globalThis.fetch,
    origin = YOUTUBE_ORIGIN,
    ytDlpFallback = fetchTranscriptWithYtDlp
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    if (typeof ytDlpFallback !== 'function') throw new TypeError('ytDlpFallback must be a function');
    this.fetchImpl = fetchImpl;
    this.origin = origin;
    this.ytDlpFallback = ytDlpFallback;
  }

  /**
   * @param {{ videoId: string, language: string, captionSource?: 'manual' | 'automatic', signal?: AbortSignal }} request
   * @returns {Promise<{ videoId: string, language: string, captionSource: string, cues: Array<object> }>}
   */
  async fetchTranscript({ videoId, language, captionSource, signal }) {
    const watchUrl = new URL('/watch', this.origin);
    watchUrl.searchParams.set('v', videoId);
    watchUrl.searchParams.set('hl', 'en');

    const watchResponse = await this.fetchImpl(watchUrl, {
      signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.8',
        'user-agent': 'BoringNotchDiscussionAnalyzer/0.1'
      }
    });

    if (watchResponse.status === 404) throw videoNotFound();
    if (watchResponse.status === 401 || watchResponse.status === 403) throw videoPrivate();
    if (!watchResponse.ok) {
      throw new AppError('TRANSCRIPT_UNAVAILABLE', 'YouTube did not return video metadata.', {
        retryable: watchResponse.status >= 500 || watchResponse.status === 429
      });
    }

    const html = await readBoundedText(watchResponse, MAX_WATCH_BYTES, 'video metadata');
    const playerResponse = extractInitialPlayerResponse(html);
    assertPlayable(playerResponse?.playabilityStatus);

    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      throw new AppError('CAPTIONS_DISABLED', 'Captions are disabled or unavailable for this video.');
    }

    const track = selectCaptionTrack(tracks, { language, captionSource });
    const trackUrl = validateTrackUrl(track.baseUrl);
    trackUrl.searchParams.set('fmt', 'json3');

    const captionResponse = await this.fetchImpl(trackUrl, {
      signal,
      headers: {
        accept: 'application/json,text/plain;q=0.8',
        'user-agent': 'BoringNotchDiscussionAnalyzer/0.1'
      }
    });
    let payload;
    if (captionResponse.ok) {
      const source = await readBoundedText(captionResponse, MAX_CAPTION_BYTES, 'caption track');
      try {
        payload = JSON.parse(source);
      } catch {
        // YouTube sometimes advertises a public timed-text URL but answers the
        // anonymous request with an empty HTML body. yt-dlp uses YouTube's
        // current player clients and is the local-development fallback.
      }
    }

    if (payload === undefined) {
      return this.ytDlpFallback({
        videoId,
        language: track.languageCode,
        captionSource: sourceForTrack(track),
        signal
      });
    }

    return {
      videoId,
      language: track.languageCode,
      captionSource: sourceForTrack(track),
      cues: json3Cues(payload)
    };
  }
}

/** Retrieve JSON3 captions through the locally installed yt-dlp executable. */
export async function fetchTranscriptWithYtDlp({
  videoId,
  language,
  captionSource,
  signal,
  spawnImpl = spawn
}) {
  const workingDirectory = await mkdtemp(join(tmpdir(), 'boring-notch-captions-'));
  try {
    const outputTemplate = join(workingDirectory, '%(id)s.%(ext)s');
    const captionFlag = captionSource === 'automatic' ? '--write-auto-subs' : '--write-subs';
    await runYtDlp([
      '--no-update',
      '--skip-download',
      captionFlag,
      '--sub-langs', language,
      '--sub-format', 'json3',
      '--no-playlist',
      '--output', outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`
    ], { signal, spawnImpl });

    const captionFiles = (await readdir(workingDirectory))
      .filter((name) => name.endsWith('.json3'))
      .sort();
    if (captionFiles.length === 0) {
      throw new AppError('TRANSCRIPT_UNAVAILABLE', 'yt-dlp did not return the selected caption track.', {
        retryable: true
      });
    }

    const captionPath = join(workingDirectory, captionFiles[0]);
    const metadata = await stat(captionPath);
    if (metadata.size > MAX_CAPTION_BYTES) {
      throw new AppError(
        'TRANSCRIPT_UNAVAILABLE',
        `YouTube caption track exceeds the ${MAX_CAPTION_BYTES}-byte limit.`
      );
    }

    let payload;
    try {
      payload = JSON.parse(await readFile(captionPath, 'utf8'));
    } catch {
      throw new AppError('TRANSCRIPT_UNAVAILABLE', 'yt-dlp returned an unreadable caption track.', {
        retryable: true
      });
    }

    return {
      videoId,
      language,
      captionSource,
      cues: json3Cues(payload)
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function runYtDlp(arguments_, { signal, spawnImpl }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl('yt-dlp', arguments_, {
        signal,
        stdio: ['ignore', 'ignore', 'ignore']
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else {
        reject(new AppError('TRANSCRIPT_UNAVAILABLE', 'yt-dlp could not retrieve captions from YouTube.', {
          retryable: true
        }));
      }
    });
  });
}

/** Parse the balanced ytInitialPlayerResponse object from a watch page. */
export function extractInitialPlayerResponse(html) {
  const markers = ['ytInitialPlayerResponse =', '"ytInitialPlayerResponse":'];
  for (const marker of markers) {
    let searchFrom = 0;
    while (searchFrom < html.length) {
      const markerAt = html.indexOf(marker, searchFrom);
      if (markerAt < 0) break;
      const objectAt = html.indexOf('{', markerAt + marker.length);
      if (objectAt < 0) break;
      const source = balancedObjectAt(html, objectAt);
      if (source !== null) {
        try {
          return JSON.parse(source);
        } catch {
          // Another marker can exist later in the page; keep looking.
        }
      }
      searchFrom = objectAt + 1;
    }
  }
  throw new AppError('TRANSCRIPT_UNAVAILABLE', 'YouTube returned unreadable video metadata.', {
    retryable: true
  });
}

/** Select exact language first, then its base language; manual beats automatic. */
export function selectCaptionTrack(tracks, { language, captionSource } = {}) {
  const requested = String(language ?? 'en-US').toLowerCase();
  const requestedBase = requested.split('-')[0];
  const candidates = tracks
    .filter((track) => typeof track?.languageCode === 'string' && typeof track?.baseUrl === 'string')
    .map((track, index) => {
      const trackLanguage = track.languageCode.toLowerCase();
      const source = sourceForTrack(track);
      const languageScore = trackLanguage === requested ? 0 : trackLanguage === requestedBase ? 2 : Infinity;
      const sourceScore = source === 'manual' ? 0 : 1;
      return { track, index, source, score: languageScore + sourceScore };
    })
    .filter((candidate) => Number.isFinite(candidate.score))
    .filter((candidate) => captionSource === undefined || candidate.source === captionSource)
    .sort((left, right) => left.score - right.score || left.index - right.index);

  if (candidates.length > 0) return candidates[0].track;

  const availableLanguages = [
    ...new Set(
      tracks
        .filter((track) => typeof track?.languageCode === 'string')
        .map((track) => `${track.languageCode}:${sourceForTrack(track)}`)
    )
  ].slice(0, 20);
  throw new AppError('UNSUPPORTED_LANGUAGE', `Captions are not available in ${language}.`, {
    details: { requestedLanguage: language, availableLanguages }
  });
}

export function json3Cues(payload) {
  if (!Array.isArray(payload?.events)) return [];
  return payload.events
    .filter((event) => Number.isFinite(event?.tStartMs) && Number.isFinite(event?.dDurationMs))
    .map((event) => ({
      startMs: event.tStartMs,
      durationMs: event.dDurationMs,
      text: Array.isArray(event.segs)
        ? event.segs.map((segment) => (typeof segment?.utf8 === 'string' ? segment.utf8 : '')).join('')
        : ''
    }));
}

function sourceForTrack(track) {
  return track?.kind === 'asr' ? 'automatic' : 'manual';
}

function assertPlayable(status) {
  if (status?.status === 'OK') return;
  const reason = String(status?.reason ?? '').toLowerCase();
  if (reason.includes('private')) throw videoPrivate();
  if (
    status?.status === 'ERROR' ||
    reason.includes('removed') ||
    reason.includes('deleted') ||
    reason.includes('not available')
  ) {
    throw videoNotFound();
  }
  if (status?.status === 'LOGIN_REQUIRED') throw videoPrivate();
  throw new AppError('TRANSCRIPT_UNAVAILABLE', 'This video cannot provide a public transcript.');
}

function validateTrackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('TRANSCRIPT_UNAVAILABLE', 'YouTube returned an invalid caption track address.');
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com'))) {
    throw new AppError('TRANSCRIPT_UNAVAILABLE', 'YouTube returned an unsafe caption track address.');
  }
  return url;
}

async function readBoundedText(response, maximumBytes, label) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new AppError('TRANSCRIPT_UNAVAILABLE', `YouTube ${label} exceeds the ${maximumBytes}-byte limit.`);
  }
  const source = await response.text();
  if (Buffer.byteLength(source, 'utf8') > maximumBytes) {
    throw new AppError('TRANSCRIPT_UNAVAILABLE', `YouTube ${label} exceeds the ${maximumBytes}-byte limit.`);
  }
  return source;
}

function balancedObjectAt(source, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function videoPrivate() {
  return new AppError('VIDEO_PRIVATE', 'This video is private or requires sign-in.');
}

function videoNotFound() {
  return new AppError('VIDEO_NOT_FOUND', 'This video was deleted or could not be found.');
}
