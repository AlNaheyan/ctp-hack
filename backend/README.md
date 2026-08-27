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
    transcript/
      video-url.js     strict production YouTube URL parser
      youtube-provider.js public watch-page caption adapter
      normalizer.js    provider cues to transcript contract v1
      cache.js         24-hour in-process cache
      service.js       callable W3-T1 boundary
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

## Transcript ingestion (W2-T1)

W3-T1 consumes the service directly; W2-T1 deliberately adds no HTTP route:

```js
import { MemoryTranscriptCache, createTranscriptService } from './src/transcript/index.js';

const transcripts = createTranscriptService({
  timeoutMs: config.transcriptTimeoutMs,
  cache: new MemoryTranscriptCache({ ttlMs: config.transcriptCacheTtlMs }),
  logger
});

const transcript = await transcripts.getTranscript({
  url: 'https://www.youtube.com/watch?v=PRU2ShMzQRg',
  language: config.transcriptLanguage
});
```

`getTranscript({ url | videoId, language?, captionSource?, forceRefresh?, signal? })`
returns the normalized `contracts/transcript.schema.json` object. The provider
boundary is `fetchTranscript({ videoId, language, captionSource?, signal })`, so
tests and future authenticated providers do not depend on the public YouTube
adapter.

Caption selection prefers an exact BCP 47 language, then its base language;
manual tracks beat automatic tracks within a language match. Callers may force
`captionSource: 'manual' | 'automatic'`. If no matching track exists, the
service returns `UNSUPPORTED_LANGUAGE` rather than silently translating or
choosing an unrelated language.

The cache key is `<videoId>:<lowercase-language>:<manual|automatic>`. Default
TTL is 24 hours and the in-process cache holds 100 least-recently-used entries.
The default network timeout is 10 seconds across metadata and caption fetches.
Logs contain only video id, language, caption source, segment count, cache key,
and outcome—never URL query data or transcript text.

The official captions download API requires OAuth permission to edit a video,
so arbitrary public videos use a replaceable watch-page caption adapter. Run
the deterministic suite offline with `npm run test:backend`. An opt-in live
check is available and may be affected by YouTube bot/network policy:

```bash
RUN_YOUTUBE_LIVE_TEST=1 npm run test:backend
```

Typed ingestion failures are `INVALID_YOUTUBE_URL`, `VIDEO_PRIVATE`,
`VIDEO_NOT_FOUND`, `CAPTIONS_DISABLED`, `UNSUPPORTED_LANGUAGE`,
`TRANSCRIPT_UNAVAILABLE`, and `UPSTREAM_TIMEOUT`. Provider details are retained
only as error causes and are never placed in the wire-safe message.

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

The codes in `errors.js` match the closed v1 enum in
`contracts/api-error.schema.json`. Mock-only conditions map to the closest
canonical code; for example, a missing mock timeline is `VIDEO_NOT_FOUND`.
