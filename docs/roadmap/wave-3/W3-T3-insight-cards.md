# W3-T3 — Discussion Insight Notch Cards

- **Lane:** SwiftUI/product
- **Branch:** `work/w3-t3-insight-cards`
- **Estimate:** 4–6 hours
- **Depends on:** W1-T3, W2-T4

## Goal

Render timeline events as polished, accessible notch cards without regressing existing activities.

## Inputs

- Approved UX state machine and priority table.
- Timeline event publisher and analysis fixture.

## Work

- Add dedicated discussion presentation state instead of overloading HUD/music values.
- Build compact and expanded card variants from fixture data.
- Bind card presentation to emitted timeline events.
- Implement approved queue/coalescing and existing-activity precedence.
- Add dismiss and optional “open at timestamp” actions.
- Add previews for errors, long content, disconnected state, and rapid events.

## Deliverables

- Discussion SwiftUI components, previews, and minimal coordinator/layout integration.
- UI behavior tests where practical and a manual visual checklist.
- Public presentation input consumed during Wave 3 merge.

## Acceptance checks

- Type, title, summary, speaker, and confidence treatment are legible.
- Music, shelf, battery, and HUD behavior remains unchanged when inactive.
- Rapid events follow the documented queue policy.
- VoiceOver and reduced-motion behavior are present.

## Handoff to integration

Report coordinator hooks, required environment objects, presentation input method, priority behavior, and screenshots of key states. Avoid API and native transport files.
