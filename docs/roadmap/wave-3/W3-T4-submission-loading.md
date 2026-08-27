# W3-T4 — URL Submission and Analysis Loading

- **Lane:** macOS/networking
- **Branch:** `work/w3-t4-submission-loading`
- **Estimate:** 4–6 hours
- **Depends on:** W2-T4 and W3-T1's documented contract

## Goal

Accept a YouTube URL, load or cache its analysis, and activate the correct local timeline.

## Inputs

- API documentation and mock endpoint.
- Swift analysis cache/session interfaces.
- UX submission, processing, ready, and error states.

## Work

- Add URL entry to the agreed notch/menu flow with local validation.
- Implement API client timeouts, cancellation, and typed errors.
- Read valid local analysis before calling backend; add refresh and retry.
- Activate events only when browser video ID matches loaded analysis.
- Cancel/supersede stale submissions and handle video changes.
- Present no-transcript, offline, server, and schema-version recovery states.

## Deliverables

- API client, analysis-session coordinator, submission UI, and mock-driven tests.
- Cache/offline/manual-refresh verification checklist.
- Interfaces connecting W3-T1, W3-T2, and W3-T3 during integration.

## Acceptance checks

- Fixture URL moves through empty, processing, and ready states.
- Valid local cache works while backend is offline.
- Mismatched video IDs never trigger cards.
- Repeated submissions do not corrupt state or cache.

## Handoff to integration

Report base-URL configuration, API/client interfaces, cancellation rules, timeline activation method, and UI hooks. Do not duplicate cache persistence already owned by W2-T4.
