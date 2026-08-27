# Canonical Fixtures

W1-T2 owns this directory and the schemas in `contracts/`. Backend, extension, and macOS consumers must reference these files rather than maintaining component-specific copies.

## Layout

```text
fixtures/
  manifest.json                 fixture registry and expected validation result
  valid/                        golden analysis, transcript, playback, and error payloads
  invalid/                      one focused contract violation per payload
```

`manifest.json` is the source of truth for fixture paths and contract types. The mock backend discovers valid analysis fixtures through the manifest and matches requests using the payload's `videoId`; filenames are not video identifiers.

## Validate

From the repository root:

```bash
npm run validate:fixtures
```

This runs `contracts/validate-fixtures.mjs` without packages, network access, YouTube, or Gemini. It verifies the four valid payloads and confirms each negative fixture fails for its declared reason.

## Adding an analysis fixture

1. Add a JSON payload under `fixtures/valid/` that satisfies `contracts/analysis-response.schema.json`.
2. Add it to `fixtures/manifest.json` with `"contract": "analysis"` and `"valid": true`.
3. Give it a unique, 11-character `videoId` and deterministic timestamps.
4. Run `npm run validate:fixtures`, `npm test`, and `npm run smoke`.

The current synthetic analysis uses `demoTalk001`. It validates URL and API plumbing but is not a claim that a real YouTube video exists under that ID.

## Rules

- Keep timestamps fixed and payloads deterministic.
- Never include credentials, private transcripts, or personal data.
- Keep `startTime <= triggerTime <= endTime`, unique IDs, sorted events, and confidence in `[0, 1]`.
- Treat `contracts/README.md` as the compatibility policy.
- Do not add a second fixture tree under a component directory.

## Mock scenarios

The backend can wrap the valid analysis fixture in deterministic latency and failure behavior:

```bash
curl "http://127.0.0.1:8787/v1/analysis/demoTalk001?latencyMs=2000"
curl -i "http://127.0.0.1:8787/v1/analysis/demoTalk001?scenario=no_transcript"
```

Supported scenarios are `ok`, `processing`, `no_transcript`, `rate_limited`, `backend_error`, and `upstream_timeout`.
