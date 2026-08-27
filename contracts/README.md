# Discussion Analyzer Contracts (v1)

This directory is the versioned source of truth for JSON exchanged by the
backend, Chrome extension, and macOS app. Version 1 consists of:

- `analysis-response.schema.json` — a cached timeline of insight events.
- `transcript.schema.json` — normalized caption segments passed to analysis.
- `playback-message.schema.json` — observed YouTube player state.
- `api-error.schema.json` — stable, provider-neutral API failures.

All schemas use JSON Schema Draft 2020-12. They intentionally allow unknown
properties so a v1 consumer can ignore fields added by a newer v1 producer.
Every root object requires `schemaVersion: 1`; consumers must reject any other
major version before using the payload.

## Validate the golden fixtures

From the repository root, with Node.js 18 or newer:

```sh
node contracts/validate-fixtures.mjs
```

The command has no package install, network, YouTube, or Gemini dependency. It
validates all entries in `fixtures/manifest.json`, including the expected
failure code for every invalid fixture. It also enforces semantic rules that
JSON Schema cannot express portably: unique IDs, deterministic ordering, and
time relationships.

## Shared scalar rules

- Times and durations are JSON numbers representing seconds. They are finite
  and nonnegative. Event times satisfy
  `startTime <= triggerTime <= endTime`; transcript segments satisfy
  `startTime <= endTime`.
- Dates are UTC RFC 3339 timestamps ending in `Z`. Producers should emit
  millisecond precision when it is available; consumers must accept any valid
  RFC 3339 fractional precision.
- `videoId` is the canonical 11-character YouTube video ID, not a URL.
- IDs are opaque, nonempty ASCII identifiers. They are unique within their
  payload and must remain unchanged when the same cached object is read or
  transported. Producers should derive them from stable source identity rather
  than an array index; consumers must not parse meaning from them.
- Analysis events are ordered by ascending `triggerTime`, then ascending `id`
  for equal trigger times. Transcript segments are ordered by ascending
  `startTime`, then ascending `id`.
- Confidence is inclusive in `[0, 1]`. It is model confidence, not a percentage
  or UI priority.

## Compatibility policy

`schemaVersion` is the major wire-contract version. Additive optional fields,
new optional error `details`, and relaxed limits may ship without changing it.
Consumers must ignore unknown properties. Removing or renaming a field,
changing its meaning/type, adding a required field, or changing an enum requires
a new major version and a migration window. Unknown major versions are rejected
with `UNSUPPORTED_SCHEMA_VERSION`; producers must not silently downgrade them.

Insight `type` and API error `code` are closed enums in v1 because consumers use
them for presentation and control flow. Adding a value therefore requires a
major contract revision or an explicitly coordinated v1 schema update across
all consumers.

## Payload-size expectations

Limits apply to the UTF-8 encoded JSON document, including unknown fields:

| Payload | Maximum | Intended use |
| --- | ---: | --- |
| Analysis response | 1 MiB | API response and 24-hour cache |
| Transcript | 5 MiB | Backend-only normalized captions |
| Playback message | 8 KiB | High-frequency native message |
| API error | 16 KiB | HTTP error response |

Receivers reject larger payloads before decoding or forwarding them. These are
contract safety ceilings, not target sizes; playback producers should normally
emit less than 1 KiB.

## Field semantics

`triggerTime` is the notification point. `startTime` and `endTime` bound the
source context shown by UI or used as evidence. `evidence` is a concise excerpt
or close paraphrase and must not be treated as a second transcript.

Transcript `captionSource` describes where captions came from (`manual` or
`automatic`), while `language` is a BCP 47 language tag. A missing segment
`speaker` means the caption source did not identify one; it does not mean the
speaker is the same as the prior segment.

Playback time belongs to YouTube's `<video>` element. `observedAt` is when the
browser sampled it; it is not a clock the app should advance. `duration: 0`
means duration is not known yet. `playbackRate` is a positive multiplier.

API error `code` is stable for program logic, `message` is safe for users,
`retryable` describes whether retrying the same operation may succeed, and
`requestId` is an opaque support correlation value. `details` must contain only
safe structured context and must never expose provider responses, prompts,
transcripts, credentials, or stack traces.
