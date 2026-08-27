# Wave 3 Integration Log

- **Base:** `origin/main` at `aa5ad2e` (completed Wave 2)
- **Integration target:** `main`
- **Integrator:** Codex, on behalf of the hackathon team
- **Contract version:** 1
- **Exit decision:** **MERGED — automated gates pass; manual Chrome/UI walkthrough remains**

## Included work

| Package | Source | Integration commit | Notes |
| --- | --- | --- | --- |
| W3-T1 analysis API | `origin/work/w3-t1-analysis-api` at `2f441e7` | `0b5b6d9` | URL-to-analysis orchestration, cache behavior, and HTTP API |
| W3-T4 submission/loading | `origin/work/w3-t4-submission-loading` at `d26aea9` | `6a5d0b5` | macOS URL submission, loading states, cache activation, and retry paths |
| W3-T2 native messaging | `origin/work/w3-t2-native-messaging` at `24a988e` | `b2f58bc` | Chrome native host, registration tooling, connection state, and playback delivery |
| W3-T3 insight cards | `origin/work/w3-t3-insight-cards` at `abb2b50` | `a2b6fcd` | Accessible compact/expanded cards, bounded queue, and notch presentation |

## Merge order and adapter decisions

The branches were merged in the playbook's topological order: W3-T1, W3-T4,
W3-T2, then W3-T3.

- `DiscussionAnalysisCoordinator`, `NativePlaybackBridge`, and
  `DiscussionPresentationModel` share one `DiscussionSessionState`.
- Analysis loading populates that session once; native browser playback advances
  its timeline; emitted events feed the presentation queue without backend work
  during playback.
- Native playback is mirrored to the notch's read-only progress display. A video
  ID mismatch clears stale cards instead of displaying insight from another video.
- Analysis failures remain in submission state. Native-host connection state is
  independent and does not invalidate a cached analysis.
- The Xcode project retains one `DiscussionTimeline` package reference and one
  `NativeMessagingBridge` package reference after resolving parallel project-file
  edits.
- The native codec now decodes the canonical v1 envelope correctly: the envelope
  owns `schemaVersion`; the nested playback payload does not duplicate it.

## Automated checks

| Check | Result |
| --- | --- |
| `npm test` | PASS — 227 passed, 2 opt-in live-network tests skipped |
| `npm run lint` | PASS — 72 JavaScript and 15 JSON files parsed; credential scan passed |
| `npm run validate:fixtures` | PASS — all 11 canonical fixtures behaved as expected |
| `npm run smoke` | PASS — 11/11 checks, including loopback API requests |
| `swift test --package-path Packages/DiscussionTimeline` | PASS — 28 tests |
| `swift test --package-path Packages/NativeMessagingHost` | PASS — 8 tests; codec loop stayed below 500 ms |
| unsigned macOS Debug `xcodebuild` | PASS |
| `plutil -lint boringNotch.xcodeproj/project.pbxproj` | PASS |
| `git diff --check` | PASS |

The macOS build still emits upstream/non-blocking warnings, including Swift
concurrency diagnostics and the MediaRemoteAdapter macOS 15 versus deployment
target 14 warning.

## Manual verification remaining

- Load `extension/` unpacked in Chrome, register its generated ID with
  `npm run native:register -- <extension-id>`, and restart Chrome.
- Confirm a real YouTube page updates the notch scrubber within 500 ms through
  play, pause, seek, rate change, and video change.
- Submit a known video through the running analysis API and visually confirm a
  real event card, dismissal, hover pause, and the original notch close animation.
- Stop the API and confirm an unexpired cached analysis remains usable.

Do not create `wave-3-complete` until those device/browser checks are signed off.

## Exit checklist

- [x] Cold and warm analysis paths are covered by automated tests.
- [x] Offline valid-cache behavior is covered by automated tests.
- [x] Native codec/delivery preparation is below the 500 ms budget.
- [x] Seek and video-change behavior is covered by timeline/extension tests.
- [x] Fixture events reach the bounded card presentation seam.
- [x] Existing macOS target builds successfully.
- [x] `git diff --check` passes.
- [x] Integration log records permissions, commands, and known issues.
- [ ] Real Chrome-to-app playback walkthrough completed.
- [ ] Real API-to-visible-card walkthrough completed.
