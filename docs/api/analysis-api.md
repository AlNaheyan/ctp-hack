# Analysis API (W3-T1)

The HTTP boundary between the backend and every client. W3-T4 and the macOS app
integrate through this document and nothing deeper: transcript retrieval
(W2-T1), the analyzer (W2-T2), and the cache are implementation details behind
these three routes.

- **Base URL:** `http://127.0.0.1:8787` (`HOST` / `PORT`)
- **Start it:** `npm run dev`
- **Content type:** `application/json; charset=utf-8`
- **Contracts:** responses satisfy `contracts/analysis-response.schema.json`;
  errors satisfy `contracts/api-error.schema.json`

## Modes

| `ANALYSIS_MODE` | Transcript source | Analyzer | Secrets |
| --- | --- | --- | --- |
| `mock` (default) | Transcript fixtures from `fixtures/manifest.json` | Offline stub rules | none |
| `live` | YouTube captions | Gemini | `GEMINI_API_KEY` |

Both modes run the same routes, orchestration, cache, and error mapping. Only
the two external boundaries change, so a client written against mock mode needs
no changes for live mode.

`npm run mock` still serves the W1-T4 fixture-playback server with its
`?scenario=` UI simulation. That is a different program: use it for UI states,
use this API for real end-to-end behaviour.

## `POST /v1/analyze`

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=demoTalk001",
  "language": "en-US",
  "forceRefresh": false
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `url` | yes* | Watch, `youtu.be`, `shorts`, `embed`, or `live` URL |
| `videoId` | yes* | Accepted instead of `url` (11-character id) |
| `language` | no | BCP 47 caption preference; defaults to `TRANSCRIPT_LANGUAGE` (`en-US`) |
| `forceRefresh` | no | Skip the cache read and recompute. Also `?forceRefresh=1` |

\* exactly one of `url` or `videoId`.

Response `200`: the analysis payload exactly as the contract defines it, ready
to validate and cache client-side.

```json
{
  "schemaVersion": 1,
  "videoId": "demoTalk001",
  "title": "Discussion analysis for demoTalk001",
  "generatedAt": "2026-08-27T18:12:54.682Z",
  "expiresAt": "2026-08-28T18:12:54.682Z",
  "events": [
    {
      "id": "evt_unsupported_claim_seg_ad6c9390e8dca1298501",
      "startTime": 12.4,
      "triggerTime": 17.75,
      "endTime": 23.1,
      "speaker": "Maya Chen",
      "type": "unsupported_claim",
      "title": "Claim is offered without support",
      "summary": "Maya Chen states a checkable claim in absolute terms without naming a source.",
      "confidence": 0.82,
      "evidence": "Almost every serious injury downtown is caused by a car, so the center should be car-free."
    }
  ]
}
```

Event ids are opaque and stable for the same transcript, model, and prompt
version. Do not parse them; dedupe on `(videoId, event.id)`.

## `GET /v1/analysis/:videoId`

The same result for a known video id, for `curl` and for clients that already
resolved the id. Query parameters: `language`, `forceRefresh`.

## `GET /healthz`

Liveness plus the versions that define cache identity and the cache counters.
Contains no secrets and no cache keys.

```json
{
  "status": "ok",
  "service": "analysis-api",
  "mode": "mock",
  "uptimeSeconds": 5,
  "analyzer": {
    "provider": "stub",
    "model": "stub-rules-1.0.0",
    "promptVersion": "argument-analysis-2.0.0",
    "taxonomyVersion": "1.0.0",
    "schemaVersion": 1
  },
  "transcript": { "defaultLanguage": "en-US" },
  "cache": { "entries": 1, "maxEntries": 200, "ttlMs": 86400000, "hits": 3, "misses": 1, "stores": 1, "evictions": 0, "expirations": 0 },
  "requests": { "requests": 4, "coalesced": 0, "cold": 1, "failures": 0, "inFlight": 0 },
  "requestTimeoutMs": 90000
}
```

## Response headers

| Header | Meaning |
| --- | --- |
| `x-request-id` | Correlation id, also echoed as `error.requestId` on failures |
| `x-analysis-cache` | `miss` (computed now), `hit` (from cache), `bypass` (forceRefresh), `coalesced` (joined a running job) |
| `x-analysis-model` | Model that produced the payload |
| `x-analysis-prompt-version` | Prompt version that produced the payload |
| `cache-control` | `private, max-age=<seconds until expiresAt>` |
| `age` | Seconds since the analysis was stored |

