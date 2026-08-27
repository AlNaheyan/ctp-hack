// Contract validation driven by the canonical schemas.
//
// The rules are read from contracts/*.schema.json at runtime rather than
// restated here, so W1-T2 stays the single source of truth. This supports the
// Draft 2020-12 subset those files actually use and throws on anything else -
// if the contract grows a keyword, this fails loudly instead of silently
// skipping a rule.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../config.js';

const CONTRACTS_DIR = resolve(REPO_ROOT, 'contracts');

const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'format',
  'x-contractChecks'
]);

/** Payload ceilings from contracts/README.md, in bytes of UTF-8 JSON. */
export const SIZE_LIMITS = Object.freeze({
  analysis: 1024 * 1024,
  transcript: 5 * 1024 * 1024
});

const cache = new Map();

/**
 * @param {'analysis-response' | 'transcript' | 'api-error' | 'playback-message'} name
 */
export function loadSchema(name) {
  if (!cache.has(name)) {
    cache.set(name, JSON.parse(readFileSync(resolve(CONTRACTS_DIR, `${name}.schema.json`), 'utf8')));
  }
  return cache.get(name);
}

function typeMatches(value, type) {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      throw new Error(`Unsupported schema type: ${type}`);
  }
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => {
      if (node === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
      return node[key];
    }, root);
}

/**
 * @param {unknown} value
 * @param {object} schema
 * @param {object} root
 * @param {string} path
 * @param {string[]} errors
 */
function check(value, schema, root, path, errors) {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(`Unsupported schema keyword "${keyword}" at ${path}. Update backend/src/analysis/contract.js.`);
    }
  }

  if (schema.$ref !== undefined) {
    check(value, resolveRef(schema.$ref, root), root, path, errors);
    return;
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return;
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(', ')}`);
    return;
  }

  if (schema.type !== undefined && !typeMatches(value, schema.type)) {
    errors.push(`${path} must be a ${schema.type}`);
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path} does not match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must have at least ${schema.minItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => check(item, schema.items, root, `${path}[${index}]`, errors));
    }
  }

  if (typeMatches(value, 'object')) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) check(value[key], subSchema, root, `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) errors.push(`${path}.${key} is not allowed`);
      }
    }
  }
}

/**
 * Validate a payload against one canonical schema.
 * @param {unknown} payload
 * @param {string} schemaName
 * @returns {string[]} errors, empty when valid
 */
export function validateAgainstSchema(payload, schemaName) {
  const schema = loadSchema(schemaName);
  /** @type {string[]} */
  const errors = [];
  check(payload, schema, schema, schemaName.split('-')[0], errors);
  return errors;
}

function byteSize(payload) {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

/**
 * Schema plus the semantic rules listed in the schema's x-contractChecks, which
 * JSON Schema cannot express.
 * @param {unknown} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateAnalysisResponse(payload) {
  const errors = validateAgainstSchema(payload, 'analysis-response');
  if (errors.length > 0) return { valid: false, errors };

  const analysis = /** @type {any} */ (payload);

  if (Date.parse(analysis.generatedAt) >= Date.parse(analysis.expiresAt)) {
    errors.push('generatedAt must precede expiresAt');
  }

  const seen = new Set();
  let previous = null;

  analysis.events.forEach((event, index) => {
    const at = `events[${index}]`;
    if (seen.has(event.id)) errors.push(`${at}.id "${event.id}" is duplicated`);
    seen.add(event.id);

    if (!(event.startTime <= event.triggerTime && event.triggerTime <= event.endTime)) {
      errors.push(`${at}: startTime <= triggerTime <= endTime is violated`);
    }

    if (previous !== null) {
      const outOfOrder =
        event.triggerTime < previous.triggerTime ||
        (event.triggerTime === previous.triggerTime && event.id < previous.id);
      if (outOfOrder) errors.push(`${at}: events must be sorted by triggerTime then id`);
    }
    previous = event;
  });

  const size = byteSize(analysis);
  if (size > SIZE_LIMITS.analysis) {
    errors.push(`payload is ${size} bytes, over the ${SIZE_LIMITS.analysis} byte analysis limit`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {unknown} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTranscript(payload) {
  const errors = validateAgainstSchema(payload, 'transcript');
  if (errors.length > 0) return { valid: false, errors };

  const transcript = /** @type {any} */ (payload);
  const seen = new Set();
  let previous = null;

  transcript.segments.forEach((segment, index) => {
    const at = `segments[${index}]`;
    if (seen.has(segment.id)) errors.push(`${at}.id "${segment.id}" is duplicated`);
    seen.add(segment.id);

    if (segment.startTime > segment.endTime) errors.push(`${at}: startTime must be <= endTime`);
    if (segment.text.trim() === '') errors.push(`${at}.text must not be whitespace only`);

    if (previous !== null) {
      const outOfOrder =
        segment.startTime < previous.startTime ||
        (segment.startTime === previous.startTime && segment.id < previous.id);
      if (outOfOrder) errors.push(`${at}: segments must be sorted by startTime then id`);
    }
    previous = segment;
  });

  const size = byteSize(transcript);
  if (size > SIZE_LIMITS.transcript) {
    errors.push(`payload is ${size} bytes, over the ${SIZE_LIMITS.transcript} byte transcript limit`);
  }

  return { valid: errors.length === 0, errors };
}
