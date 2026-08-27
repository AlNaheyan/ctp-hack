import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeTranscript } from '../src/transcript/normalizer.js';

const input = () => ({
  videoId: 'dQw4w9WgXcQ',
  language: 'en-US',
  captionSource: 'manual',
  cues: [
    { startMs: 2200, durationMs: 800, text: '  second\n cue  ' },
    { startMs: 1000, durationMs: 750, text: 'First &amp; clear' },
    { startMs: 4000, durationMs: 1000, text: '   ' }
  ]
});

test('normalizes, cleans, and orders caption cues without losing timing precision', () => {
  const transcript = normalizeTranscript(input(), { clock: () => Date.parse('2026-08-27T16:00:00Z') });

  assert.deepEqual(
    transcript.segments.map(({ startTime, endTime, text }) => ({ startTime, endTime, text })),
    [
      { startTime: 1, endTime: 1.75, text: 'First & clear' },
      { startTime: 2.2, endTime: 3, text: 'second cue' }
    ]
  );
  assert.equal(transcript.schemaVersion, 1);
  assert.equal(transcript.fetchedAt, '2026-08-27T16:00:00.000Z');
  assert.match(transcript.segments[0].id, /^seg_[a-f0-9]{20}$/);
});

test('stable segment IDs do not depend on provider cue order', () => {
  const first = normalizeTranscript(input());
  const reversed = input();
  reversed.cues.reverse();
  const second = normalizeTranscript(reversed);
  assert.deepEqual(
    first.segments.map((segment) => segment.id),
    second.segments.map((segment) => segment.id)
  );
});

test('duplicate source cues receive unique deterministic IDs', () => {
  const duplicate = input();
  duplicate.cues = [duplicate.cues[0], { ...duplicate.cues[0] }];
  const transcript = normalizeTranscript(duplicate);
  assert.equal(new Set(transcript.segments.map((segment) => segment.id)).size, 2);
  assert.match(transcript.segments[1].id, /_2$/);
});

test('rejects negative, non-finite, and empty provider output', () => {
  for (const cues of [
    [{ startMs: -1, durationMs: 2, text: 'bad' }],
    [{ startMs: 1, durationMs: Number.NaN, text: 'bad' }],
    [{ startMs: 1, durationMs: 2, text: '  ' }],
    []
  ]) {
    assert.throws(() => normalizeTranscript({ ...input(), cues }), (error) => {
      assert.equal(error.code, 'TRANSCRIPT_UNAVAILABLE');
      return true;
    });
  }
});
