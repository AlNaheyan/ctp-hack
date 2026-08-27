# Fixtures

This is the **canonical** fixture location for every lane. Nothing in the repo
keeps a second copy: the backend, the mock API, the extension, and the macOS app
all read from here.

## Ownership

**W1-T2 owns the contents of this directory and the schemas in `contracts/`.**
W1-T4 created the directory and two placeholder payloads only so the mock API
and the local runbook work before W1-T2 merges.

When W1-T2 lands:

1. Replace the placeholders below with the golden fixtures W1-T2 defines
   (including the invalid fixtures the mock does not need).
2. If the layout differs from the one assumed here, edit
   `analysisFixtureRelativePaths()` and `ANALYSIS_FIXTURE_DIRS` in
   `backend/src/config.js`. That is the only place the paths are hard-coded.
3. Delete anything below that W1-T2 supersedes. Do not keep both.

## Layout

```text
fixtures/
  analysis/valid/<videoId>.json   analysis payloads served by the mock API
  playback/valid/*.json           playback message samples for extension tests
```

The mock API serves `analysis/valid/<videoId>.json` by video id, so adding a new
demo video is a matter of dropping in one file:

```bash
cp fixtures/analysis/valid/dQw4w9WgXcQ.json fixtures/analysis/valid/<newVideoId>.json
curl http://127.0.0.1:8787/v1/fixtures
```

## Placeholders currently in tree

| Path | Purpose | Replaced by |
| --- | --- | --- |
| `analysis/valid/dQw4w9WgXcQ.json` | Golden analysis timeline: 2 speakers, 5 events, 5 insight types, sorted by `triggerTime` | W1-T2 |
| `playback/valid/playback-state.json` | One `PLAYBACK_STATE` message matching the roadmap contract | W1-T2 |

Both follow the shapes in the
[roadmap contract target](../docs/roadmap/README.md#shared-api-contract-target).

## Rules

- Fixtures are checked in and deterministic: fixed timestamps, no `now()`, no
  network access to generate them.
- No secrets, no personal data, no full transcripts of private material.
- `startTime <= triggerTime <= endTime`, ids unique, events sorted, confidence in
  `[0, 1]`. `npm run check:fixtures` enforces the structural subset of that until
  W1-T2 ships real schema validation.
