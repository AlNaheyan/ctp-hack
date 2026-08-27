# W3-T2 — Chrome Native Messaging Bridge

- **Lane:** browser/platform
- **Branch:** `work/w3-t2-native-messaging`
- **Estimate:** 4–6 hours
- **Depends on:** W2-T3, W2-T4

## Goal

Move extension playback messages into the Mac timeline session reliably.

## Inputs

- Extension transport-adapter interface.
- Swift playback decoder/session input.
- Native-message schema and size limits.

## Work

- Implement 4-byte little-endian length framing and UTF-8 JSON validation.
- Add an exact extension-origin allowlist in the native-host manifest.
- Add reversible development registration/unregistration scripts.
- Implement reconnect/backoff and visible connection state.
- Reject invalid or oversized frames before the timeline engine.
- Time-box the official host path; if necessary, use a loopback-only WebSocket behind the same adapter and document it.

## Deliverables

- Extension native transport, Mac host/helper, manifest, and registration scripts.
- Framing/validation tests and restart checklist.
- Connection-state interface consumed by W3-T3/W3-T4.

## Acceptance checks

- Playback state reaches Mac state within 500 ms.
- Invalid/oversized frames cannot crash the host or app.
- Extension, Chrome, app, and service-worker restarts reconnect.
- Installation is explicit and reversible.

## Handoff to integration

Report host name, manifest locations, extension ID assumptions, registration commands, connection-state interface, and fallback status. Never commit a developer-specific absolute path.
