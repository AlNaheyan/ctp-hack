# W2-T4 — macOS Timeline Engine and 24-Hour Cache

- **Lane:** Swift/domain logic
- **Branch:** `work/w2-t4-timeline-cache`
- **Estimate:** 4–6 hours
- **Depends on:** W1-T2, W1-T3

## Goal

Load analysis, match player-time crossings, handle seeks, and persist timelines without depending on UI or Chrome.

## Inputs

- Analysis/playback schemas and fixtures.
- UX trigger, replay, and queue policy.

## Work

- Add discussion-specific Codable models; do not reuse the music `PlaybackState`.
- Implement crossing detection: `previousTime < triggerTime <= currentTime`.
- Treat absolute deltas over 2 seconds as seeks and reset by binary search.
- Implement the approved rewind/deduplication policy per video.
- Persist analysis atomically and evict expired, corrupt, or incompatible entries.
- Inject clock and storage boundaries for deterministic tests.

## Deliverables

- Pure Swift timeline engine, cache, and observable session state.
- Unit tests for crossing, seeks, rewind, jitter, rapid events, and video change.
- Public interfaces consumed by W3-T2, W3-T3, and W3-T4.

## Acceptance checks

- A 4-to-37-minute seek emits no intermediate event.
- Pause and duplicate updates do not retrigger cards.
- Cache hit, miss, expiry, corruption, and refresh are tested.
- No local timer advances playback time.

## Handoff to integration

Report public Swift types, actor/main-thread expectations, event publisher interface, cache location/key, and replay policy. Avoid notch layout, networking, and native-host files.
