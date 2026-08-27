# W1-T1 — Fork Baseline and Build Verification

- **Lane:** macOS/platform
- **Branch:** `work/w1-t1-fork-baseline`
- **Estimate:** 2–3 hours
- **Parallel with:** W1-T2, W1-T3, W1-T4

## Goal

Prove the unchanged fork builds and launches before product code is added.

## Inputs

- Current `main` snapshot.
- `upstream/main` for attribution and future comparison.
- Installed Xcode and local signing configuration.

## Work

- Record `origin`, `upstream`, the imported upstream SHA, Xcode version, and macOS version.
- Resolve packages and build the main app plus XPC helper.
- Launch the unchanged app and verify notch open/close behavior.
- Decide hackathon bundle identifiers and signing approach without committing personal signing values.
- Document the real minimum supported macOS version and known build warnings.
- Document how future upstream changes should be fetched without restoring upstream history to `main`.

## Deliverables

- `docs/setup/macos.md` with clean-checkout instructions and known warnings.
- Any minimal team-safe build-setting change required for a successful build.
- A handoff note containing the exact successful build command/scheme.

## Acceptance checks

- Clean checkout builds with documented steps.
- App opens and the notch expands and closes.
- Main app and helper use intentional bundle identifiers.
- No personal signing identity, DerivedData, or generated output is committed.

## Handoff to integration

Report build command, scheme names, required macOS permissions, modified project-file sections, and unresolved warnings. W1's integrator merges this package first because all later checks depend on the baseline.
