# Discussion Analyzer UX State Machine

This specification is the W1-T3 source of truth for the macOS notch experience. It defines behavior only; implementation begins in W3-T3 and W3-T4.

## Product boundary

The macOS app owns URL submission, cached analysis, timeline matching, and cards. The Chrome extension is a small playback observer. The backend processes a URL once and is not involved during synchronized playback.

The player owns time; the app observes time.

## Independent state axes

Do not model the feature as one large enum. These axes change independently and combine into the visible state.

### Analysis loading

| State | Visible copy | Primary action | Recovery |
| --- | --- | --- | --- |
| `empty` | “Analyze a YouTube discussion” | Enter URL | None required |
| `submitting` | “Checking video…” | Cancel | Returns to prior ready timeline or empty |
| `processing` | “Analyzing the discussion…” | Cancel | Retry after typed failure |
| `ready(videoId, timeline)` | “Insights ready” plus event count | Start/open video | Refresh analysis |
| `noTranscript` | “No usable captions found” | Try another video | Retry after captions/language change |
| `offline` | “Backend unavailable” | Retry | Use an unexpired local result if present |
| `rateLimited` | “Analysis is busy” | Retry when allowed | Preserve entered URL |
| `failed` | “Couldn’t analyze this video” | Retry | Show safe typed detail, never provider output |
| `unsupportedSchema` | “App update required” | Dismiss | Never decode partially |

Only the newest submission may update state. A later submission or cancellation makes earlier responses stale and ignored.

### Browser connection

| State | Notch indication | Behavior |
| --- | --- | --- |
| `notInstalled` | Setup hint in expanded view | No playback matching |
| `disconnected` | Small outlined browser icon and “Connect Chrome” | Timeline remains cached and ready |
| `connected(videoId)` | No persistent warning | Match only if video ID equals ready analysis |
| `wrongVideo(expected, actual)` | “Open the analyzed video” | Suppress all insight triggers |
| `stale` | “Playback connection lost” | Freeze observation; do not advance time locally |

Connection warnings never erase analysis and never claim analysis failed.

### Playback and presentation

| State | Behavior |
| --- | --- |
| `idle` | No active matching session |
| `playing` | Consume observed crossings |
| `paused` | Keep current card readable; do not advance or retrigger |
| `seeking` | Reset event pointer by binary search; do not emit skipped events |
| `cardVisible(event)` | Present compact card; expanded detail available |
| `queued(events)` | Preserve chronological order, bounded to three events |

## Main transitions

| From | Input | To | Side effect |
| --- | --- | --- | --- |
| Empty/failed | Valid URL submit | Submitting | Cancel previous request |
| Submitting | Backend accepted/working | Processing | Keep URL visible |
| Submitting/processing | Valid analysis | Ready | Atomically cache until `expiresAt` |
| Ready | Matching browser video connects | Playing or paused | Reset pointer at observed time |
| Ready | Different browser video connects | Wrong video | Show no cards |
| Playing | `previous < trigger <= current` | Card visible | Dedupe `(videoId, event.id)` |
| Any playback | `abs(current - previous) > 2` | Seeking | Binary-search next event, emit none |
| Playing | Pause observation | Paused | Player remains sole clock |
| Any | Browser video changes | Ready/wrong video | Clear active card, queue, pointer, and dedupe set |
| Ready | Cache expires | Ready-stale | Keep usable data visible; refresh before next new session |

## Trigger, replay, and queue policy

1. Trigger only on a crossing: `previousTime < triggerTime <= currentTime`.
2. Treat an absolute observed-time delta over 2 seconds as a seek. Reset to the first event after the new time and emit no event during that update.
3. Mark an event shown by `(videoId, event.id)`.
4. A backward seek re-arms an event only after playback moves to at least 0.5 seconds before its `startTime`. Ordinary time jitter does not re-arm it.
5. Video change clears every shown marker because IDs are scoped to a video session.
6. Show a card for 6 wall-clock seconds. Pausing the video does not dismiss it early.
7. User dismissal ends the active card immediately but keeps it marked shown.
8. Queue at most three crossed events in chronological order. If a fourth arrives, retain the earliest two and newest one, and expose “More insights available” in the expanded view.
9. Events with equal `triggerTime` follow contract order: ascending stable ID.

## Existing-notch precedence

| Current surface | Incoming insight | Decision |
| --- | --- | --- |
| Volume, brightness, backlight, or mic HUD | Insight | Queue insight until HUD closes, for at most 5 seconds |
| Battery power-status alert | Insight | Finish battery alert, then show insight |
| File drag/drop or share picker | Insight | Queue without opening or stealing focus |
| Webcam/mirror active | Insight | Show compact indicator only; expanded detail waits |
| Music live activity | Insight | Insight temporarily replaces the compact music content; music state is preserved |
| Existing insight | New insight | Add to bounded chronological queue |
| Notch manually expanded | Insight | Insert card in discussion area without collapsing the notch |

