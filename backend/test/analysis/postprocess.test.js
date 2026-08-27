import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEDUPE_BY, UNKNOWN_SPEAKER, buildEvents, eventId, triggerTimeFor } from '../../src/analysis/postprocess.js';

const segments = [
  { id: 'seg_001', startTime: 10, endTime: 20, speaker: 'Maya Chen', text: 'first' },
  { id: 'seg_002', startTime: 18, endTime: 30, speaker: 'Jon Bell', text: 'second' },
  { id: 'seg_003', startTime: 40, endTime: 50, text: 'third, no speaker' }
];

const segmentsById = new Map(segments.map((segment) => [segment.id, segment]));

const finding = (overrides = {}) => ({
  segmentId: 'seg_001',
  type: 'unsupported_claim',
  title: 'Claim needs a source',
  summary: 'No support offered.',
  confidence: 0.8,
  evidence: 'first',
  ...overrides
});

test('event ids are stable and match the contract pattern', () => {
  const id = eventId('unsupported_claim', 'seg_001');

  assert.equal(id, 'evt_unsupported_claim_seg_001');
  assert.match(id, /^[A-Za-z][A-Za-z0-9_-]{0,127}$/);
  assert.equal(eventId('evasion', 'seg/weird id'), 'evt_evasion_seg_weird_id');
});

test('the trigger point sits inside the segment', () => {
  assert.equal(triggerTimeFor({ startTime: 10, endTime: 20 }), 15);
  assert.equal(triggerTimeFor({ startTime: 12.4, endTime: 23.1 }), 17.75);
  assert.equal(triggerTimeFor({ startTime: 5, endTime: 5 }), 5);
});

test('events take their timings from the transcript, not the model', () => {
  const { events } = buildEvents([finding()], { segmentsById });

  assert.equal(events.length, 1);
  assert.equal(events[0].startTime, 10);
  assert.equal(events[0].endTime, 20);
  assert.equal(events[0].triggerTime, 15);
  assert.equal(events[0].speaker, 'Maya Chen');
});

test('a segment without a speaker still produces a contract-valid speaker', () => {
  const { events } = buildEvents([finding({ segmentId: 'seg_003' })], { segmentsById });

  assert.equal(events[0].speaker, UNKNOWN_SPEAKER);
});

test('the same finding from two overlapping chunks is kept once, strongest wins', () => {
  const { events, removed } = buildEvents([finding({ confidence: 0.6 }), finding({ confidence: 0.95 })], {
    segmentsById
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].confidence, 0.95);
  assert.equal(removed[0].reason, DEDUPE_BY.id);
});

test('overlapping events of the same type collapse into one', () => {
  const { events, removed } = buildEvents(
    [finding({ segmentId: 'seg_001', confidence: 0.7 }), finding({ segmentId: 'seg_002', confidence: 0.9 })],
    { segmentsById }
  );

  assert.equal(events.length, 1, 'seg_001 and seg_002 overlap in time');
  assert.equal(events[0].confidence, 0.9);
  assert.equal(removed.at(-1).reason, DEDUPE_BY.overlap);
});

test('overlapping events of different types are both kept', () => {
  const { events } = buildEvents(
    [finding({ segmentId: 'seg_001' }), finding({ segmentId: 'seg_002', type: 'evasion' })],
    { segmentsById }
  );

  assert.equal(events.length, 2);
});

test('events are sorted by triggerTime then id', () => {
  const { events } = buildEvents(
    [
      finding({ segmentId: 'seg_003', type: 'evasion' }),
      finding({ segmentId: 'seg_001' }),
      finding({ segmentId: 'seg_001', type: 'strawman' })
    ],
    { segmentsById }
  );

  const triggers = events.map((event) => event.triggerTime);
  assert.deepEqual(triggers, [...triggers].sort((a, b) => a - b));

  const sameTrigger = events.filter((event) => event.triggerTime === 15).map((event) => event.id);
  assert.deepEqual(sameTrigger, [...sameTrigger].sort());
});

test('minConfidence drops weak findings and records why', () => {
  const { events, removed } = buildEvents([finding({ confidence: 0.2 })], { segmentsById, minConfidence: 0.5 });

  assert.equal(events.length, 0);
  assert.equal(removed[0].reason, 'below_min_confidence');
});

test('findings for unknown segments cannot become events', () => {
  const { events } = buildEvents([finding({ segmentId: 'seg_404' })], { segmentsById });
  assert.equal(events.length, 0);
});
