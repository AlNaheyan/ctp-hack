import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DROP_REASONS,
  FIELD_MAX,
  ModelOutputError,
  extractFindings,
  isGrounded,
  normalizeFindings,
  parseModelJson
} from '../../src/analysis/validator.js';

const segmentsById = new Map([
  [
    'seg_001',
    {
      id: 'seg_001',
      startTime: 12.4,
      endTime: 23.1,
      speaker: 'Maya Chen',
      text: 'Almost every serious injury downtown is caused by a car, so the center should be car-free.'
    }
  ]
]);

const finding = (overrides = {}) => ({
  segmentId: 'seg_001',
  type: 'unsupported_claim',
  title: 'Claim needs a source',
  summary: 'A statistical claim is made with no supporting data.',
  confidence: 0.9,
  evidence: 'Almost every serious injury downtown is caused by a car',
  ...overrides
});

test('parses plain JSON', () => {
  assert.deepEqual(parseModelJson('{"findings":[]}'), { findings: [] });
});

test('tolerates markdown fences and surrounding prose', () => {
  assert.deepEqual(parseModelJson('```json\n{"findings":[]}\n```'), { findings: [] });
  assert.deepEqual(parseModelJson('Here you go:\n{"findings":[]}\nHope that helps.'), { findings: [] });
});

test('unusable output raises a repairable error', () => {
  assert.throws(() => parseModelJson('I could not analyse that.'), ModelOutputError);
  assert.throws(() => parseModelJson(''), ModelOutputError);
});

test('a response without a findings array is repairable, an empty object is not an error', () => {
  assert.throws(() => extractFindings({ result: 'none' }), ModelOutputError);
  assert.deepEqual(extractFindings({}), []);
  assert.deepEqual(extractFindings([]), []);
});

test('a valid finding survives normalization unchanged', () => {
  const { findings, dropped, groundingFallbacks } = normalizeFindings({ findings: [finding()] }, { segmentsById });

  assert.equal(dropped.length, 0);
  assert.equal(groundingFallbacks, 0);
  assert.equal(findings[0].type, 'unsupported_claim');
  assert.equal(findings[0].grounded, true);
});

test('findings referencing an unknown segment are dropped', () => {
  const { findings, dropped } = normalizeFindings(
    { findings: [finding({ segmentId: 'seg_999' })] },
    { segmentsById }
  );

  assert.equal(findings.length, 0);
  assert.equal(dropped[0].reason, DROP_REASONS.unknownSegment);
});

test('types outside the contract enum are dropped', () => {
  const { findings, dropped } = normalizeFindings(
    { findings: [finding({ type: 'whataboutism' })] },
    { segmentsById }
  );

  assert.equal(findings.length, 0);
  assert.equal(dropped[0].reason, DROP_REASONS.unknownType);
});

test('out-of-range confidence is clamped, not dropped', () => {
  const { findings } = normalizeFindings(
    { findings: [finding({ confidence: 1.4 }), finding({ segmentId: 'seg_001', confidence: -2, type: 'evasion' })] },
    { segmentsById }
  );

  assert.equal(findings[0].confidence, 1);
  assert.equal(findings[1].confidence, 0);
});

test('non-numeric confidence is dropped', () => {
  const { findings, dropped } = normalizeFindings({ findings: [finding({ confidence: 'high' })] }, { segmentsById });

  assert.equal(findings.length, 0);
  assert.equal(dropped[0].reason, DROP_REASONS.invalidConfidence);
});

test('empty titles or summaries are dropped', () => {
  const { dropped } = normalizeFindings(
    { findings: [finding({ title: '   ' }), finding({ summary: '' })] },
    { segmentsById }
  );

  assert.deepEqual(
    dropped.map((entry) => entry.reason),
    [DROP_REASONS.emptyText, DROP_REASONS.emptyText]
  );
});

test('overlong fields are truncated to the contract ceilings', () => {
  const { findings, truncated } = normalizeFindings(
    { findings: [finding({ title: 'T'.repeat(400), summary: 'S'.repeat(2000) })] },
    { segmentsById }
  );

  assert.ok(findings[0].title.length <= FIELD_MAX.title);
  assert.ok(findings[0].summary.length <= FIELD_MAX.summary);
  assert.equal(truncated, 1);
});

test('ungrounded evidence falls back to the real segment text', () => {
  const { findings, groundingFallbacks } = normalizeFindings(
    { findings: [finding({ evidence: 'A quote that was never said in this transcript.' })] },
    { segmentsById }
  );

  assert.equal(groundingFallbacks, 1);
  assert.equal(findings[0].grounded, false);
  assert.ok(segmentsById.get('seg_001').text.startsWith(findings[0].evidence.replace('…', '')));
});

test('grounding ignores punctuation and casing drift', () => {
  const text = segmentsById.get('seg_001').text;

  assert.equal(isGrounded('almost every serious injury downtown is caused by a car', text), true);
  assert.equal(isGrounded('"Almost every serious injury downtown, is caused by a CAR!"', text), true);
  assert.equal(isGrounded('the shops will lose customers', text), false);
});

test('non-object entries in the findings array are dropped', () => {
  const { findings, dropped } = normalizeFindings({ findings: ['unsupported_claim', null, 42] }, { segmentsById });

  assert.equal(findings.length, 0);
  assert.equal(dropped.length, 3);
  assert.ok(dropped.every((entry) => entry.reason === DROP_REASONS.notAnObject));
});
