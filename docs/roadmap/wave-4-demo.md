# Wave 4 — Demo Hardening

Merge Wave 3 first, then assign these four tickets with strict ownership. W4-T1 owns only cross-component glue fixes; other owners keep tests, packaging, and demo materials isolated.

## W4-T1 — End-to-end integration and latency pass

**Suggested owner:** integration lead
**Estimate:** 4–6 hours
**Depends on:** all Wave 3 tickets

### Outcome

The complete known-video and unseen-video flows work with acceptable latency and no manual state repair.

### Work

- Run URL -> transcript -> analysis -> app cache -> Chrome playback -> timeline -> notch card.
- Measure cold analysis time, warm load time, playback-message delay, and card trigger error.
- Fix contract mismatches at adapters rather than weakening validation.
- Verify pause, seek, rewind, rate change, tab switch, video navigation, Chrome restart, and app restart.
- Tune polling and card timing only from measurements.

### Acceptance criteria

- Warm cached analysis is ready in under 1 second on the demo machine.
- During normal playback, cards appear within 500 ms of `triggerTime`.
- A seek over 2 seconds emits no skipped intermediate cards.
- The scripted known-video flow succeeds twice consecutively after restarts.

### Files owned

Cross-component adapters and integration-only fixes. Coordinate before editing files owned by W4-T2 or W4-T3.

## W4-T2 — Reliability, contract, and regression suite

**Suggested owner:** QA/test
**Estimate:** 3–5 hours
**Depends on:** all Wave 3 tickets

### Outcome

A short automated suite catches the failures most likely to break the demo.

### Work

- Add contract tests across backend, extension, and Swift fixtures.
- Add deterministic timeline property/edge tests around seeks, duplicate updates, and closely spaced events.
- Add API tests for cache, concurrency, provider failure, and unavailable captions.
- Add extension tests for SPA navigation and listener cleanup where practical.
- Add a smoke checklist for interactions that require Chrome/macOS UI.

### Acceptance criteria

- One documented command runs all non-UI tests.
- Schema drift fails CI before integration.
- The top ten manual smoke cases have expected results and take under ten minutes.
- Tests never require a real Gemini key unless explicitly opted in.

### Files owned

Test targets, test helpers, fixtures, and CI workflow only.

## W4-T3 — Local installation and demo packaging

**Suggested owner:** release/platform
**Estimate:** 3–5 hours
**Depends on:** W3-T2, W3-T3, W3-T4

### Outcome

A teammate or judge machine can install the app, extension, and native bridge with a short, reversible process.

### Work

- Produce a debug/release app build using team-safe signing settings.
- Package or document loading the Chrome extension and pin its development extension ID if needed.
- Automate native-host manifest path substitution and registration for the current app location.
- Add uninstall/cleanup steps for the native host registration.
- Verify the GPL-3.0 license and upstream attribution remain in distributed materials.
- Document macOS/Chrome permissions and expected security prompts.

### Acceptance criteria

- A clean test account installs and connects using the runbook.
- No absolute developer path or personal signing identity is baked into committed artifacts.
- Uninstall removes native-host registration without deleting user data unexpectedly.
- Version/build identifiers are visible in diagnostics.

### Files owned

Packaging, installer/registration scripts, release docs, and attribution files.

## W4-T4 — Demo script, fallback assets, and pitch evidence

**Suggested owner:** product/demo
**Estimate:** 2–4 hours
**Depends on:** all Wave 3 tickets

### Outcome

The team can demonstrate value even if live caption/model/network services are unreliable.

### Work

- Choose a short known discussion with clear, pre-reviewed insight moments.
- Prewarm and preserve a schema-valid 24-hour demo cache through the supported app path.
- Write a 2–3 minute script showing submit, processing/ready, normal trigger, pause, speed change, and seek handling.
- Prepare a local mock-backend fallback that uses the same API contract; do not add a hidden product bypass.
- Capture latency numbers, architecture diagram, privacy statement, limitations, and next steps for the pitch.
- Rehearse handoffs and define who recovers each component if it disconnects.

### Acceptance criteria

- The demo has a live path and a clearly disclosed contract-faithful fallback.
- The selected timestamps and expected cards are listed in the runbook.
- The pitch accurately says analysis can be imperfect and distinguishes observations from verdicts.
- No private transcript, user secret, or API key appears on screen or in committed assets.

### Files owned

`docs/demo/`, mock demo fixtures, and presentation assets only.

## Wave 4 exit gate

- Clean-install rehearsal passes.
- Automated checks and the ten-minute smoke suite pass.
- Known-video demo succeeds twice after restarting both Chrome and the app.
- The fallback is tested, disclosed, and uses the production contracts.
