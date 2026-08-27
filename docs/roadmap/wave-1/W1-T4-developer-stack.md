# W1-T4 — Local Developer Stack and Test Harness

- **Lane:** developer experience
- **Branch:** `work/w1-t4-developer-stack`
- **Estimate:** 2–4 hours
- **Parallel with:** W1-T1, W1-T2, W1-T3

## Goal

Let all four lanes work locally without waiting for live Gemini, YouTube, Chrome native messaging, or another teammate's process.

## Inputs

- Current repository structure.
- Draft schemas and fixtures from W1-T2.

## Work

- Scaffold the backend runtime and one-command local startup.
- Add `.env.example` and secret-handling rules.
- Serve golden analysis through a mock endpoint.
- Add backend/extension lint and test commands plus the current Xcode build command.
- Document unpacked Chrome extension loading and planned native-host registration.
- Provide a pull-request smoke command or explicit short checklist.

## Deliverables

- Backend and extension skeleton directories with READMEs.
- Mock API backed by the canonical fixture path.
- Root setup/run instructions and `.env.example`.

## Acceptance checks

- A developer starts the mock API and retrieves a fixture with `curl`.
- Extension loads unpacked without a production key.
- Missing secrets produce actionable errors and never expose credentials.
- Setup works from a clean checkout with documented versions.

## Handoff to integration

Report commands, ports, environment variables, generated directories, and mocked boundaries. Rebase fixture references after W1-T2 merges; do not copy fixtures into a second location.
