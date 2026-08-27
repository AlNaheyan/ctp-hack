# Discussion Notch UX State Machine

Status: Wave 1 implementation specification

Owner: W1-T3

Implementation consumers: W2-T4, W3-T3, W3-T4

## Product contract

The discussion feature analyzes one submitted YouTube video, activates that analysis only while Chrome reports the same `videoId`, and presents an insight when playback crosses its `triggerTime`. It is an additional notch activity, not a replacement for music, the shelf, battery status, or system HUDs.

The MVP adds one discussion entry point to the existing expanded home surface. It does not add a settings screen, notification history, provider selector, or persistent card inbox.

## State model

Implementation should keep three orthogonal values rather than one enum containing every combination:

```text
AnalysisState   = empty | submitting | processing(progress?) | ready(video) |
                  failure(noTranscript | offline | backend)
ConnectionState = disconnected | connected(playback)
Presentation    = idle | cardVisible(event, deadline, expanded) | paused(event) |
                  queued(events)
```

Derived status is rendered from all three values. For example, `ready + disconnected + idle` displays **Chrome disconnected**, while `ready + connected(paused) + cardVisible` displays a card with a **Paused** playback badge. Analysis and connection state must not be destroyed when a transient card is shown or dismissed.

All state mutation and presentation deadlines run on the main actor. A new submission cancels the old request logically (late responses are ignored by request ID), clears the event queue, and replaces the active analysis only after the new response validates.

## State and transition table

| Visible state | Entry condition | Compact/closed copy | Expanded copy and controls | Recovery or exit |
|---|---|---|---|---|
| Empty | No accepted analysis | No discussion activity | **Analyze a YouTube discussion**; URL field; **Analyze** | Paste/type a URL, then Analyze. Invalid input stays here with inline **Enter a YouTube video URL** and focused field. |
| Submitting | Valid URL accepted; request not acknowledged | Spinner + **Sending…** | **Sending video…**; disabled URL field; **Cancel** | Cancel returns to the previous ready analysis, otherwise Empty. Network response advances to Processing or an error. |
| Processing | Request acknowledged; analysis pending | Spinner + **Analyzing…** | **Analyzing discussion**; indeterminate progress; submitted video title when available; **Cancel** | Cancel returns to previous ready analysis/Empty. Success enters Ready; failure enters an error. Do not invent a percentage unless supplied by a future contract. |
| Ready | Valid analysis cached | Checkmark + **Analysis ready** for 3 s, then no compact takeover | Title, event count, connection/playback status, **Replace video** | Matching playback enters Playing/Paused. Replace starts a new submission. |
| Disconnected | No fresh native playback message for 5 s, or host unavailable | Only shown on explicit connection loss: link-slash + **Chrome disconnected** for 4 s | **Chrome disconnected**; **Open Chrome and play this video**; **Retry connection** | A valid matching playback message reconnects automatically. Retry asks the existing bridge to reconnect; it does not discard analysis. |
| Playing | Matching video, `paused == false` | No takeover between events | Green play badge + current time and analyzed title | Pause enters Paused. Trigger crossing proposes Card visible. |
| Paused | Matching video, `paused == true` | No takeover unless a card is already visible | **Paused at m:ss**; card deadline is frozen | Resume restarts the remaining card deadline. Seek/rewind rules still apply. |
| Card visible | Eligible event wins arbitration | Type icon, one-line title, m:ss; dismiss affordance on hover/focus | Full card; type, title, summary, confidence treatment, **Open at m:ss**, **Dismiss** | Auto-dismiss after the timing below, explicit Dismiss, video change, or replacement analysis. |
| No transcript | API typed error indicates unavailable captions | Caption-slash + **No transcript** for 4 s | **No transcript available**; **Try another video**; **Retry** | Retry resubmits the same URL; Try another focuses a cleared URL field. |
| Offline | Reachability failure/timeout with no server response | Wifi-slash + **You’re offline** for 4 s | **Can’t reach the analyzer**; **Retry**; preserve entered URL and prior ready analysis | Retry same request. Automatic reachability recovery may enable Retry but must not submit without user action. |
| Backend error | Server, decoding, validation, or unsupported-schema error | Exclamation + **Analysis failed** for 4 s | **Analysis couldn’t be completed**; short safe reason; **Retry**; **Try another video** | Retry same request. Never expose response bodies, stack traces, transcript text, or secrets. Unsupported schema adds **Update the app and try again** and disables Retry. |

When a prior ready analysis exists, submission/processing/errors appear in the expanded surface without deactivating it until a replacement succeeds. The prior analysis remains eligible only for its own `videoId`.

## Card content and layout

Wireframes and truncation examples are in [discussion-card-wireframes.md](discussion-card-wireframes.md).

Compact presentation occupies the existing closed-notch live-activity lane. It shows:

