# Analysis Pipeline (W2-T2)

Turns a normalized transcript into evidence-grounded, contract-valid insight
events.

```text
transcript -> prompt -> provider -> validator -> postprocess -> analysis response
                                    (Gemini or offline stub)
```

Scope boundary: this package has **no HTTP surface and no cache**. W3-T1 owns
routes, the 24-hour cache, and request coalescing; W2-T1 owns producing the
transcript. Everything here is a function call.

## Quick start

```bash
npm run analyze                 # golden transcript, offline stub, no API key
npm run analyze -- --meta       # also print the internal bookkeeping
npm run analyze -- --live       # real Gemini call; needs GEMINI_API_KEY in .env
npm run analyze -- path/to/transcript.json --title "Debate title"
```

```js
import { analyzeTranscript, createProvider } from './backend/src/analysis/index.js';

const provider = createProvider(config);          // stub in mock mode, Gemini in live mode
const { analysis, meta } = await analyzeTranscript(transcript, { provider, title });
```

## Analyzer signature

```ts
analyzeTranscript(transcript, {
  provider,                  // required: ModelProvider
  title?,                    // discussion title for the response payload
  now?,                      // () => Date, injected clock for deterministic tests
  minConfidence?,            // default 0 (keep everything the model reports)
  cacheTtlSeconds?,          // default 86400
  signal?,                   // AbortSignal
  logger?                    // { info, warn, debug }
}) => Promise<{ analysis, meta }>
```

`analysis` satisfies `contracts/analysis-response.schema.json` and is what W3-T1
caches and serves, unchanged. `meta` is internal and **must not be merged into
the response**:

| `meta` field | Use |
| --- | --- |
| `providerName`, `modelId` | Which model produced this |
| `promptVersion`, `taxonomyVersion`, `schemaVersion` | Cache invalidation |
| `cacheKey`, `cacheKeyParts` | Ready-made cache identity for W3-T1 |
| `chunkCount`, `segmentCount`, `findingsReturned`, `eventsKept` | Volume (`chunkCount` is retained for compatibility and is always 1) |
| `dropped`, `removed` | Why findings did not become events, by reason |
| `groundingFallbacks`, `truncated`, `repairAttempts`, `sizeTrimmed` | Quality signals |
| `durationMs` | Timing |

Cache key: `videoId | language | schemaN | modelId | promptVersion | taxonomyVersion`.
Changing the model, the prompt, or a taxonomy definition therefore misses old
entries instead of serving a stale timeline.

## Provider interface

```ts
interface ModelProvider {
  name: string;
  modelId: string;
  generate(request: {
    system: string;
    user: string;
    responseSchema?: object;   // provider-neutral; the adapter translates it
    signal?: AbortSignal;
  }): Promise<{ text: string; modelId?: string; finishReason?: string; usage?: object }>;
}
```

Two implementations ship:

- **`stub`** (`providers/stub.js`) - deterministic rules, no network, no key.
  Used by every ordinary test, by `ANALYSIS_MODE=mock`, and by the demo path. It
  is a stand-in, not the product: it recognises cue phrases, it does not reason.
- **`gemini`** (`providers/gemini.js`) - the real analyzer. Structured output via
  `responseMimeType: application/json` plus a translated `responseSchema`,
  temperature 0.2, key sent as a header and never logged.

`createProvider(config)` picks one from `ANALYSIS_MODE`. Adding a provider means
adding a case there and nothing else.

## Taxonomy (MVP)

A closed enum in the contract; adding a value is a coordinated contract change.

| Type | Reported when |
| --- | --- |
| `unsupported_claim` | A checkable assertion is presented as settled with no source |
| `contradiction` | A speaker conflicts with their own earlier position |
| `strawman` | Another participant's position is restated in a distorted, absolute form |
| `evasion` | A direct question is answered with something other than the answer |
| `missing_premise` | A conclusion needs an unstated assumption that was never established |

## How events stay grounded

The model never supplies timings. It returns a `segmentId`, and postprocess
derives the event from the transcript:

- `startTime` / `endTime` = the segment's own bounds.
- `triggerTime` = the midpoint of that segment, so the card appears while the
  statement is still on screen.
