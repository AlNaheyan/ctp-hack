// MVP insight taxonomy.
//
// These five types are a closed enum in contracts/analysis-response.schema.json.
// Adding one is a coordinated contract change (see contracts/README.md), not a
// local edit here.

/** Bump when a definition changes enough to invalidate cached analyses. */
export const TAXONOMY_VERSION = '1.0.0';

/**
 * @typedef {object} InsightType
 * @property {string} id            contract enum value
 * @property {string} label         short UI label
 * @property {string} definition    what the model must look for
 * @property {string} requirement   the evidence bar for reporting it
 */

/** @type {InsightType[]} */
export const TAXONOMY = Object.freeze([
  Object.freeze({
    id: 'unsupported_claim',
    label: 'Unsupported claim',
    definition:
      'A factual or statistical assertion presented as settled without a source, study, or observation to back it.',
    requirement:
      'Report only if the claim is checkable in principle and no support is offered anywhere in the surrounding segments.'
  }),
  Object.freeze({
    id: 'contradiction',
    label: 'Contradiction',
    definition:
      'A speaker asserts something that conflicts with a position the same speaker took earlier in this transcript.',
    requirement: 'Report only if both statements come from the same speaker and cannot both be true.'
  }),
  Object.freeze({
    id: 'strawman',
    label: 'Strawman',
    definition:
      "A speaker restates another participant's position in a distorted, exaggerated, or absolute form, then argues against that version.",
    requirement:
      'Report only if the transcript contains the original position and the restatement materially changes it.'
  }),
  Object.freeze({
    id: 'evasion',
    label: 'Evasion',
    definition:
      'A direct question is answered with a different subject, a values statement, or a topic change instead of the information requested.',
    requirement: 'Report only if the question is in the transcript and the answer does not address it.'
  }),
  Object.freeze({
    id: 'missing_premise',
    label: 'Missing premise',
    definition:
      'A conclusion depends on an unstated assumption that has not been established and is not obviously shared.',
    requirement: 'Report only if you can name the specific assumption the argument needs.'
  })
]);

/** Contract enum values, in taxonomy order. */
export const INSIGHT_TYPES = Object.freeze(TAXONOMY.map((entry) => entry.id));

const BY_ID = new Map(TAXONOMY.map((entry) => [entry.id, entry]));

/** @param {unknown} id */
export function isInsightType(id) {
  return typeof id === 'string' && BY_ID.has(id);
}

/** @param {string} id */
export function insightType(id) {
  return BY_ID.get(id) ?? null;
}
