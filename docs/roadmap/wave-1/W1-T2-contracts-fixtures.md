# W1-T2 — Versioned Contracts and Golden Fixtures

- **Lane:** API/contracts
- **Branch:** `work/w1-t2-contracts-fixtures`
- **Estimate:** 2–3 hours
- **Parallel with:** W1-T1, W1-T3, W1-T4

## Goal

Give backend, extension, and macOS contributors one versioned source of truth for analysis and playback JSON.

## Inputs

- Contract targets in the [roadmap overview](../README.md#shared-api-contract-target).
- UX-required fields from W1-T3; coordinate through review comments, not shared code edits.

## Work

- Define schemas for analysis responses, transcript records, playback messages, and typed API errors.
- Enforce finite nonnegative seconds, `startTime <= triggerTime <= endTime`, stable IDs, confidence in `[0, 1]`, and sorted events.
- Add a synthetic valid timeline with two speakers and at least four insight types.
- Add invalid fixtures for unsorted events, duplicate IDs, bad bounds, and unsupported schema versions.
- Define compatibility rules and payload-size expectations.
- Add a fixture-validation command that does not call YouTube or Gemini.

## Deliverables

- `contracts/` schemas and a short contract README.
- `fixtures/` valid and invalid payloads.
- A deterministic validation command usable by every language lane.

## Acceptance checks

- Golden fixtures validate; each invalid fixture fails for its intended reason.
- Seconds are JSON numbers and dates are UTC RFC 3339 strings.
- Swift, JavaScript, and backend types can be derived without guessing field semantics.
- Unknown optional fields are ignored; unknown major schema versions are rejected.

## Handoff to integration

Report schema version, canonical fixture paths, validation command, compatibility policy, and any open naming decisions. This package merges before W1-T3 and W1-T4 adapters.
