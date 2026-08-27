# Wave 1 — Contracts and Foundations

Run all four tickets in parallel. This wave prevents four teams from inventing incompatible payloads and UI behavior.

## W1-T1 — Fork baseline and build verification

**Suggested owner:** macOS/platform
**Estimate:** 2–3 hours
**Depends on:** upstream import only

### Outcome

The fork builds and launches unchanged before product work begins.

### Work

- Confirm `origin` points to the team repository and `upstream` points to `TheBoredTeam/boring.notch`.
- Record the imported upstream commit SHA.
- Resolve Swift packages and build the main app plus XPC helper with the hackathon Xcode version.
- Create a product branch naming convention and document how to absorb upstream changes.
- Decide hackathon bundle identifiers and signing team without committing personal signing values.
- Record the actual minimum supported macOS version. The project currently targets macOS 14 even though upstream's source-build README may mention newer tooling.

### Acceptance criteria

- A clean checkout builds from a documented command or Xcode scheme.
- The unchanged app opens, expands, and closes its notch UI.
- No personal signing identity or generated build output is committed.
- `git remote -v`, Xcode version, upstream SHA, and known warnings appear in a short setup note.

### Files owned

`README.md`, build settings if required, and `docs/setup/` only. Avoid product Swift files.

## W1-T2 — Versioned contracts and golden fixtures

**Suggested owner:** API/contracts
**Estimate:** 2–3 hours
**Depends on:** none

### Outcome

Backend, extension, and app share versioned JSON contracts with valid and invalid fixtures.

### Work

- Define JSON Schema or equivalent types for analysis responses and playback messages.
- Require `startTime <= triggerTime <= endTime`, finite nonnegative seconds, stable IDs, confidence in `[0, 1]`, and events sorted by `triggerTime`.
- Define error responses for invalid URL, unavailable transcript, analysis failure, and rate limiting.
- Check in a 3–5 minute synthetic timeline fixture covering two speakers and at least four insight types.
- Check in malformed, unsorted, duplicate-ID, and schema-version mismatch fixtures.
- Write compatibility rules: consumers reject unknown major schema versions and ignore unknown optional fields.

### Acceptance criteria

- Swift, TypeScript/JavaScript, and backend developers can generate or hand-write their types from the same contract.
- Golden payloads validate; negative fixtures fail for the expected reason.
- Times are seconds as JSON numbers and dates are UTC RFC 3339 strings.
- The API and native-message maximum payload expectations are documented.

### Files owned

`contracts/` and `fixtures/` only.

## W1-T3 — Notch UX state machine and card specification

**Suggested owner:** SwiftUI/product
**Estimate:** 2–3 hours
**Depends on:** none

### Outcome

The team has one implementable behavior spec for submission, processing, playback, cards, and errors.

### Work

- Specify states: empty, URL submitted, processing, ready, disconnected from Chrome, playing, paused, card visible, no transcript, and backend error.
- Design compact and expanded insight cards using existing Boring Notch conventions.
- Define card priority if HUD/music and an insight arrive together.
- Define display duration, dismiss behavior, confidence treatment, and an optional “open at timestamp” action.
- Specify accessibility labels, keyboard focus, reduced motion, and contrast requirements.
- Produce lightweight SwiftUI previews or annotated wireframes using fixture data.

### Acceptance criteria

- Every asynchronous state has visible copy and a recovery action.
- A card can render long titles and summaries without exceeding the notch layout.
- The trigger behavior is unambiguous for pause, rewind, seek, rapid consecutive events, and video change.
- The MVP does not require a new full settings architecture.

### Files owned

`docs/design/` and preview-only files. Do not modify shared coordinator code in this wave.

## W1-T4 — Local developer stack and test harness

**Suggested owner:** developer experience
**Estimate:** 2–4 hours
**Depends on:** none

### Outcome

All four lanes can run locally without waiting on live Gemini or YouTube availability.

### Work

- Pick and scaffold the backend runtime, with one command for local startup.
- Define `.env.example` entries and secret-handling rules.
- Add a mock analysis endpoint serving golden fixtures.
- Add lint/test commands for backend and extension, plus the existing Xcode build command.
- Document how Chrome loads the unpacked extension and how native host registration will work.
- Add a single smoke-check command or checklist suitable for pull requests.

### Acceptance criteria

- A developer can start the mock API and receive a fixture with `curl`.
- The extension can be loaded unpacked without a production key.
- Missing secrets produce actionable startup errors and never fall back to committed credentials.
- Setup steps work from a clean checkout and list required versions.

### Files owned

Backend/extension scaffolding, root tooling config, `.env.example`, and `docs/setup/`; coordinate any overlap with W1-T1.

## Wave 1 exit gate

- Baseline Xcode build passes.
- The contract and fixtures are reviewed by all component owners.
- The UX state machine has no unresolved MVP behavior.
- Each component can develop against mocks without another component running.
