# Backend

Node service for the discussion analyzer. Wave 1 ships the **mock API only**:
golden fixtures over the HTTP shape W3-T1 will own, with no network calls and no
secrets.

Full runbook: [docs/setup/local-stack.md](../docs/setup/local-stack.md).

```bash
npm run dev     # from the repo root: preflight + mock API on :8787
npm run mock    # mock API alone
npm test        # unit tests
```

## Layout

```text
backend/
  src/
    config.js          runtime config, fixture paths, secret validation
    env.js             dependency-free .env reader
    errors.js          typed errors and the wire error body
    fixtures.js        canonical fixture lookup (no second copy of any fixture)
    logger.js          single-line JSON logging
    index.js           entry point: mock today, real pipeline from W3-T1
    mock/
      server.js        the mock HTTP API
      scenarios.js     latency and failure simulation
      video-url.js     mock-only URL parsing (W2-T1 supersedes it)
  test/                node --test suites, no network
```

## Where the real pipeline goes

| Ticket | Adds |
| --- | --- |
| W2-T1 | Transcript ingestion service, real URL parser, transcript cache |
| W2-T2 | Analyzer interface, Gemini adapter, prompt/chunker/validator |
| W3-T1 | `POST /analyze` orchestration, 24 h result cache, request coalescing |

Keep new work behind the interfaces already here: read configuration from
`config.js`, raise `AppError` with a code from `errors.js`, and log through
`logger.js` so no transcript text or secret reaches stdout.

## Configuration

Every variable is documented in [`.env.example`](../.env.example). Two rules
matter most:

1. `ANALYSIS_MODE=mock` (the default) must never require a secret. Anyone
   cloning the repo has to be able to start the stack.
2. A missing secret fails at **startup** with a message that names the variable
   and the fix, and never prints a value. `requireSecret()` and
   `assertSecretsForMode()` in `config.js` enforce that; there are tests for it.

## Contract notes

The success payload is the analysis JSON exactly as the roadmap defines it, so
consumers can validate it unchanged. Error bodies are
`{ schemaVersion, error: { code, message, retryable } }`.

The codes in `errors.js` are **provisional**: W1-T2 owns the canonical error
contract, and this file gets reconciled with `contracts/` when that merges.
`MOCK_FIXTURE_MISSING` is mock-only and must never appear in the real API.
