# macOS Discussion UI Cleanup Handoff

## Branch scope

This branch changes the active macOS experience from the general-purpose
Boring Notch interface to a focused discussion analyzer. It deliberately does
not merge the browser observer, backend API, or native messaging branches.

## Visible product surface

The notch now contains only:

1. a YouTube URL field with one submit action;
2. a read-only playback-position track, sourced from browser state; and
3. the active argument insight card with contextual Help tooltips and Dismiss.

Music controls, album art, shelf tabs, drag/drop, camera, calendar, battery,
system HUDs, settings buttons, welcome animation, and feature onboarding no
longer render or activate from the primary app flow. The menu bar contains only
Open Discussion Notch and Quit.

## Integration seams

`DiscussionSessionModel` is the temporary UI boundary for later packages:

- URL submission reads `youtubeURL` and calls `submit()`.
- The analysis client calls `analysisReady(eventCount:)` after accepting a
  validated response.
- W3-T2 calls `receivePlayback(_:)` with browser-owned playback state. The UI
  never advances or mutates that time and exposes no seek gesture.
- The timeline coordinator calls `present(_:)` only for the event that wins its
  trigger/queue arbitration.
- The card calls `dismissInsight()`; timeline dedupe remains downstream-owned.

The insight kinds match the closed v1 schema exactly. URL parsing accepts watch,
short, embed, live, mobile, and `youtu.be` forms with 11-character video IDs.
The non-activating panel activates and becomes key only after an intentional
click so the URL field can receive keyboard input; passive playback and insight
updates do not activate it.

## Cleanup strategy

Legacy feature files remain compiled for now so the change is reviewable and
does not combine a product redesign with a destructive Xcode-project rewrite.
Their entry points are removed from `ContentView`, `NotchHomeView`, first-run
launch, menu bar, media shortcut, and `BoringViewModel.open()/close()`.
A later dependency-pruning ticket can remove unreachable source and Swift
packages after this surface is accepted.

## Verification

```text
xcodebuild -quiet -project boringNotch.xcodeproj -scheme boringNotch \
  -configuration Debug -destination 'platform=macOS' \
  -derivedDataPath /private/tmp/ctp-hack-discussion-cleanup-derived \
  CODE_SIGNING_ALLOWED=NO build
```

The unsigned Debug build passes. Existing warnings in shelf/media/XPC source
remain because those files are still compiled; this branch introduces no new
build failure. `NotchHomeView.swift` includes a deterministic insight-card
preview for layout and tooltip review.
