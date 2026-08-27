# W4-T3 — Installation and Demo Packaging

- **Lane:** release/platform
- **Branch:** `work/w4-t3-packaging`
- **Estimate:** 3–5 hours
- **Depends on:** W3-T2, W3-T3, W3-T4

## Goal

Install the app, extension, and native bridge on a clean account through a short, reversible process.

## Inputs

- Integrated app build and extension.
- Native-host manifest and registration process.
- Current license and upstream attribution.

## Work

- Produce a team-safe debug/release app build.
- Document unpacked extension loading and pin the development extension ID if required.
- Automate native-host path substitution and registration for the actual app location.
- Add safe unregister/uninstall steps.
- Preserve GPL-3.0 licensing and upstream attribution in distributed materials.
- Document macOS/Chrome permissions and security prompts.

## Deliverables

- Build/package runbook and reversible registration scripts.
- Clean-account installation evidence.
- Version/build diagnostics visible to the team.

## Acceptance checks

- A clean test account installs and connects using only the runbook.
- No developer-specific path or personal signing identity is committed.
- Uninstall removes registration without unexpected user-data deletion.
- Version identifiers appear in diagnostics.

## Handoff to integration

Report produced artifact paths, hashes/versions, install/uninstall commands, required prompts, extension ID, and clean-account result. Do not commit signed secrets or credentials.
