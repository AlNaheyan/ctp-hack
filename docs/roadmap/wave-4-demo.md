# Wave 4 — Demo Hardening

Start only after Wave 3 is merged. Assign strict ownership because this wave stabilizes a shared end-to-end system. Merge through the [Wave 4 release playbook](wave-4/merge.md).

| Work package | Primary lane | Deliverable |
| --- | --- | --- |
| [W4-T1 — End-to-end integration and latency](wave-4/W4-T1-end-to-end.md) | integration lead | Reliable full flow with measured latency |
| [W4-T2 — Reliability and regression suite](wave-4/W4-T2-reliability-tests.md) | QA/test | Fast automated and manual safety net |
| [W4-T3 — Installation and demo packaging](wave-4/W4-T3-packaging.md) | release/platform | Reversible clean-machine installation |
| [W4-T4 — Demo script and fallback assets](wave-4/W4-T4-demo-assets.md) | product/demo | Rehearsed live and contract-faithful fallback demos |

## Start condition

Wave 3 integration is tagged and both real seams work independently.

## Exit gate

- Clean-install rehearsal passes.
- Automated checks and the ten-minute smoke suite pass.
- Known-video demo succeeds twice after restarting Chrome and the app.
- The fallback is tested, disclosed, and uses production contracts.
- The integration branch passes the [Wave 4 release checklist](wave-4/merge.md#exit-checklist).