## Cold, warm, and concurrent behaviour

- **Cold** (nothing cached): fetches the transcript, runs the analyzer, stores
  the result, returns `x-analysis-cache: miss`. In live mode budget tens of
  seconds; a cold request is bounded by `API_REQUEST_TIMEOUT_MS` (90 s default).
  Mock mode answers in milliseconds.
- **Warm** (within 24 hours): no transcript fetch and no model call.
  `x-analysis-cache: hit`, and `age` grows while `max-age` shrinks.
- **Concurrent identical requests**: at most one analysis job runs. The first
  caller gets `miss`, the others wait on the same job and get `coalesced`. They
  all receive the same payload.
- **Cache identity**: `videoId | language | schemaVersion | model | promptVersion | taxonomyVersion`.
  Changing the model or prompt misses the old entry rather than serving a stale
  timeline. A caption track that resolves to a different language than requested
  (`en-US` → `en`) is stored under both.
- **Failures are never cached.** The next request retries.

Suggested client timeout: 120 s for a cold request, so the server's own
timeout produces a typed `UPSTREAM_TIMEOUT` before the client gives up. Show the
processing state after ~1 s; warm requests return immediately.

## Errors

Body shape (`contracts/api-error.schema.json`):

```json
{
  "schemaVersion": 1,
  "error": {
    "code": "CAPTIONS_DISABLED",
    "message": "Safe to show a user.",
    "retryable": false,
    "requestId": "req_9f2c…",
    "details": {}
  }
}
```

| HTTP | `code` | Cause | Retryable |
| ---: | --- | --- | --- |
| 400 | `INVALID_YOUTUBE_URL` | Missing or unusable URL / video id | no |
| 400 | `INVALID_REQUEST` | Body is not JSON, bad `language`, unknown route (404), body over 64 KiB (413) | no |
| 403 | `VIDEO_PRIVATE` | Video is private | no |
| 404 | `VIDEO_NOT_FOUND` | Video does not exist; in mock mode, no fixture for that id | no |
| 422 | `CAPTIONS_DISABLED` | Video has no captions | no |
| 422 | `UNSUPPORTED_LANGUAGE` | No caption track for the requested language | no |
| 422 | `TRANSCRIPT_UNAVAILABLE` | Captions could not be retrieved | yes |
| 502 | `ANALYSIS_FAILED` | Model returned unusable output twice, was rejected, or blocked the transcript | usually |
| 504 | `UPSTREAM_TIMEOUT` | Transcript or analysis exceeded its deadline | yes |
| 500 | `INTERNAL_ERROR` | Bug in the backend | no |

`details` carries only safe structured context (available video ids, available
languages, `timeoutMs`). Provider response bodies, prompts, transcripts, and
credentials never appear in an error.

## Known test URLs

```bash
# mock mode - offline, deterministic, no key
curl -X POST http://127.0.0.1:8787/v1/analyze \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=demoTalk001"}'

# live mode - real captions and a real model call
curl -X POST http://127.0.0.1:8787/v1/analyze \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=PRU2ShMzQRg"}'
```

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Listen address |
| `LOG_PAYLOADS` | `false` | Development-only logging of transcript, Gemini output, and frontend response payloads |
| `ANALYSIS_MODE` | `mock` | Fixture + stub, or YouTube + Gemini |
| `TRANSCRIPT_LANGUAGE` | `en-US` | Default caption preference |
| `TRANSCRIPT_TIMEOUT_MS` | `30000` | Caption retrieval deadline, including the local yt-dlp fallback |
| `ANALYSIS_TIMEOUT_MS` | `30000` | Per model request deadline |
| `API_REQUEST_TIMEOUT_MS` | `90000` | Whole cold request deadline |
| `ANALYSIS_CACHE_TTL_MS` | `86400000` | Result reuse window (24 h) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | unset / `gemini-3.5-flash-lite` | Live mode only |

## Not in scope here

Persistence beyond process lifetime, authentication, rate limiting, and
multi-instance cache sharing. The in-process cache is deliberate for the
hackathon: one backend process serves one demo machine.
