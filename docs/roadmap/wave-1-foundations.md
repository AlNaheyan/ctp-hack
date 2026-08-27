# Wave 1 — Contracts and Foundations

All four work packages run in parallel. Assign one package to each contributor, then merge through the [Wave 1 integration playbook](wave-1/merge.md).

| Work package | Primary lane | Deliverable |
| --- | --- | --- |
| [W1-T1 — Fork baseline and build verification](wave-1/W1-T1-fork-baseline.md) | macOS/platform | Reproducible clean build and fork setup |
| [W1-T2 — Versioned contracts and golden fixtures](wave-1/W1-T2-contracts-fixtures.md) | API/contracts | Shared schemas and cross-language fixtures |
| [W1-T3 — Notch UX state machine and card specification](wave-1/W1-T3-ux-state-machine.md) | SwiftUI/product | Implementable states and card behavior |
| [W1-T4 — Local developer stack and test harness](wave-1/W1-T4-developer-stack.md) | developer experience | Mockable local stack and setup instructions |

## Start condition

The Boring Notch source and hackathon roadmap exist on `main`.

## Exit gate

- Baseline Xcode build passes.
- All component owners approve the shared contracts and fixtures.
- The UX state machine has no unresolved MVP behavior.
- Every lane can develop against a mock without another component running.
- The integration branch passes the [Wave 1 merge checklist](wave-1/merge.md#exit-checklist).
