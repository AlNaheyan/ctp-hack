#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const contractDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(contractDirectory, "..");
const fixtureDirectory = resolve(repositoryRoot, "fixtures");

const limits = Object.freeze({
  analysis: 1024 * 1024,
  transcript: 5 * 1024 * 1024,
  playback: 8 * 1024,
  apiError: 16 * 1024,
});

const schemaFiles = Object.freeze({
  analysis: "analysis-response.schema.json",
  transcript: "transcript.schema.json",
  playback: "playback-message.schema.json",
  apiError: "api-error.schema.json",
});

const insightTypes = new Set([
  "unsupported_claim",
  "contradiction",
  "strawman",
  "evasion",
  "missing_premise",
]);

const errorCodes = new Set([
  "INVALID_REQUEST",
  "INVALID_YOUTUBE_URL",
  "UNSUPPORTED_SCHEMA_VERSION",
  "VIDEO_PRIVATE",
  "VIDEO_NOT_FOUND",
  "CAPTIONS_DISABLED",
  "UNSUPPORTED_LANGUAGE",
  "TRANSCRIPT_UNAVAILABLE",
  "ANALYSIS_FAILED",
  "UPSTREAM_TIMEOUT",
  "INTERNAL_ERROR",
]);

class ContractError extends Error {
  constructor(code, location, message) {
    super(`${location}: ${message}`);
    this.name = "ContractError";
    this.code = code;
  }
}

function reject(code, location, message) {
  throw new ContractError(code, location, message);
}

function object(value, location) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject("INVALID_TYPE", location, "must be an object");
  }
  return value;
}

function array(value, location, { nonempty = false } = {}) {
  if (!Array.isArray(value)) reject("INVALID_TYPE", location, "must be an array");
  if (nonempty && value.length === 0) reject("EMPTY_ARRAY", location, "must not be empty");
  return value;
}

function required(container, key, location) {
  if (!Object.hasOwn(container, key)) reject("MISSING_FIELD", `${location}.${key}`, "is required");
  return container[key];
}

function text(value, location, maximum, pattern) {
  if (typeof value !== "string") reject("INVALID_TYPE", location, "must be a string");
  if (value.trim().length === 0) reject("EMPTY_STRING", location, "must not be empty or whitespace-only");
  if (value.length > maximum) reject("STRING_TOO_LONG", location, `must contain at most ${maximum} characters`);
  if (pattern && !pattern.test(value)) reject("INVALID_FORMAT", location, "has an invalid format");
  return value;
}

function seconds(value, location) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reject("INVALID_SECONDS", location, "must be a finite JSON number");
  }
  if (value < 0) reject("INVALID_SECONDS", location, "must be nonnegative");
  return value;
}

function confidence(value, location) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    reject("INVALID_CONFIDENCE", location, "must be a finite number in [0, 1]");
  }
}

function boolean(value, location) {
  if (typeof value !== "boolean") reject("INVALID_TYPE", location, "must be a boolean");
}

function utcTimestamp(value, location) {
  text(value, location, 64);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) reject("INVALID_TIMESTAMP", location, "must be an RFC 3339 UTC timestamp ending in Z");

  const [, year, month, day, hour, minute, second] = match.map((part) => part ?? "");
  const instant = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second));
  if (
    instant.getUTCFullYear() !== +year ||
    instant.getUTCMonth() !== +month - 1 ||
    instant.getUTCDate() !== +day ||
    instant.getUTCHours() !== +hour ||
    instant.getUTCMinutes() !== +minute ||
    instant.getUTCSeconds() !== +second
  ) {
    reject("INVALID_TIMESTAMP", location, "contains an invalid calendar date or time");
  }
  return Date.parse(value);
}

function stableId(value, location) {
  return text(value, location, 128, /^[A-Za-z][A-Za-z0-9_-]{0,127}$/);
}

function videoId(value, location) {
  return text(value, location, 11, /^[A-Za-z0-9_-]{11}$/);
}

function version(payload) {
  const value = required(payload, "schemaVersion", "$");
  if (value !== 1) reject("UNSUPPORTED_SCHEMA_VERSION", "$.schemaVersion", "only major version 1 is supported");
}

function uniqueIds(items, location) {
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const id = items[index].id;
    if (seen.has(id)) reject("DUPLICATE_ID", `${location}[${index}].id`, `duplicates ${JSON.stringify(id)}`);
    seen.add(id);
  }
}

