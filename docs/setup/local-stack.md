# Local Developer Stack

Everything below runs offline. No Gemini key, no YouTube access, no native
messaging host, and no other contributor's process is required to develop any of
the four lanes.

Owned by **W1-T4**. The macOS build baseline is owned by W1-T1, contracts and
fixtures by W1-T2.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20.10+ (verified on 24.14) | backend, mock API, extension tests, all scripts |
| npm | ships with Node | running the scripts below |
| Google Chrome | 116+ | loading the unpacked extension |
| Xcode | 16.4 (CI pin) | building the macOS app |
| macOS | 14 Sonoma or later | running the macOS app |

Node is the only requirement for the backend and extension work. The stack has
**zero runtime dependencies**, so `npm install` is currently a no-op; run it
anyway once Wave 2 adds real packages.

## Quick start from a clean checkout

```bash
git clone <this repo> && cd ctp-hack
cp .env.example .env          # mock mode needs no secrets
npm run dev                   # starts the analysis API in mock mode on :8787
```

In a second terminal:

```bash
curl http://127.0.0.1:8787/healthz
curl -X POST http://127.0.0.1:8787/v1/analyze \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=demoTalk001"}'
```

The second command returns a `schemaVersion 1` timeline for the demo
discussion: two speakers, five insight events sorted by `triggerTime`. In mock
mode that comes from the transcript fixture and the offline stub analyzer.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Preflight checks, then the analysis API (W3-T1) in mock mode (one-command startup). See [docs/api/analysis-api.md](../api/analysis-api.md) |
| `npm run mock` | The W1-T4 fixture-playback server with `?scenario=` UI simulation — a different program from the analysis API, same port |
| `npm run analyze` | Analyse a transcript fixture and print the analysis JSON (offline stub; `-- --live` uses Gemini). See [backend/src/analysis/README.md](../../backend/src/analysis/README.md) |
| `npm test` | All backend and extension unit tests (`node --test`) |
| `npm run test:backend` / `npm run test:extension` | One lane only |
| `npm run lint` | JS/JSON parse checks, manifest policy, repo-wide credential scan |
| `npm run validate:fixtures` | Canonical W1-T2 contract and fixture validation |
| `npm run smoke` | Everything above plus a live round trip against the mock API |
| `xcodebuild build -project boringNotch.xcodeproj -scheme boringNotch -configuration Debug -destination "platform=macOS" CODE_SIGNING_ALLOWED=NO` | Builds the macOS app. **W1-T1 owns the authoritative command**; run `xcodebuild -resolvePackageDependencies -project boringNotch.xcodeproj` first on a clean checkout |

## Environment

Copy `.env.example` to `.env`. Real environment variables always win over the
file, so `PORT=9000 npm run dev` works without editing anything.

| Variable | Default | Notes |
| --- | --- | --- |
| `ANALYSIS_MODE` | `mock` | `mock` = fixture transcripts + offline stub analyzer, no secrets. `live` = YouTube captions + Gemini |
| `PORT` | `8787` | API port (both servers use it) |
| `HOST` | `127.0.0.1` | Loopback by default |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `LOG_PAYLOADS` | `false` | Development-only transcript, raw model output, and frontend response logging; may contain sensitive text |
| `FIXTURES_DIR` | `<repo>/fixtures` | Absolute or repo-relative override |
| `MOCK_LATENCY_MS` | `0` | Artificial analyze latency, 0-60000 |
| `MOCK_SCENARIO` | `ok` | Default scenario for every request |
| `TRANSCRIPT_LANGUAGE` | `en-US` | W2-T1 caption preference: exact language, then base language |
| `TRANSCRIPT_TIMEOUT_MS` | `30000` | W2-T1 overall YouTube request timeout, including the yt-dlp fallback, 100-60000 ms |
| `TRANSCRIPT_CACHE_TTL_MS` | `86400000` | W2-T1 in-process normalized transcript cache TTL |
| `ANALYSIS_TIMEOUT_MS` | `30000` | W2-T2 model request timeout, 1000-300000 ms |
| `API_REQUEST_TIMEOUT_MS` | `90000` | W3-T1 deadline for one cold request, 1000-600000 ms |
| `ANALYSIS_CACHE_TTL_MS` | `86400000` | W3-T1 result reuse window (24 h) |
| `GEMINI_MODEL` | adapter default | Optional W2-T2 model override |
| `GEMINI_API_KEY` | unset | Live mode only. Never needed in mock mode |

