// Opt-in live model test. Skipped unless you ask for it:
//
//   RUN_LIVE_MODEL_TESTS=1 npm test          (with GEMINI_API_KEY set in .env)
//
// It spends real quota and depends on the network, so it never runs in an
// ordinary `npm test` or in CI.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { REPO_ROOT, loadConfig, loadDotEnv } from '../../src/config.js';
import { analyzeTranscript } from '../../src/analysis/analyzer.js';
import { validateAnalysisResponse } from '../../src/analysis/contract.js';
import { createGeminiProvider } from '../../src/analysis/providers/gemini.js';

loadDotEnv();

const enabled = process.env.RUN_LIVE_MODEL_TESTS === '1';
const hasKey = typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.trim() !== '';

const skip = !enabled
  ? 'set RUN_LIVE_MODEL_TESTS=1 to run the live model test'
  : !hasKey
    ? 'GEMINI_API_KEY is not set; add it to .env to run the live model test'
    : false;

const transcript = JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/valid/transcript.json'), 'utf8'));

test('the live model returns a contract-valid analysis of the golden transcript', { skip }, async () => {
  const config = loadConfig();
  const provider = createGeminiProvider({
    apiKey: process.env.GEMINI_API_KEY,
    model: config.geminiModel,
    timeoutMs: config.analysisTimeoutMs
  });

  const { analysis, meta } = await analyzeTranscript(transcript, {
    provider,
    title: 'Should Cities Make Downtown Car-Free?'
  });

  assert.deepEqual(validateAnalysisResponse(analysis), { valid: true, errors: [] });
  assert.equal(analysis.videoId, transcript.videoId);

  // The model chooses what to report, so the assertion is about grounding and
  // shape rather than an exact set of findings.
  for (const event of analysis.events) {
    const segment = transcript.segments.find(
      (candidate) => candidate.startTime === event.startTime && candidate.endTime === event.endTime
    );
    assert.ok(segment !== undefined, `${event.id} maps to a real segment`);
  }

  assert.equal(meta.chunkCount, 1);
  assert.ok(meta.repairAttempts <= 1, 'at most one repair for the full transcript');

  process.stderr.write(
    `\nlive model: ${meta.modelId}, ${meta.eventsKept} events, ${meta.repairAttempts} repair(s), ${meta.durationMs} ms\n`
  );
});