1. leading symbol colored by insight type;
2. a single-line title, tail-truncated;
3. `m:ss` trigger time; and
4. an accessibility-labelled dismiss button revealed on hover or keyboard focus.

It must not marquee. The compact title receives all flexible width and may collapse to 80 pt; time and icon never truncate. If the physical notch leaves insufficient room, show icon plus time and expose the full title through the accessibility label.

Expanded presentation fits the existing 640×190 surface with 12 pt exterior padding. The content region is at most 616×142 below the existing header. The title uses two lines, the summary three lines, and evidence one line when space remains. Truncation is at the tail, never by shrinking below the user’s selected text size. Hover or keyboard focus pauses auto-dismiss so content can be read. The accessible value contains the untruncated title, summary, speaker, confidence description, and timestamp.

Insight types use an SF Symbol plus a text label; color is redundant:

| `type` value | Label | Symbol | Accent |
|---|---|---|---|
| `unsupported_claim` | Needs support | `questionmark.bubble` | amber |
| `counterargument` | Counterpoint | `arrow.trianglehead.branch` | cyan |
| `agreement` | Agreement | `checkmark.bubble` | green |
| Any other valid value | Insight | `text.bubble` | blue |

Unknown types remain renderable because schema evolution must not produce a blank card.

### Confidence treatment

Confidence is supporting metadata, never a quality grade or progress bar. Expanded cards translate the numeric value to **High confidence** (`>= 0.80`), **Medium confidence** (`>= 0.60`), or **Low confidence** (`< 0.60`). Low confidence also displays **Review context** and uses a neutral accent. Compact cards omit confidence. VoiceOver reads the label, not the raw decimal. Invalid values are a contract-validation error and never reach presentation.

### Actions

- **Open at m:ss** opens `https://www.youtube.com/watch?v={videoId}&t={floor(startTime)}s`. Use `startTime`, not `triggerTime`, so the user hears the relevant context. The app validates/percent-encodes the ID and uses the normal workspace-opening API.
- **Dismiss** marks only the current presentation dismissed. The timeline engine’s dedupe remains authoritative; the event may replay only after the rewind rule below.
- `Escape` dismisses the card. `Return`/`Space` invokes the focused action. When focus is nowhere inside the card, `Return` opens at timestamp.

No extra API field is needed for either action.

## Timing, queueing, and playback

### Display timing

- A compact card auto-dismisses after 8 seconds of actual playback time.
- Opening/expanding the notch promotes the same card and preserves its remaining time, with a minimum of 8 seconds after expansion.
- Expanded cards auto-dismiss after 15 seconds.
- Pause, pointer hover, keyboard focus, VoiceOver interaction, and a higher-priority interruption freeze the deadline.
- On resume/reveal, continue the remaining deadline with a 3-second minimum.
- Reduced Motion replaces scale/spring movement with a 0.15-second opacity transition. It does not change dwell time.

Deadlines use a monotonic clock, not `observedAt` or video time.

### Trigger and replay rules

- Emit on `previousTime < triggerTime <= currentTime`; never compare floating-point times for equality.
- A playback delta whose absolute value exceeds 2 seconds is a seek. Binary-search to the new position and emit no skipped event.
- Forward seeks do not show events crossed by the seek.
- A rewind at or before an event’s `triggerTime` re-arms that event. It may show again on the next natural forward crossing.
- Jitter of 2 seconds or less does not re-arm an event once shown.
- Pause freezes the visible card and queue. Resuming continues it; pausing exactly after a crossing does not duplicate it.
- Playback-rate changes do not change wall-clock dwell time or crossing semantics.
- A `videoId` change immediately dismisses the visible card, clears the queue and dedupe set, and renders Ready with **Play the analyzed video** if the new ID does not match. Returning to the analyzed video starts matching from the first fresh position without emitting already-passed events.

### Rapid events

The first eligible event presents immediately. Later eligible events use a FIFO queue capped at 3 waiting cards. Event IDs already visible/queued are ignored. Each queued card gets its full dwell time when revealed.

If the cap is exceeded, retain the earliest two waiting events and replace the third slot with the newest event. The dropped event remains deduped for that forward pass. This bounds interruption while retaining immediate context and the latest development. Explicit dismissal advances to the next queued card after a 0.2-second transition. A seek, video change, or replacement analysis clears the queue.

## Activity collision decisions

Only one closed-notch transient owns the presentation lane. Expanded user-selected content is never navigated away automatically.