## Analysis API (W3-T1)

`npm run api` starts the real API: a YouTube URL in,
a cached or freshly generated timeline out. In mock mode it uses transcript
fixtures and the offline stub analyzer, so the whole URL-to-timeline path works
with no key and no network. Full reference, including cache headers, cold/warm
behaviour, and the error table: [docs/api/analysis-api.md](../api/analysis-api.md).

```bash
PORT=3000 npm run api

curl http://127.0.0.1:3000/healthz
curl -X POST http://127.0.0.1:3000/v1/analyze \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=demoTalk001"}'
```

## Fixture-playback server (W1-T4)

`npm run mock` starts a separate program on the same port that replays golden
fixtures byte for byte and simulates UI states. Use it for W1-T3 state work; use
the analysis API above for real behaviour. Run one or the other, not both.

| Route | Purpose |
| --- | --- |
| `GET /healthz` | Liveness, effective mode, fixture directory, available video ids. Contains no secrets |
| `GET /v1/fixtures` | Which video ids the mock can serve, and the scenario list |
| `POST /v1/analyze` | Body `{ "url": "...", "forceRefresh": false }`. `videoId` is also accepted |
| `GET /v1/analysis/:videoId` | The same payload, convenient for `curl` |

Success responses are the analysis payload exactly as the contract defines it,
so they can be fed straight into schema validation. Errors are typed:

```json
{
  "schemaVersion": 1,
  "error": { "code": "TRANSCRIPT_UNAVAILABLE", "message": "...", "retryable": false }
}
```

Error codes match the closed enum in `contracts/api-error.schema.json`:
`INVALID_REQUEST`, `INVALID_YOUTUBE_URL`, `UNSUPPORTED_SCHEMA_VERSION`,
`VIDEO_PRIVATE`, `VIDEO_NOT_FOUND`, `CAPTIONS_DISABLED`,
`UNSUPPORTED_LANGUAGE`, `TRANSCRIPT_UNAVAILABLE`, `ANALYSIS_FAILED`,
`UPSTREAM_TIMEOUT`, and `INTERNAL_ERROR`.

### Simulating slow and failing backends

Pick a scenario per request with `?scenario=` or the `x-mock-scenario` header,
and add latency with `?latencyMs=`:

```bash
# Loading state: two seconds before a normal answer
curl "http://127.0.0.1:8787/v1/analysis/demoTalk001?latencyMs=2000"

# No-transcript state
curl -i "http://127.0.0.1:8787/v1/analysis/demoTalk001?scenario=no_transcript"
```

| Scenario | Response |
| --- | --- |
| `ok` | 200, the golden fixture |
| `processing` | 202 `{ status: "processing", retryAfterSeconds: 3 }` plus `Retry-After` |
| `no_transcript` | 422 `TRANSCRIPT_UNAVAILABLE` |
| `rate_limited` | 429 `ANALYSIS_FAILED` with `retryable: true` |
| `backend_error` | 502 `ANALYSIS_FAILED` |
| `upstream_timeout` | 504 `UPSTREAM_TIMEOUT` |

Every UX state in W1-T3 can be reproduced from these without touching a network.

## Fixtures

`fixtures/` is the single canonical location, owned by W1-T2. The mock resolves
valid analysis entries from `fixtures/manifest.json` and matches the payload's
`videoId`. Nothing else in the repo keeps a second copy. Add new fixtures to the
manifest rather than introducing another component-specific directory.
See [fixtures/README.md](../../fixtures/README.md).

## Chrome extension

Load unpacked, no production key required:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` directory.
4. Confirm the card shows *Boring Notch Discussion Observer (dev)* with no
   errors, and note the generated extension id (it changes per machine until
   W3-T2 pins one).

Verify it:

1. Open `https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
2. On the extension card, click **service worker** to open its DevTools.
3. Play and pause the video. Each transition logs one
   `[boring-notch] playback` message with a `PLAYBACK_STATE` envelope.

After editing extension files, press **Reload** on the extension card; content
script changes also need a page reload.

Wave 1 permissions are deliberately minimal: `https://www.youtube.com/*` host
access and nothing else. `npm run lint` fails if that widens or if a `key` field
appears in the manifest.