function validateAnalysis(value) {
  const payload = object(value, "$");
  version(payload);
  videoId(required(payload, "videoId", "$"), "$.videoId");
  text(required(payload, "title", "$"), "$.title", 500);
  const generatedAt = utcTimestamp(required(payload, "generatedAt", "$"), "$.generatedAt");
  const expiresAt = utcTimestamp(required(payload, "expiresAt", "$"), "$.expiresAt");
  if (generatedAt >= expiresAt) reject("BAD_TIME_BOUNDS", "$.expiresAt", "must be later than generatedAt");

  const events = array(required(payload, "events", "$"), "$.events");
  for (let index = 0; index < events.length; index += 1) {
    const location = `$.events[${index}]`;
    const event = object(events[index], location);
    stableId(required(event, "id", location), `${location}.id`);
    const start = seconds(required(event, "startTime", location), `${location}.startTime`);
    const trigger = seconds(required(event, "triggerTime", location), `${location}.triggerTime`);
    const end = seconds(required(event, "endTime", location), `${location}.endTime`);
    if (start > trigger || trigger > end) {
      reject("BAD_TIME_BOUNDS", location, "must satisfy startTime <= triggerTime <= endTime");
    }
    text(required(event, "speaker", location), `${location}.speaker`, 200);
    const type = required(event, "type", location);
    if (!insightTypes.has(type)) reject("INVALID_ENUM", `${location}.type`, "is not a supported insight type");
    text(required(event, "title", location), `${location}.title`, 200);
    text(required(event, "summary", location), `${location}.summary`, 1000);
    confidence(required(event, "confidence", location), `${location}.confidence`);
    text(required(event, "evidence", location), `${location}.evidence`, 2000);
  }

  uniqueIds(events, "$.events");
  for (let index = 1; index < events.length; index += 1) {
    const prior = events[index - 1];
    const current = events[index];
    if (prior.triggerTime > current.triggerTime || (prior.triggerTime === current.triggerTime && prior.id > current.id)) {
      reject("EVENTS_NOT_SORTED", `$.events[${index}]`, "must follow triggerTime/id ascending order");
    }
  }
}

function validateTranscript(value) {
  const payload = object(value, "$");
  version(payload);
  videoId(required(payload, "videoId", "$"), "$.videoId");
  text(required(payload, "language", "$"), "$.language", 35, /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);
  const captionSource = required(payload, "captionSource", "$");
  if (captionSource !== "manual" && captionSource !== "automatic") {
    reject("INVALID_ENUM", "$.captionSource", "must be manual or automatic");
  }
  utcTimestamp(required(payload, "fetchedAt", "$"), "$.fetchedAt");

  const segments = array(required(payload, "segments", "$"), "$.segments", { nonempty: true });
  for (let index = 0; index < segments.length; index += 1) {
    const location = `$.segments[${index}]`;
    const segment = object(segments[index], location);
    stableId(required(segment, "id", location), `${location}.id`);
    const start = seconds(required(segment, "startTime", location), `${location}.startTime`);
    const end = seconds(required(segment, "endTime", location), `${location}.endTime`);
    if (start > end) reject("BAD_TIME_BOUNDS", location, "must satisfy startTime <= endTime");
    if (Object.hasOwn(segment, "speaker")) text(segment.speaker, `${location}.speaker`, 200);
    text(required(segment, "text", location), `${location}.text`, 10000);
  }

  uniqueIds(segments, "$.segments");
  for (let index = 1; index < segments.length; index += 1) {
    const prior = segments[index - 1];
    const current = segments[index];
    if (prior.startTime > current.startTime || (prior.startTime === current.startTime && prior.id > current.id)) {
      reject("SEGMENTS_NOT_SORTED", `$.segments[${index}]`, "must follow startTime/id ascending order");
    }
  }
}

