# Wave 3 — Integration Seams

Start only after Wave 2 is merged. These packages connect adjacent components while maintaining explicit file ownership. Merge through the [Wave 3 integration playbook](wave-3/merge.md).

| Work package | Primary lane | Deliverable |
| --- | --- | --- |
| [W3-T1 — Analysis API orchestration](wave-3/W3-T1-analysis-api.md) | backend lead | One cached URL-to-analysis endpoint |
| [W3-T2 — Chrome native messaging bridge](wave-3/W3-T2-native-messaging.md) | browser/platform | Browser playback reaches the Mac process |
| [W3-T3 — Discussion insight notch cards](wave-3/W3-T3-insight-cards.md) | SwiftUI/product | Timeline events render as accessible cards |
| [W3-T4 — Submission and analysis loading](wave-3/W3-T4-submission-loading.md) | macOS/networking | URL submission, API loading, and local activation |

## Start condition

Wave 2 integration is tagged and all component-level fixture tests pass.

## Exit gate

- URL submission through the real API yields a ready local timeline.
- Chrome playback reaches the Swift timeline engine.
- A fixture event emitted by the engine renders as a notch card.
- Cache/offline and reconnect paths work independently.
- The integration branch passes the [Wave 3 merge checklist](wave-3/merge.md#exit-checklist).
