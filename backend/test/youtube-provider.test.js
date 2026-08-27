import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  YouTubeCaptionProvider,
  extractInitialPlayerResponse,
  json3Cues,
  selectCaptionTrack
} from '../src/transcript/youtube-provider.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const track = (languageCode, kind) => ({
  baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=${languageCode}`,
  languageCode,
  ...(kind ? { kind } : {})
});

const player = ({ status = { status: 'OK' }, tracks } = {}) => ({
  playabilityStatus: status,
  ...(tracks === undefined
    ? {}
    : { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } })
});

const watchPage = (response) =>
  `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(response)};</script></html>`;

test('extracts balanced player JSON even when strings contain braces', () => {
  const response = player({ tracks: [track('en')] });
  response.videoDetails = { title: 'A title with } and { braces' };
  assert.deepEqual(extractInitialPlayerResponse(watchPage(response)), response);
});

test('caption selection prefers exact language then base language, manual before automatic', () => {
  const tracks = [track('en', 'asr'), track('en'), track('en-US', 'asr')];
  assert.equal(selectCaptionTrack(tracks, { language: 'en-US' }).languageCode, 'en-US');
  assert.equal(selectCaptionTrack(tracks, { language: 'en-US', captionSource: 'manual' }), tracks[1]);
  assert.throws(() => selectCaptionTrack(tracks, { language: 'fr' }), (error) => {
    assert.equal(error.code, 'UNSUPPORTED_LANGUAGE');
    assert.deepEqual(error.details.availableLanguages, ['en:automatic', 'en:manual', 'en-US:automatic']);
    return true;
  });
});

test('converts JSON3 events into provider-neutral cues', () => {
  assert.deepEqual(
    json3Cues({
      events: [
        { tStartMs: 1200, dDurationMs: 500, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] },
        { tStartMs: 1800, dDurationMs: 300 }
      ]
    }),
    [
      { startMs: 1200, durationMs: 500, text: 'hello world' },
      { startMs: 1800, durationMs: 300, text: '' }
    ]
  );
});

test('fetches the selected caption track through the provider boundary', async () => {
  const calls = [];
  const provider = new YouTubeCaptionProvider({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return new Response(watchPage(player({ tracks: [track('en', 'asr'), track('en')] })));
      }
      return new Response(JSON.stringify({
        events: [{ tStartMs: 1000, dDurationMs: 750, segs: [{ utf8: 'Hello' }] }]
      }), { headers: { 'content-type': 'application/json' } });
    }
  });

  const result = await provider.fetchTranscript({ videoId: VIDEO_ID, language: 'en-US' });
  assert.equal(result.captionSource, 'manual');
  assert.equal(result.language, 'en');
  assert.deepEqual(result.cues, [{ startMs: 1000, durationMs: 750, text: 'Hello' }]);
  assert.match(calls[0], /\/watch\?v=dQw4w9WgXcQ/);
  assert.match(calls[1], /fmt=json3/);
});

test('maps private, deleted, captions-disabled, and unsupported-language videos', async () => {
  const cases = [
    [player({ status: { status: 'LOGIN_REQUIRED', reason: 'This is a private video' } }), 'VIDEO_PRIVATE'],
    [player({ status: { status: 'ERROR', reason: 'This video has been removed' } }), 'VIDEO_NOT_FOUND'],
    [player(), 'CAPTIONS_DISABLED'],
    [player({ tracks: [track('es')] }), 'UNSUPPORTED_LANGUAGE']
  ];

  for (const [response, code] of cases) {
    const provider = new YouTubeCaptionProvider({
      fetchImpl: async () => new Response(watchPage(response))
    });
    await assert.rejects(provider.fetchTranscript({ videoId: VIDEO_ID, language: 'en-US' }), (error) => {
      assert.equal(error.code, code);
      return true;
    });
  }
});

test('rejects a caption URL outside the YouTube HTTPS boundary', async () => {
  const unsafe = { ...track('en'), baseUrl: 'https://example.com/captions' };
  const provider = new YouTubeCaptionProvider({
    fetchImpl: async () => new Response(watchPage(player({ tracks: [unsafe] })))
  });
  await assert.rejects(provider.fetchTranscript({ videoId: VIDEO_ID, language: 'en' }), (error) => {
    assert.equal(error.code, 'TRANSCRIPT_UNAVAILABLE');
    assert.match(error.message, /unsafe/);
    return true;
  });
});