System controls and active user gestures win over informational cards. An insight is never allowed to break a drag, share, camera, or HUD interaction.

## Card specification

### Compact card

```text
┌──────────────────────────────────────────────────────────┐
│ ⚠ Claim needs support                 Speaker A · 88%    │
│ States that rents fell sharply without naming a source.  │
└──────────────────────────────────────────────────────────┘
```

- Maximum two title lines and two summary lines.
- Type icon plus human title; never show raw snake-case type.
- Speaker is one line and truncates before the title.
- Confidence is visually secondary. Display as a rounded percentage, not a truth score.
- Entire card opens expanded detail. A close control is separately accessible.

### Expanded card

```text
┌──────────────────────────────────────────────────────────────┐
│ Possible unsupported claim                         [Close]   │
│ Speaker A · 1:38 · Confidence 88%                            │
│                                                              │
│ States that rents fell forty percent without naming a        │
│ source or a time period.                                     │
│                                                              │
│ Context                                                      │
│ “Rents came down by about forty percent…”                     │
│                                                              │
│ [Open at 1:32]                             [Dismiss]          │
└──────────────────────────────────────────────────────────────┘
```

- Summary may use four lines; evidence may use three.
- Overflow ends with an ellipsis; full text is available to VoiceOver and a future history view.
- “Open at” uses `startTime`, while the header timestamp uses `triggerTime`.
- No like/dislike or verdict controls in the MVP.

## Type presentation

| Contract type | Display label | Symbol suggestion | Tone |
| --- | --- | --- | --- |
| `unsupported_claim` | Claim needs support | `questionmark.circle` | Amber |
| `contradiction` | Possible contradiction | `arrow.triangle.2.circlepath` | Purple |
| `strawman` | Position may be reframed | `person.crop.circle.badge.questionmark` | Orange |
| `evasion` | Question may be unanswered | `arrow.turn.up.right` | Blue |
| `missing_premise` | Reasoning skips a step | `link.badge.plus` | Teal |

Color is supplemental; symbol and text always carry meaning. Copy uses “possible,” “may,” or “needs support” because analysis is fallible.

## Error and recovery copy

| Contract error | User-facing title | Recovery |
| --- | --- | --- |
| `INVALID_YOUTUBE_URL` | “Enter a YouTube video link” | Return focus to URL field |
| `VIDEO_PRIVATE` | “This video is private” | Choose another video |
| `VIDEO_NOT_FOUND` | “Video not found” | Check link or choose another |
| `CAPTIONS_DISABLED` | “Captions are disabled” | Choose a captioned video |
| `UNSUPPORTED_LANGUAGE` | “Caption language isn’t supported yet” | Choose another language/video |
| `TRANSCRIPT_UNAVAILABLE` | “No usable transcript found” | Retry or choose another video |
| `ANALYSIS_FAILED` | “Analysis couldn’t finish” | Retry; preserve URL |
| `UPSTREAM_TIMEOUT` | “Analysis is taking too long” | Retry; use valid cache if present |
| `UNSUPPORTED_SCHEMA_VERSION` | “App update required” | Dismiss and update |
| `INTERNAL_ERROR` | “Something went wrong” | Retry; show request ID if supplied |

## Accessibility and motion

- Compact VoiceOver label order: type, title, speaker, summary, confidence, timestamp.
- Do not announce confidence as certainty; say “model confidence 88 percent.”
- Close, open-at-time, retry, refresh, and cancel are keyboard reachable.
- Minimum interactive target is 28×28 points in the compact notch and 36×36 when expanded.
- Respect Reduce Motion by replacing scale/bounce with opacity under 150 ms.
- Respect Increase Contrast and never encode type using color alone.
- New cards use a polite live-region announcement and never interrupt a system HUD announcement.

## Contract audit

The v1 analysis contract already supplies every MVP field: `videoId`, timeline expiry, stable event ID, interval times, speaker, closed type, title, summary, confidence, and evidence. Playback v1 supplies video ID, current time, duration, paused state, rate, and observation time. W1-T3 requires no schema change.

## Implementation boundaries

- W2-T4 implements timing, dedupe, queue input, and cache semantics without SwiftUI.
- W3-T3 implements card views and coordinator precedence.
- W3-T4 implements submission/loading and maps typed errors to this copy.
- W3-T2 supplies connection state but does not choose product copy.
- MVP adds a discussion surface to the existing notch; it does not add a new settings architecture.
