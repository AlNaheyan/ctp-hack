# W2-T2 — Structured Argument Analysis Pipeline

- **Lane:** AI/backend
- **Branch:** `work/w2-t2-analysis-pipeline`
- **Estimate:** 4–6 hours
- **Depends on:** W1-T2, W1-T4

## Goal

Convert a transcript fixture into evidence-grounded, schema-valid insight events.

## Inputs

- Canonical transcript and analysis schemas.
- Golden transcript fixture and mocked model adapter.

## Work

- Define the MVP taxonomy: unsupported claim, contradiction, strawman, evasion, and missing premise.
- Prompt Gemini for strict structured output.
- Chunk long transcripts with overlap while preserving timestamps and speakers.
- Validate, sort, clamp/reject invalid values, and deduplicate overlapping events.
- Treat transcript content strictly as quoted source data to limit prompt injection.
- Track model and prompt versions internally for caching/debugging.

## Deliverables

- Provider-neutral analyzer interface and Gemini adapter.
- Versioned prompt, chunker, validator, and post-processor.
- Stubbed unit tests plus one opt-in live model test.

## Acceptance checks

- Golden transcript produces schema-valid events.
- Every event points to a real transcript interval and concise evidence.
- Malformed output retries one repair attempt, then returns a typed failure.
- Ordinary tests require no API key or network.

## Handoff to integration

Report analyzer signature, taxonomy, model/prompt version fields, chunk limits, retry policy, and typed errors. W3-T1 will own final caching and HTTP exposure.
