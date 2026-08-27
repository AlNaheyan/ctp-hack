# W4-T2 — Reliability and Regression Suite

- **Lane:** QA/test
- **Branch:** `work/w4-t2-reliability-tests`
- **Estimate:** 3–5 hours
- **Depends on:** all Wave 3 packages

## Goal

Build a fast safety net for the failures most likely to break the demo.

## Inputs

- Integrated component interfaces and all canonical fixtures.
- Wave 3 known-issue and integration logs.

## Work

- Add contract tests across backend, extension, and Swift consumers.
- Add deterministic seek, duplicate-update, jitter, and rapid-event timeline tests.
- Add API cache, concurrency, provider-failure, and unavailable-caption tests.
- Add extension SPA-navigation and listener-cleanup tests where practical.
- Create a ten-minute manual smoke suite for Chrome/macOS UI behavior.
- Make live Gemini/YouTube tests explicitly opt-in.

## Deliverables

- Cross-component test command and CI wiring.
- Automated regression tests and manual smoke checklist.
- Failure triage table naming the likely owning component.

## Acceptance checks

- One documented command runs all non-UI tests.
- Schema drift fails before end-to-end integration.
- Top ten manual cases complete in under ten minutes.
- Default tests need no Gemini key or live network.

## Handoff to integration

Report the exact test command, expected duration, required tools, intentionally skipped cases, and known flaky tests. Test failures must identify the owning lane where possible.
