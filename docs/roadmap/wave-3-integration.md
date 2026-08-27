# Wave 3 — Integration Seams

Start when every Wave 2 component passes fixture tests. These tickets join adjacent components while keeping file ownership separate.

## W3-T1 — Analysis API orchestration and server cache

**Suggested owner:** backend lead
**Estimate:** 3–5 hours
**Depends on:** W2-T1, W2-T2

### Outcome

One API request accepts a YouTube URL and returns a cached or newly generated analysis timeline.

### Work

- Implement the analyze endpoint that composes URL validation, transcript retrieval, and structured analysis.
- Cache final results for 24 hours by video ID, language, schema version, model, and prompt version.
- Coalesce simultaneous requests for the same key.
- Add `forceRefresh` for development and a lightweight health endpoint.
- Return stable typed errors without leaking provider responses or secrets.

### Acceptance criteria

- A cold request produces a schema-valid timeline and a warm request avoids transcript/model calls.
- Cache metadata exposes generated/expiry timestamps but not internal secrets.
- Concurrent identical requests trigger at most one analysis job.
- API documentation includes example requests, responses, timeouts, and error codes.

### Files owned

Backend routes, orchestration, final-result cache, and API docs.

## W3-T2 — Chrome native messaging bridge

**Suggested owner:** browser/platform
**Estimate:** 4–6 hours
**Depends on:** W2-T3, W2-T4

### Outcome

Playback messages travel from the extension service worker into the running Mac app or helper.

### Work

- Implement Chrome native-messaging framing (4-byte little-endian length plus UTF-8 JSON) and strict size limits.
- Create the native host manifest with the exact extension origin allowlist.
- Add a development registration/unregistration script for Chrome's native host directory.
- Implement reconnect/backoff and a visible connection state.
- Validate every message before it reaches the timeline engine.
- Time-box the official-host spike; if it cannot be demo-stable, use a loopback-only WebSocket fallback behind the same transport interface and document the deviation.

### Acceptance criteria

- Play, pause, seek, rate change, and video change appear in Mac-side logs/state within 500 ms.
- Invalid or oversized frames are rejected without crashing the app/helper.
- Extension reload, Chrome restart, app restart, and service-worker suspension recover without reinstalling.
- Registration is explicit and reversible.

### Files owned

Native transport/helper, host manifest/scripts, and extension transport adapter. Do not edit analysis loading or card UI.

## W3-T3 — Discussion insight notch cards

**Suggested owner:** SwiftUI/product
**Estimate:** 4–6 hours
**Depends on:** W1-T3, W2-T4

### Outcome

The notch renders polished cards from timeline events and exposes loading/error/connection states.

### Work

- Add a dedicated discussion content type/state rather than overloading brightness, battery, or music values.
- Build compact live-activity and expanded card variants from fixtures.
- Connect card presentation to the timeline engine's emitted event.
- Queue or coalesce events that arrive too close together and define precedence with existing HUD activities.
- Add dismiss and optional “open YouTube at timestamp” actions.
- Add previews for all states and long content.

### Acceptance criteria

- Fixture cards display type, title, summary, speaker, and confidence treatment legibly.
- Cards do not break music, shelf, battery, or HUD behavior when discussion mode is inactive.
- Rapid consecutive events follow the documented queue policy.
- VoiceOver labels and reduced-motion behavior are present.

### Files owned

New discussion SwiftUI components plus the minimum coordinator/layout integration. Avoid networking and native transport files.

## W3-T4 — URL submission, analysis loading, and app cache flow

**Suggested owner:** macOS/networking
**Estimate:** 4–6 hours
**Depends on:** W2-T4, W3-T1 contract (can develop against mock first)

### Outcome

The Mac app accepts a YouTube URL, loads/caches its analysis, and activates the matching timeline for that video.

### Work

- Add URL entry to the agreed notch/menu flow with validation and processing state.
- Implement the API client with bounded timeouts, cancellation, and typed errors.
- Read valid local analysis before calling the backend; provide refresh and retry.
- Activate events only when the browser's current video ID matches the loaded analysis.
- Handle changing submitted/browser videos without stale cards.
- Show useful no-transcript, offline, server, and schema-version errors.

### Acceptance criteria

- Submitting a fixture URL moves through empty -> processing -> ready states.
- A valid unexpired local entry works with the backend offline.
- Mismatched video IDs never trigger cards.
- Repeated submissions cancel or supersede old work and do not corrupt the cache.

### Files owned

Mac API client, submission UI, and analysis session coordinator. Avoid native transport and card rendering internals.

## Wave 3 exit gate

- URL submission through the real API yields a ready local timeline.
- Real Chrome playback updates reach the Swift timeline engine.
- A fixture event emitted by the engine renders as a notch card.
- Cache/offline and reconnect paths work independently before the final end-to-end merge.
