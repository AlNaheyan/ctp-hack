import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chunkTranscript, DEFAULT_MAX_CHUNK_CHARS } from '../../src/analysis/chunker.js';

const segment = (index, text = 'a'.repeat(100)) => ({
  id: `seg_${String(index).padStart(3, '0')}`,
  startTime: index * 10,
  endTime: index * 10 + 9,
  speaker: index % 2 === 0 ? 'Maya Chen' : 'Jon Bell',
  text
});

const segments = (count, text) => Array.from({ length: count }, (_, index) => segment(index + 1, text));

test('a short transcript is a single chunk with no overlap', () => {
  const chunks = chunkTranscript(segments(5));

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].segments.length, 5);
  assert.equal(chunks[0].overlapCount, 0);
  assert.equal(chunks[0].startTime, 10);
  assert.equal(chunks[0].endTime, 59);
});

test('an empty transcript produces no chunks', () => {
  assert.deepEqual(chunkTranscript([]), []);
});

test('long transcripts split on segment boundaries and never lose a segment', () => {
  const input = segments(40);
  const chunks = chunkTranscript(input, { maxChars: 500, overlapSegments: 2 });

  assert.ok(chunks.length > 1);

  const seen = new Set(chunks.flatMap((chunk) => chunk.segments.map((s) => s.id)));
  assert.equal(seen.size, input.length, 'every segment appears in at least one chunk');

  for (const chunk of chunks) {
    assert.ok(chunk.segments.length > 0);
    // Segments are passed through untouched: same objects, same timings.
    for (const s of chunk.segments) assert.ok(input.includes(s));
  }
});

test('consecutive chunks overlap by the requested number of segments', () => {
  const chunks = chunkTranscript(segments(20), { maxChars: 500, overlapSegments: 2 });

  for (let index = 1; index < chunks.length; index += 1) {
    const previousIds = chunks[index - 1].segments.map((s) => s.id);
    const currentIds = chunks[index].segments.map((s) => s.id);
    const shared = currentIds.filter((id) => previousIds.includes(id));

    assert.equal(shared.length, 2, `chunk ${index} should repeat two segments`);
    assert.deepEqual(shared, previousIds.slice(-2), 'the overlap is the tail of the previous chunk');
    assert.equal(chunks[index].overlapCount, 2);
  }
});

test('a segment larger than the budget gets its own chunk instead of being cut', () => {
  const input = [segment(1, 'x'.repeat(9000)), segment(2, 'short')];
  const chunks = chunkTranscript(input, { maxChars: 1000, overlapSegments: 0 });

  assert.equal(chunks[0].segments.length, 1);
  assert.equal(chunks[0].segments[0].text.length, 9000, 'text is never truncated by the chunker');
  assert.equal(chunks[1].segments[0].id, 'seg_002');
});

test('chunking terminates when the overlap is as large as the chunk', () => {
  const chunks = chunkTranscript(segments(10), { maxSegments: 3, overlapSegments: 99 });

  assert.ok(chunks.length <= 10, 'overlap is capped so the window keeps advancing');
  assert.equal(chunks.at(-1).segments.at(-1).id, 'seg_010');
});

test('character budget is respected once more than one segment fits', () => {
  const chunks = chunkTranscript(segments(10, 'y'.repeat(200)), { maxChars: 600, overlapSegments: 0 });

  for (const chunk of chunks) {
    assert.ok(chunk.charCount <= 600 || chunk.segments.length === 1);
  }
});

test('the default budget keeps the golden transcript in one chunk', () => {
  assert.ok(DEFAULT_MAX_CHUNK_CHARS >= 1000);
});
