# Discussion Card Wireframes

These preview annotations target the existing 640×190 expanded notch and the variable-width closed-notch live-activity lane. Measurements are implementation targets, not new window sizes.

## Compact card

```text
closed notch / live-activity lane — existing height, flexible side wings

┌───────────────────┐█████████████████████┌──────────────────────┐
│ ?  Claim needs…   │    camera/notch     │  5:42          ×    │
└───────────────────┘█████████████████████└──────────────────────┘
  ↑  ↑                                        ↑            ↑
  │  one line, tail truncation                fixed time   dismiss
  type symbol; type is in accessibility name               hover/focus
```

- Vertical content is centered in the configured closed-notch height.
- Leading/trailing wings use 8 pt horizontal padding and 6 pt spacing.
- The title owns flexible width; symbol, time, and dismiss never truncate.
- Minimum rendering when width is constrained: `?  5:42`; the full title remains in the accessibility label and Help tag.
- No summary, evidence, confidence, speaker, or marquee appears compactly.

## Expanded insight card

```text
640 × 190 existing expanded surface
┌──────────────────────────────────────────────────────────────────────┐
│  Discussion insight                              Playing  5:44       │ ← existing header zone
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ ? NEEDS SUPPORT              Speaker A · High confidence       │  │
│  │ A deliberately very long claim title wraps onto a second       │  │
│  │ line and then truncates…                                       │  │
│  │ The concise summary wraps to at most three lines. At larger     │  │
│  │ text sizes this content scrolls instead of shrinking.           │  │
│  │ “Short evidence excerpt…”         [Open at 5:38]  [Dismiss]     │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
   12 pt outer inset; content max 616 × 142; actions remain pinned
```

- The header shows connection/playback context without duplicating the card title.
- Type uses symbol + uppercase/semibold text + accent. Confidence is text, not a meter.
- Title: two lines. Summary: three lines. Evidence: one line and lowest content priority.
- If vertical space is exhausted in normal text sizes, remove evidence first, then speaker; never remove title, summary, timestamp action, or dismiss.
- With accessibility text sizes, the metadata/content column scrolls; the action row stays pinned. VoiceOver always receives untruncated strings.

## Expanded lifecycle and recovery fixtures

```text
EMPTY                                 PROCESSING
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ Analyze a YouTube discussion │      │ ◌  Analyzing discussion      │
│ [ YouTube URL____________ ]  │      │ Example discussion           │
│                    [Analyze] │      │                      [Cancel] │
└──────────────────────────────┘      └──────────────────────────────┘

DISCONNECTED                          ERROR
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ ⛓ Chrome disconnected        │      │ !  Can’t reach the analyzer  │
│ Open Chrome and play this    │      │ Your video and current       │
│ video.    [Retry connection] │      │ analysis are safe.   [Retry] │
└──────────────────────────────┘      └──────────────────────────────┘
```

- Submitting uses **Sending video…** in the same structure as Processing.
- No transcript uses **No transcript available**, **Try another video**, and secondary **Retry**.
- Backend error uses **Analysis couldn’t be completed**, a safe one-line reason, **Retry**, and **Try another video**.
- Unsupported schema uses **Update the app and try again** with Dismiss only.

## Long-copy fixture

Use this exact preview content to exercise truncation and accessibility:

```text
Title: The speaker attributes a multi-decade decline in neighborhood-level
institutional trust entirely to one policy change without establishing causality

Summary: The claim compresses several distinct measures, time periods, and possible
causes into one conclusion. The cited comparison establishes correlation but does
not isolate the policy from demographic and economic changes.

Speaker: Dr. Alexandra Montgomery-Rodríguez
Evidence: “If you compare these two points, that single decision explains the rest.”
Trigger: 59:59
Confidence: 0.59 (Low confidence · Review context)
```

At normal text size, the title ends after two lines, summary after three, and evidence after one. At accessibility sizes, the card scrolls and both actions stay reachable. The compact fixture must reduce cleanly to symbol + `59:59` at its narrowest width.

## Motion annotations

Normal motion uses the app’s existing notch expansion spring. Card-to-card changes use a 0.2-second opacity/vertical transition without resizing the window. Reduced Motion uses opacity only (0.15 seconds). Interruption by a HUD is a content replacement, not a second overlay or a stacked window.