- `speaker` = the segment's speaker (`Unknown speaker` when captions had none).
- `id` = `evt_<type>_<segmentId>` - stable across re-analysis, never an index.

A finding that references a segment the model was not shown is dropped, not
guessed at. Evidence is checked against the segment text (ignoring case and
punctuation); if the quote is not really there, it is replaced with the
segment's own words and counted in `meta.groundingFallbacks`.

## Full-transcript context

Every normalized transcript is sent to the provider in one request. It is not
split by character count or segment count, so later exchanges can be evaluated
against statements, questions, and premises from anywhere earlier in the
video. `meta.chunkCount` remains for compatibility and is always `1`.

## Validation, clamping, and dedupe

| Situation | Result |
| --- | --- |
| Response is prose, fenced, or wrapped in commentary | Fences and surrounding text stripped, then parsed |
| Response is not JSON at all | One repair attempt, then `ANALYSIS_FAILED` |
| `segmentId` was never shown to the model | Finding dropped (`unknown_segment`) |
| `type` outside the enum | Finding dropped (`unknown_type`) |
| `confidence` is not a number | Finding dropped (`invalid_confidence`) |
| `confidence` outside `[0, 1]` | Clamped |
| `title` / `summary` / `evidence` too long | Truncated to the contract ceilings |
| Empty `title` or `summary` | Finding dropped (`empty_text`) |
| Same segment and type reported twice | Kept once, highest confidence wins |
| Same type, overlapping time windows | Collapsed into one event |
| Payload over 1 MiB | Weakest events dropped until it fits (`meta.sizeTrimmed`) |

Events are returned sorted by `triggerTime`, then `id`, as the contract requires.

## Retry policy

One repair attempt per transcript. The repair request repeats the transcript (the
provider is stateless) and appends what was wrong with the previous answer. If
the second attempt is still unusable, the whole analysis fails with
`ANALYSIS_FAILED` and `details.chunkIndex` - a partial timeline is never
returned as if it were complete.

## Typed errors

All from the closed enum in `contracts/api-error.schema.json`:

| Code | Cause | Retryable |
| --- | --- | --- |
| `UNSUPPORTED_SCHEMA_VERSION` | Transcript is not schema version 1 | no |
| `INVALID_REQUEST` | Transcript violates the transcript contract | no |
| `ANALYSIS_FAILED` | Unusable output after the repair attempt, provider rejection, safety block, empty completion | depends |
| `UPSTREAM_TIMEOUT` | Provider did not respond within `ANALYSIS_TIMEOUT_MS` | yes |
| `INTERNAL_ERROR` | Bug in this pipeline (missing provider, output that fails the contract) | no |

Provider response bodies are never forwarded. Errors carry at most the HTTP
status, the provider's own short status string, and the compatibility chunk index (`0`).

## Prompt injection

Transcript text is third-party data. The system prompt states that segments are
untrusted and that instructions inside them must be ignored, and the transcript
is embedded as a JSON array between explicit `BEGIN/END TRANSCRIPT DATA`
markers, never interpolated into instruction text. Injection that does get
through still cannot invent an event: unknown segment ids and unknown types are
dropped after the fact, and timings always come from the transcript.

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `ANALYSIS_MODE` | `mock` | `mock` uses the offline stub, `live` uses Gemini |
| `GEMINI_API_KEY` | unset | Required in live mode only; never logged |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | High-throughput model id; part of the cache key |
| `ANALYSIS_TIMEOUT_MS` | `30000` | Per-request model timeout |

## Tests

```bash
npm test                                   # offline, no key, no network
RUN_LIVE_MODEL_TESTS=1 npm test            # adds the opt-in live Gemini test
```

`gemini-provider.test.js` injects `fetch`, so adapter behaviour (request shape,
error mapping, timeouts, key handling) is covered without a network. The live
test is skipped with a printed reason unless both the flag and a key are present.

## Known limitations

- Very long transcripts must fit within the selected model's input-context
  limit because the analyzer intentionally does not split them.
- The stub provider is cue-phrase matching, not analysis. Judge output quality
  with `--live`.
- `minConfidence` defaults to 0: nothing is filtered by confidence unless a
  caller asks for it. W3-T1 or the UI decides what is worth showing.
