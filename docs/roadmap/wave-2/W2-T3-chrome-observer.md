# W2-T3 — Chrome Playback Observer

- **Lane:** browser/JavaScript
- **Branch:** `work/w2-t3-chrome-observer`
- **Estimate:** 3–5 hours
- **Depends on:** W1-T2, W1-T4

## Goal

Emit schema-valid playback state from YouTube through a transport-neutral extension boundary.

## Inputs

- Playback message schema and valid/invalid fixtures.
- Manifest V3 extension scaffold.

## Work

- Observe YouTube SPA navigation and reacquire the active `<video>` when it changes.
- Emit immediately on play, pause, seeked, ratechange, loadedmetadata, and video change.
- Emit every 250 ms while playing and avoid continuous paused polling.
- Forward through the service worker to a replaceable transport adapter.
- Recover from service-worker suspension and avoid duplicate listeners.
- Request only minimum YouTube host permissions; defer native messaging to W3-T2.

## Deliverables

- Content script, service worker, mock transport, and manifest permissions.
- Automated schema/message tests where practical.
- A DevTools verification checklist.

## Acceptance checks

- Video ID, time, duration, paused state, and rate update correctly.
- SPA navigation changes the observed video without extension reload.
- Detached videos leave no timers or listeners behind.
- Native messaging is not required for component tests.

## Handoff to integration

Report the transport adapter interface, content-to-worker message path, reconnect expectations, manifest permissions, and manual cases performed. W3-T2 must implement the same adapter interface.
