# W4-T1 — End-to-End Integration and Latency

- **Lane:** integration lead
- **Branch:** `work/w4-t1-end-to-end`
- **Estimate:** 4–6 hours
- **Depends on:** all Wave 3 packages

## Goal

Make the complete known-video and unseen-video flows reliable, measurable, and free of manual state repair.

## Inputs

- Wave 3 integrated API, native bridge, timeline session, and cards.
- Known video, expected insight timestamps, and smoke checklist.

## Work

- Exercise URL -> transcript -> analysis -> cache -> playback -> timeline -> card.
- Measure cold analysis, warm load, playback-message delay, and card trigger error.
- Fix contract mismatches at adapters instead of weakening schemas.
- Verify pause, seek, rewind, rate change, tab switch, video navigation, and process restarts.
- Add diagnostic correlation IDs across the request/session path where useful.
- Tune polling and presentation timing only from observed measurements.

## Deliverables

- Integrated known-video and unseen-video run results.
- Latency table and cross-component diagnostic instructions.
- Adapter-only fixes required for the full path.

## Acceptance checks

- Warm cached analysis is ready in under 1 second on the demo machine.
- Normal-playback cards appear within 500 ms of `triggerTime`.
- Seeks over 2 seconds emit no skipped intermediate cards.
- Known-video flow succeeds twice after restarting Chrome and the app.

## Handoff to integration

Report measurements, exact videos/timestamps, adapter changes, remaining flaky cases, and diagnostic commands. Coordinate before editing files owned by W4-T2 or W4-T3.
