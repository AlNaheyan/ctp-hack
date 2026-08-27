import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { REPO_ROOT } from '../../src/config.js';
import { buildChunkPrompt, buildSystemPrompt, RESPONSE_SCHEMA } from '../../src/analysis/prompt.js';
import { chunkTranscript } from '../../src/analysis/chunker.js';
import { createStubProvider, extractSegments, findingsFor } from '../../src/analysis/providers/stub.js';

const transcript = JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/valid/transcript.json'), 'utf8'));

const promptFor = (segments) =>
  buildChunkPrompt(chunkTranscript(segments)[0], { language: 'en-US' });

test('the stub recovers the segments from the prompt it is given', () => {
  const segments = extractSegments(promptFor(transcript.segments));

  assert.equal(segments.length, transcript.segments.length);
  assert.equal(segments[0].id, 'seg_001');
  assert.equal(segments[0].startTime, 12.4);
});

test('a prompt without a transcript block yields no findings instead of throwing', () => {
  assert.deepEqual(extractSegments('no data here'), []);
  assert.deepEqual(findingsFor([]), []);
});

test('each planted issue in the golden transcript is detected once', () => {
  const findings = findingsFor(transcript.segments);

  assert.deepEqual(
    findings.map((finding) => [finding.segmentId, finding.type]),
    [
      ['seg_001', 'unsupported_claim'],
      ['seg_003', 'missing_premise'],
      ['seg_004', 'strawman'],
      ['seg_005', 'contradiction'],
      ['seg_007', 'evasion']
    ]
  );
});

test('segments that are fine produce nothing', () => {
  const findings = findingsFor([
    { id: 'seg_a', startTime: 0, endTime: 5, speaker: 'Maya Chen', text: 'Thanks for having me.' },
    { id: 'seg_b', startTime: 5, endTime: 9, speaker: 'Jon Bell', text: 'Happy to be here.' }
  ]);

  assert.deepEqual(findings, []);
});

test('a sourced claim is not reported as unsupported', () => {
  const findings = findingsFor([
    {
      id: 'seg_a',
      startTime: 0,
      endTime: 6,
      speaker: 'Maya Chen',
      text: 'According to the city study, almost every serious injury downtown involves a car.'
    }
  ]);

  assert.deepEqual(findings, []);
});

test('evidence is always a quote from the segment it refers to', () => {
  for (const finding of findingsFor(transcript.segments)) {
    const segment = transcript.segments.find((candidate) => candidate.id === finding.segmentId);
    assert.ok(segment.text.includes(finding.evidence), `${finding.segmentId} evidence is quoted verbatim`);
  }
});

test('confidence is always inside the contract range', () => {
  for (const finding of findingsFor(transcript.segments)) {
    assert.ok(finding.confidence >= 0 && finding.confidence <= 1);
  }
});

test('the provider answers with the JSON contract and is deterministic', async () => {
  const provider = createStubProvider();
  const request = {
    system: buildSystemPrompt(),
    user: promptFor(transcript.segments),
    responseSchema: RESPONSE_SCHEMA
  };

  const first = await provider.generate(request);
  const second = await provider.generate(request);

  assert.equal(first.text, second.text);
  assert.equal(provider.name, 'stub');

  const parsed = JSON.parse(first.text);
  assert.equal(parsed.findings.length, 5);
});
