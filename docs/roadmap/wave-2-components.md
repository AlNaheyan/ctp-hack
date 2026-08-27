# Wave 2 — Parallel Components

Start after Wave 1 contracts are frozen. The four tickets intentionally communicate only through fixtures.

## W2-T1 — YouTube URL validation and transcript ingestion

**Suggested owner:** backend/ingestion
**Estimate:** 3–5 hours
**Depends on:** W1-T2, W1-T4

### Outcome

The backend turns a supported YouTube URL into a normalized timestamped transcript.

### Work

- Accept normal watch, `youtu.be`, and share URLs; extract a canonical video ID and reject unrelated hosts.
- Retrieve available captions with a bounded timeout and normalize segments to speaker/text/start/end records.
- Prefer creator captions, then automatic captions, using a documented language policy.
- Preserve enough timing detail for the analyzer to create intervals.
- Return typed failures for private/deleted videos, disabled captions, and unavailable languages.
- Add a transcript cache keyed by video ID and transcript/language choice.

### Acceptance criteria

- Fixture tests cover every supported URL form and failure category.
- Transcript records are ordered, finite, nonnegative, and contain no empty segments.
- Network requests have timeouts and do not log full transcripts by default.
- One known public video works in a live integration test.

### Files owned

Backend URL, transcript, and transcript-cache modules only.

## W2-T2 — Structured argument analysis pipeline

**Suggested owner:** AI/backend
**Estimate:** 4–6 hours
**Depends on:** W1-T2, W1-T4

### Outcome

The analyzer converts a transcript fixture into schema-valid, evidence-grounded insight events.

### Work

- Define the supported MVP taxonomy, such as unsupported claim, contradiction, strawman, evasion, and missing premise.
- Prompt Gemini for strict structured output matching the shared schema.
- Chunk long transcripts with overlap while preserving original timestamps and speaker labels.
- Validate model output, clamp/reject invalid values, sort events, and deduplicate overlaps.
- Prevent prompt injection from transcript text by treating it strictly as quoted source material.
- Record model name and prompt version internally for cache invalidation and debugging.

### Acceptance criteria

- Golden transcript analysis produces only schema-valid events.
- Every event points to a real transcript interval and includes concise evidence.
- Malformed model output retries once with a repair path, then returns a typed failure.
- Unit tests use recorded/stubbed model output; a live Gemini test is opt-in.

### Files owned

Backend analyzer, prompts, model adapter, and analysis post-processing only.

## W2-T3 — Chrome playback observer extension

**Suggested owner:** browser/JavaScript
**Estimate:** 3–5 hours
**Depends on:** W1-T2, W1-T4

### Outcome

An unpacked Manifest V3 extension emits validated playback state from YouTube.

### Work

- Observe YouTube's single-page navigation and reacquire the active `<video>` when it changes.
- Send immediate state on play, pause, seeked, ratechange, loadedmetadata, and video change.
- While playing, emit at 250 ms; while paused, do not poll continuously.
- Forward content-script messages through the service worker toward a replaceable transport adapter.
- Reconnect cleanly after service-worker suspension and avoid duplicate event listeners.
- Request only the minimum YouTube host and native-messaging permissions.

### Acceptance criteria

- DevTools shows correct video ID, time, duration, paused state, and rate after play, pause, seek, speed change, and SPA navigation.
- Messages match the shared fixture schema.
- No timer continues after the observed video is detached or the tab leaves YouTube.
- Transport can be replaced with a mock so native messaging is not required for tests.

### Files owned

The Chrome extension directory only.

## W2-T4 — macOS timeline engine and 24-hour local cache

**Suggested owner:** Swift/domain logic
**Estimate:** 4–6 hours
**Depends on:** W1-T2, W1-T3

### Outcome

Pure Swift logic loads analysis fixtures, matches playback crossings, handles seeks, and caches results.

### Work

- Add discussion-specific models without reusing the existing music `PlaybackState` type.
- Decode and validate analysis/playback contracts.
- Implement crossing detection and binary-search pointer reset for deltas over 2 seconds.
- Define rewind behavior and event deduplication per video.
- Persist analysis atomically with `expiresAt`; evict corrupt, expired, or mismatched-schema entries.
- Expose observable state for later UI and transport integration without importing Chrome concerns.

### Acceptance criteria

- Tests cover normal crossing, dropped updates, pause, small jitter, forward seek, backward seek, rewind replay policy, rapid events, and video change.
- A jump from minute 4 to minute 37 does not emit intermediate events.
- Cache hit, miss, expiration, corruption, and manual refresh are tested with an injectable clock.
- Matching is deterministic and does not use a locally advancing timer.

### Files owned

New discussion models/services and their tests. Do not edit notch layout or native host registration.

## Wave 2 exit gate

- Each component passes tests using the same committed fixtures.
- Transcript output can be fed to the analyzer without manual reshaping.
- Extension playback output can be fed to the Swift timeline engine without manual reshaping.
- No component requires the full system to run for ordinary development.
