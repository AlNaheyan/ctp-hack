# W2-T1 — YouTube Transcript Ingestion

- **Lane:** backend/ingestion
- **Branch:** `work/w2-t1-transcript-ingestion`
- **Estimate:** 3–5 hours
- **Depends on:** W1-T2, W1-T4

## Goal

Turn a supported YouTube URL into normalized, timestamped transcript records.

## Inputs

- Canonical transcript schema and fixtures.
- Backend scaffold and environment conventions.

## Work

- Accept watch, `youtu.be`, and share URLs; extract a canonical video ID and reject unrelated hosts.
- Retrieve captions with bounded timeouts and a documented language/caption preference.
- Normalize segments to schema-valid text/start/end records while preserving timing detail.
- Return typed errors for private, deleted, captions-disabled, and unsupported-language videos.
- Cache transcripts by video ID, language, and caption source.
- Avoid logging full transcripts by default.

## Deliverables

- URL parser, transcript provider adapter, normalizer, and transcript cache.
- Unit fixtures plus one opt-in live integration test.
- A callable service boundary consumed by W3-T1.

## Acceptance checks

- Supported URL forms and failure categories have tests.
- Records are ordered, finite, nonnegative, and nonempty.
- Network calls have timeouts and typed failures.
- One known public video works in an opt-in live test.

## Handoff to integration

Report the service function signature, normalized output path/type, cache key, timeout behavior, and typed errors. Do not expose an HTTP route; W3-T1 owns orchestration.
