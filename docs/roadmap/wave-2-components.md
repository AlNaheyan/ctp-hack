# Wave 2 — Parallel Components

Start only after Wave 1 is merged. Each contributor owns one component and develops against committed fixtures. Merge through the [Wave 2 integration playbook](wave-2/merge.md).

| Work package | Primary lane | Deliverable |
| --- | --- | --- |
| [W2-T1 — YouTube transcript ingestion](wave-2/W2-T1-transcript-ingestion.md) | backend/ingestion | Canonical video metadata and transcript records |
| [W2-T2 — Structured argument analysis](wave-2/W2-T2-analysis-pipeline.md) | AI/backend | Schema-valid insight timeline from a transcript |
| [W2-T3 — Chrome playback observer](wave-2/W2-T3-chrome-observer.md) | browser/JavaScript | Fixture-valid live playback messages |
| [W2-T4 — macOS timeline engine and cache](wave-2/W2-T4-timeline-cache.md) | Swift/domain logic | Deterministic event matching and 24-hour cache |

## Start condition

Wave 1 integration is tagged and the contract/fixture paths are frozen for this wave.

## Exit gate

- Each component passes tests against the same fixtures.
- Transcript output feeds the analyzer without manual reshaping.
- Extension output feeds the Swift engine without manual reshaping.
- No component requires the complete system for ordinary development.
- The integration branch passes the [Wave 2 merge checklist](wave-2/merge.md#exit-checklist).