| Collision | Winner | Discussion behavior | Recovery/resume |
|---|---|---|---|
| System HUD (volume, brightness, keyboard backlight, microphone) vs card | HUD | Freeze and hide card; keep its queue position | Reveal card after HUD ends, with at least 3 s remaining |
| Critical battery (system low-battery warning) vs card | Battery | Freeze and hide card | Reveal afterward with at least 3 s remaining |
| Routine power-source/charging notice vs card | Visible card | Queue/coalesce battery notice through existing battery manager | Battery notice displays after card; never extend card |
| Music live activity vs card | Card for its dwell time | Temporarily replace closed music content; playback continues | Music returns immediately after queue empties |
| Shelf drag/drop vs card | Shelf | Do not cover drop target; freeze card | Reveal when drag/drop session ends |
| User manually opens notch vs compact card | User-opened surface | Promote card within discussion area; do not replace Shelf if Shelf is selected | Card remains reachable on Home; deadline freezes while another tab has focus |
| Error/status toast vs insight card | Existing insight card | Error waits as a single coalesced status item | Show status for 4 s after insight queue drains |
| Two insight events | Current card | FIFO policy above | Next card follows dismissal/deadline |
| New video or new accepted analysis vs card | New context | Dismiss and clear without animation | Show matching Ready/Disconnected state |

Priority, highest first: **user interaction/drag > system HUD > critical battery > discussion card > routine battery/status > music > idle face**. This priority applies only to the closed-notch transient lane. It does not change the current expanded tab or steal keyboard focus.

## Recovery decision table

| Condition detected | User-facing copy | Primary action | Preserved state |
|---|---|---|---|
| URL missing/malformed/unsupported host | Enter a YouTube video URL | Focus URL field | Current analysis |
| Request cancelled | Analysis cancelled | Analyze | Entered URL, current analysis |
| Captions unavailable | No transcript available | Try another video | Failed URL for Retry |
| Offline/DNS/timeout | Can’t reach the analyzer | Retry | URL and current analysis |
| HTTP 5xx/provider failure | Analysis couldn’t be completed | Retry | URL and current analysis |
| HTTP 4xx typed validation error | This video can’t be analyzed | Try another video | Safe error category only |
| Unsupported schema version | Update the app and try again | Dismiss | Current analysis; Retry disabled |
| Invalid response/event bounds | Analysis response was invalid | Retry | Current analysis; invalid data is not cached |
| Native host missing/disconnected | Chrome disconnected | Retry connection | Cached analysis and queue (queue expires on video change) |
| Playback video differs | Play the analyzed video | Open analyzed video | Cached analysis; no cards emitted |
| Cache expired and offline | Saved analysis expired | Retry when online | Video title/URL only; expired events inactive |

Retries are explicit, idempotent, and show Submitting immediately. After three consecutive backend failures, copy remains the same; the UI does not add a new workflow or settings dependency.

## Accessibility and resilient copy

- VoiceOver sees each card as a named group and announces: “Discussion insight, {type}, {title}, at {time}.” It does not automatically read transcript evidence over other audio. Actions follow in visual order.
- New cards use a polite announcement and never move keyboard focus. Critical errors use an assertive announcement once.
- Full Keyboard Access exposes URL field, Analyze/Cancel/Retry, Open at timestamp, and Dismiss with visible focus rings. Focus returns to the element that opened the card or the discussion entry point after dismissal.
- Text and icons meet WCAG 2.1 AA contrast (4.5:1 for normal text; 3:1 for large text and controls) against the black notch. Meaning never depends on color.
- At larger accessibility text sizes, the expanded card scrolls vertically inside its fixed surface; actions remain pinned and reachable. Compact mode falls back to icon/time rather than clipping vertically.
- Long copy uses line limits described above, preserves whole words where SwiftUI allows, and exposes full content to VoiceOver and Help on hover. Do not use marquee text for discussion content.
- Reduced Transparency uses opaque black and solid separators. Increase Contrast strengthens borders and secondary text. Differentiate Without Color adds the type label even where a symbol would normally suffice.

## UI contract handoff

W3-T3 may consume all fields already proposed by W1-T2:

| Field | UI use |
|---|---|
| response `videoId`, `title` | matching, ready state, open URL, context label |
| event `id` | queue identity and dedupe with `videoId` |
| `startTime`, `triggerTime`, `endTime` | open context, trigger crossing, contextual interval |
| `speaker` | optional expanded metadata; hide the row when empty |
| `type` | label/symbol mapping with unknown fallback |
| `title`, `summary`, `evidence` | compact title and expanded content |
| `confidence` | expanded qualitative confidence label |

The UI requires no field addition. Processing remains indeterminate because the contract has no progress value. Connection freshness and `paused` come from playback messages; presentation deadlines and request IDs are local state.

## Acceptance checklist

- Every asynchronous state above has visible copy and at least one recovery/exit action.
- Long title and summary behavior is defined for both notch sizes and accessibility sizes.
- Natural crossings, pause, seek, rewind, jitter, rapid events, and video changes have deterministic behavior.
- Collision priority preserves existing HUD, battery, music, shelf, and expanded-tab behavior.
- MVP uses the existing home surface and local presentation state; it requires no settings architecture.