function validatePlayback(value) {
  const message = object(value, "$");
  version(message);
  if (required(message, "type", "$") !== "PLAYBACK_STATE") {
    reject("INVALID_ENUM", "$.type", "must equal PLAYBACK_STATE");
  }
  const payload = object(required(message, "payload", "$"), "$.payload");
  videoId(required(payload, "videoId", "$.payload"), "$.payload.videoId");
  const current = seconds(required(payload, "currentTime", "$.payload"), "$.payload.currentTime");
  const duration = seconds(required(payload, "duration", "$.payload"), "$.payload.duration");
  if (duration > 0 && current > duration) {
    reject("BAD_TIME_BOUNDS", "$.payload.currentTime", "must not exceed a known duration");
  }
  boolean(required(payload, "paused", "$.payload"), "$.payload.paused");
  const rate = required(payload, "playbackRate", "$.payload");
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    reject("INVALID_PLAYBACK_RATE", "$.payload.playbackRate", "must be a finite positive number");
  }
  utcTimestamp(required(payload, "observedAt", "$.payload"), "$.payload.observedAt");
}

function validateApiError(value) {
  const payload = object(value, "$");
  version(payload);
  const error = object(required(payload, "error", "$"), "$.error");
  const code = required(error, "code", "$.error");
  if (!errorCodes.has(code)) reject("INVALID_ENUM", "$.error.code", "is not a supported API error code");
  text(required(error, "message", "$.error"), "$.error.message", 500);
  boolean(required(error, "retryable", "$.error"), "$.error.retryable");
  if (Object.hasOwn(error, "requestId")) stableId(error.requestId, "$.error.requestId");
  if (Object.hasOwn(error, "details")) object(error.details, "$.error.details");
}

const validators = Object.freeze({
  analysis: validateAnalysis,
  transcript: validateTranscript,
  playback: validatePlayback,
  apiError: validateApiError,
});

async function loadJson(path) {
  const source = await readFile(path, "utf8");
  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    reject("INVALID_JSON", path, error.message);
  }
}

async function checkSchemas() {
  for (const [contract, filename] of Object.entries(schemaFiles)) {
    const { value } = await loadJson(resolve(contractDirectory, filename));
    object(value, filename);
    if (value.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      reject("INVALID_SCHEMA", filename, "must declare JSON Schema Draft 2020-12");
    }
    if (value?.properties?.schemaVersion?.const !== 1) {
      reject("INVALID_SCHEMA", filename, "must require schemaVersion 1");
    }
    if (value.additionalProperties !== true) {
      reject("INVALID_SCHEMA", filename, "must allow unknown optional root properties");
    }
    if (!(contract in limits)) reject("INVALID_SCHEMA", filename, "has no payload-size limit");
  }
}

async function main() {
  await checkSchemas();
  const { value: manifest } = await loadJson(resolve(fixtureDirectory, "manifest.json"));
  object(manifest, "fixtures/manifest.json");
  version(manifest);
  const entries = array(required(manifest, "fixtures", "$"), "$.fixtures", { nonempty: true });
  let passed = 0;

  for (const entry of entries) {
    object(entry, "$.fixtures[]");
    const relativePath = text(entry.path, "$.fixtures[].path", 500);
    const fixturePath = resolve(fixtureDirectory, relativePath);
    if (!fixturePath.startsWith(`${fixtureDirectory}${sep}`)) {
      reject("INVALID_MANIFEST", relativePath, "fixture path escapes the fixtures directory");
    }
    const validator = validators[entry.contract];
    if (!validator) reject("INVALID_MANIFEST", relativePath, `unknown contract ${JSON.stringify(entry.contract)}`);

    let observedError;
    try {
      const { source, value } = await loadJson(fixturePath);
      const bytes = Buffer.byteLength(source, "utf8");
      if (bytes > limits[entry.contract]) {
        reject("PAYLOAD_TOO_LARGE", relativePath, `${bytes} bytes exceeds ${limits[entry.contract]}`);
      }
      validator(value);
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      observedError = error;
    }

    if (entry.valid === true && observedError) {
      throw new Error(`${relativePath}: expected valid but got ${observedError.code} (${observedError.message})`);
    }
    if (entry.valid === false) {
      if (!observedError) throw new Error(`${relativePath}: expected ${entry.expectedError} but fixture passed`);
      if (observedError.code !== entry.expectedError) {
        throw new Error(`${relativePath}: expected ${entry.expectedError} but got ${observedError.code} (${observedError.message})`);
      }
    }

    passed += 1;
    const outcome = entry.valid ? "valid" : `rejected (${observedError.code})`;
    console.log(`PASS ${relativePath} - ${outcome}`);
  }

  console.log(`\nValidated ${passed} fixtures against contract version 1.`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
