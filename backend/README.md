# Backend

Node service for the discussion analyzer: a YouTube URL in, a timestamped
timeline of argument insights out. It runs fully offline in `mock` mode
(fixture transcripts + the stub analyzer, no secrets) and against YouTube and
Gemini in `live` mode.

Full runbook: [docs/setup/local-stack.md](../docs/setup/local-stack.md).
HTTP boundary: [docs/api/analysis-api.md](../docs/api/analysis-api.md).

```bash
npm run dev      # analysis API on :8787, mock mode by default
npm run mock     # W1-T4 fixture-playback server with UI scenarios (different program)
npm run analyze  # analyse a transcript fixture on the command line
npm test         # unit tests, no network, no key
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
    index.js           entry point: starts the analysis API in either mode
    api/               HTTP boundary + orchestration (W3-T1), see docs/api/
      server.js        routes, cache headers, typed error mapping
      analysis-service.js  URL -> transcript -> analysis, cache + coalescing
      result-cache.js  24 h final-result cache with age/expiry metadata
      fixture-transcripts.js  offline transcript source for mock mode
      factory.js       wiring: which transcript source and model provider
    mock/
      server.js        the mock HTTP API
      scenarios.js     latency and failure simulation
    transcript/
      video-url.js     strict production YouTube URL parser
      youtube-provider.js public watch-page caption adapter
      normalizer.js    provider cues to transcript contract v1
      cache.js         24-hour in-process cache
      service.js       callable W3-T1 boundary
    analysis/          transcript -> insight events (W2-T2), see its README
      analyzer.js      orchestration and the public entry point
      chunker.js       overlapping, timestamp-preserving chunks
      prompt.js        versioned prompt and neutral response schema
      validator.js     model-output parsing, clamping, drop reasons
      postprocess.js   findings -> contract events, dedupe, sort
      contract.js      validation driven by contracts/*.schema.json
      taxonomy.js      the five MVP insight types
      cli.js           npm run analyze
      providers/       gemini adapter, offline stub, provider selection
  test/                node --test suites, no network
```

The analysis package documents its own interface, versions, limits, and typed
errors in [src/analysis/README.md](src/analysis/README.md).

## Where the real pipeline goes

| Ticket | Adds |
| --- | --- |
| W2-T1 | ✅ landed: transcript ingestion service, real URL parser, transcript cache |
| W2-T2 | ✅ landed: `src/analysis/` — analyzer interface, Gemini adapter, prompt/chunker/validator |
| W3-T1 | ✅ landed: `src/api/` — analyze/health routes, 24 h result cache, request coalescing |

Keep new work behind the interfaces already here: read configuration from
`config.js`, raise `AppError` with a code from `errors.js`, and log through
`logger.js` so no transcript text or secret reaches stdout.

## Analysis API (W3-T1)

`src/api/` composes the two Wave 2 services and is the only HTTP surface
clients use. Routes, headers, cold/warm/concurrent behaviour, the error table,
and known test URLs are documented in
[docs/api/analysis-api.md](../docs/api/analysis-api.md).

```js
import { createAnalysisApiService, startApiServer } from './src/api/index.js';

const { service } = createAnalysisApiService(config, { logger });
await startApiServer({ service, config, logger });
```

`service.analyze({ url | videoId, language?, forceRefresh?, signal? })` returns
`{ analysis, meta, cache }` without touching HTTP, which is how the route tests
and any future in-process caller use it. The cache key is
`videoId | language | schemaVersion | model | promptVersion | taxonomyVersion`,
so a model or prompt change misses stale entries instead of serving them, and
concurrent identical requests share one job.

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
