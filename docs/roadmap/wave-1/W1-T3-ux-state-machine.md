# W1-T3 — Notch UX State Machine and Card Specification

- **Lane:** SwiftUI/product
- **Branch:** `work/w1-t3-ux-state-machine`
- **Estimate:** 2–3 hours
- **Parallel with:** W1-T1, W1-T2, W1-T4

## Goal

Define implementable behavior for submission, processing, playback, cards, errors, and existing-notch coexistence.

## Inputs

- Existing Boring Notch layouts and coordinator behavior.
- Proposed event fields from W1-T2.

## Work

- Specify empty, submitting, processing, ready, disconnected, playing, paused, card-visible, no-transcript, offline, and backend-error states.
- Design compact and expanded cards using existing notch conventions.
- Define card priority relative to music, battery, and HUD activities.
- Define display duration, queueing, dismissal, confidence treatment, and “open at timestamp.”
- Specify pause, rewind, seek, rapid-event, and video-change behavior.
- Cover VoiceOver, keyboard focus, reduced motion, contrast, and long copy.

## Deliverables

- `docs/design/discussion-state-machine.md`.
- Annotated wireframes or preview-only SwiftUI fixtures.
- A decision table for event collisions and recovery actions.

## Acceptance checks

- Every asynchronous state has visible copy and a recovery action.
- Long title and summary content fits the intended notch layout.
- Trigger and replay behavior is unambiguous.
- MVP behavior does not require a new full settings architecture.

## Handoff to integration

Report the approved states, priority table, display timing, and contract fields required by UI. The contract owner must approve any field addition before Wave 1 closes.