### Native-host registration (W3-T2)

Load the extension unpacked, copy its ID from `chrome://extensions`, then run:

```bash
npm run native:register -- <extension-id>
# later, to remove it:
npm run native:unregister
```

The first command builds the Swift host and generates Chrome's per-user manifest
with the computed executable path and exactly one allowed extension origin. See
[native-host/README.md](../../native-host/README.md) for framing, restart, state,
and troubleshooting details. No loopback server or network port is used.

## Secrets

- `.env` is git-ignored; `.env.example` is the only template in the repo.
- Mock mode requires no secrets at all. Missing secrets in live mode fail at
  startup with an actionable message that names the variable and the fix, and
  never prints the value.
- `/healthz` and the startup banner report secret **presence**, never content.
- No key may be added to the extension, the app bundle, fixtures, or docs.
  `npm run lint` scans every tracked text file for credential-shaped strings and
  fails the build. A deliberate fake in a test must carry a
  `lint-allow-secret` comment on or above the line.
- If a key ever lands in a commit, rotate it first, then remove it.

## Pull-request smoke check

```bash
npm run smoke
```

That runs lint, all unit tests, fixture validation, and a real HTTP round trip
against the mock API (ephemeral port, so it cannot collide with your `npm run
dev`). It finishes in a couple of seconds and prints the manual checklist it
cannot automate:

- [ ] `npm run smoke` passes.
- [ ] macOS: the Xcode build command above succeeds (only when the PR touches
      Swift or project files).
- [ ] Chrome: `extension/` still loads unpacked with no errors.
- [ ] A YouTube watch page logs one observation in the service-worker console.
- [ ] No secret, key, or personal signing value appears in `git diff`.
- [ ] `git diff --check` is clean.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `EADDRINUSE` on start | Another mock instance is running. `PORT=8788 npm run dev`, or stop the other process |
| `VIDEO_NOT_FOUND` | The video has no fixture. `GET /v1/fixtures` lists what exists; add a valid analysis entry to `fixtures/manifest.json` |
| `Missing required secret GEMINI_API_KEY` | You are in live mode. Set `ANALYSIS_MODE=mock` in `.env` for Wave 1 |
| `ANALYSIS_MODE=live is not implemented yet` | Expected until W2-T1/W2-T2/W3-T1 land |
| Extension card shows an error after editing | Press **Reload** on the card, then reload the YouTube tab |
| `fetch failed` from the extension | The mock only listens on loopback. Use `http://127.0.0.1:8787`, not a LAN address |
| Node version errors | `node --version` must be 20.10 or newer |

## Handoff to integration

- **Commands:** `npm run dev`, `npm run mock`, `npm test`, `npm run lint`,
  `npm run validate:fixtures`, `npm run smoke`.
- **Port:** 8787 (`PORT`), bound to `127.0.0.1` (`HOST`).
- **Environment variables introduced:** `ANALYSIS_MODE`, `PORT`, `HOST`,
  `LOG_LEVEL`, `FIXTURES_DIR`, `MOCK_LATENCY_MS`, `MOCK_SCENARIO`,
  `TRANSCRIPT_LANGUAGE`, `TRANSCRIPT_TIMEOUT_MS`,
  `TRANSCRIPT_CACHE_TTL_MS`, `ANALYSIS_TIMEOUT_MS`, `GEMINI_MODEL`, and
  `GEMINI_API_KEY` (live only). All documented in `.env.example`.
- **Directories added:** `backend/`, `extension/`, `scripts/`, and
  `docs/setup/local-stack.md`. Generated at runtime:
  `node_modules/` and `.env`, both git-ignored.
- **Mocked boundaries:** the analysis HTTP API (W3-T1 replaces it), the playback
  transport (W2-T3 uses the mock transport, W3-T2 replaces it), and the fixture
  corpus (W1-T2 replaces the placeholders).
- **W1-T2 integration:** the backend discovers analysis entries through
  `fixtures/manifest.json`; the root `validate:fixtures` script and smoke check
  run W1-T2's canonical validator.
- **Known limitations:** the mock has no real cache or request coalescing;
  `forceRefresh` only flips the `x-analysis-cache` header. `ANALYSIS_MODE=live`
  remains in-memory. The W2-T3 observer is production-ready, but native delivery
  to the macOS app remains deferred to W3-T2.
