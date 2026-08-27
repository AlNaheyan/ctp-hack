import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AppError } from '../errors.js';
import { json3Cues } from './youtube-provider.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Caption provider backed by yt-dlp's maintained YouTube extractor. */
export class YtDlpCaptionProvider {
  constructor({ executable = 'yt-dlp', runner = runYtDlp } = {}) {
    this.executable = executable;
    this.runner = runner;
  }

  async fetchTranscript({ videoId, language, captionSource, signal }) {
    const languages = preferredLanguages(language);
    const sources = captionSource === undefined ? ['manual', 'automatic'] : [captionSource];

    for (const source of sources) {
      const result = await this.runner({
        executable: this.executable,
        videoId,
        languages,
        source,
        signal
      });
      if (result !== null) {
        return {
          videoId,
          language: result.language,
          captionSource: source,
          cues: json3Cues(result.payload)
        };
      }
    }

    throw new AppError('CAPTIONS_DISABLED', `Captions are unavailable in ${language} for this video.`);
  }
}

export function preferredLanguages(language) {
  const requested = String(language ?? 'en-US');
  const base = requested.split('-')[0];
  return [...new Set([requested, `${base}-orig`, base])];
}

async function runYtDlp({ executable, videoId, languages, source, signal }) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-notch-captions-'));
  try {
    const args = [
      '--no-update',
      '--no-warnings',
      '--skip-download',
      source === 'manual' ? '--write-subs' : '--write-auto-subs',
      '--sub-langs',
      languages.join(','),
      '--sub-format',
      'json3',
      '--paths',
      directory,
      '--output',
      '%(id)s.%(ext)s',
      `https://www.youtube.com/watch?v=${videoId}`
    ];

    try {
      await execFileAsync(executable, args, {
        signal,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.code === 'ENOENT') {
        throw new AppError('TRANSCRIPT_UNAVAILABLE', 'yt-dlp is required for live caption retrieval.', {
          cause: error
        });
      }
      throw new AppError('TRANSCRIPT_UNAVAILABLE', 'yt-dlp could not retrieve captions from YouTube.', {
        cause: error,
        retryable: true
      });
    }

    const files = await readdir(directory);
    const selected = selectCaptionFile(files, videoId, languages);
    if (selected === null) return null;

    try {
      return {
        language: languageFromFilename(selected, videoId),
        payload: JSON.parse(await readFile(join(directory, selected), 'utf8'))
      };
    } catch (error) {
      throw new AppError('TRANSCRIPT_UNAVAILABLE', 'yt-dlp returned an unreadable caption track.', {
        cause: error,
        retryable: true
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function selectCaptionFile(files, videoId, languages) {
  for (const language of languages) {
    const expected = `${videoId}.${language}.json3`;
    if (files.includes(expected)) return expected;
  }
  return null;
}

function languageFromFilename(filename, videoId) {
  return filename.slice(videoId.length + 1, -'.json3'.length).replace(/-orig$/, '');
}
