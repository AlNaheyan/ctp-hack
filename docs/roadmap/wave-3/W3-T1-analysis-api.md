# W3-T1 — Analysis API Orchestration

- **Lane:** backend lead
- **Branch:** `work/w3-t1-analysis-api`
- **Estimate:** 3–5 hours
- **Depends on:** W2-T1, W2-T2

## Goal

Expose one endpoint that accepts a YouTube URL and returns cached or newly generated analysis.

## Inputs

- Transcript-ingestion and analyzer service interfaces.
- Analysis and error contracts.

## Work

- Compose URL validation, transcript retrieval, and structured analysis.
- Cache final results for 24 hours by video, language, schema, model, and prompt version.
- Coalesce simultaneous requests for the same key.
- Add development `forceRefresh` and a lightweight health endpoint.
- Apply request timeouts and return stable typed errors without provider leakage.
- Document request/response examples and expected cold-request behavior.

## Deliverables

- Analyze and health routes, orchestration service, and final-result cache.
- Route/cache/concurrency tests.
- API documentation consumed by W3-T4.

## Acceptance checks

- Cold request produces a valid timeline; warm request avoids provider calls.
- Concurrent identical requests start at most one analysis job.
- Cache metadata includes generated/expiry timestamps, not secrets.
- Every documented error matches the shared contract.

## Handoff to integration

Report base URL, endpoints, request timeout guidance, cache headers/metadata, error mapping, and a known test URL. W3-T4 integrates only through this documented HTTP boundary.
