// Deterministic offline provider.
//
// This is NOT the analyzer: Gemini is. It is a rule-based stand-in that lets
// every ordinary test, `ANALYSIS_MODE=mock`, and the demo run with no API key
// and no network, and it exercises the same parse/validate/dedupe path as a
// real model because it answers with the same JSON contract.
//
// It reads the transcript back out of the prompt it is given, which keeps the
// provider interface honest: a provider sees text, nothing else.

const SEGMENT_BLOCK = /BEGIN TRANSCRIPT DATA[^\n]*\n([\s\S]*?)\nEND TRANSCRIPT DATA/;

const CONFIDENCE = Object.freeze({
  contradiction: 0.9,
  strawman: 0.85,
  evasion: 0.8,
  missing_premise: 0.78,
  unsupported_claim: 0.82
});

const QUANTIFIER = /\b(almost every|every|everyone|everybody|all|nobody|no one|always|never)\b/i;
const SOURCE_MARKER = /\b(according to|study|studies|survey|data|report|research|source|percent|%)\b/i;
const SUPPORT_MARKER = /\b(could|would|can|will|might)\s+(support|back|try|consider)\b/i;
const SUPPORT_DENIAL = /\b(never|didn't|did not|dont|do not|no way)\b[^.]*\b(support|back|tr(y|ied)|consider)/i;
const DEFLECTION = /\b(the important thing|what matters|what really matters|the real question|let me be clear)\b/i;
const QUESTION_WORD = /^(what|how|why|when|who|where|which|do|does|did|is|are|can|could|would|will)\b/i;
const CONDITIONAL_LEAP = /\b(remove|ban|cut|close|end|stop)\b[^.]*\band\b[^.]*\b(lose|lost|fail|close|die|leave|collapse)\b/i;

const firstSentence = (text) => {
  const match = String(text).match(/^[^.!?]+[.!?]?/);
  return (match ? match[0] : String(text)).trim();
};

const isQuestion = (segment) =>
  String(segment.text).includes('?') || QUESTION_WORD.test(String(segment.text).trim());

/**
 * Rules are evaluated in order and the first match wins, so a segment produces
 * at most one finding. Order matters: several rules match the same sentence and
 * the earlier ones are the more specific reading.
 */
const RULES = [
  {
    type: 'contradiction',
    title: (segment) => `${segment.speaker ?? 'Speaker'} reverses an earlier position`,
    summary: (segment) =>
      `${segment.speaker ?? 'The speaker'} now rejects an option they said earlier they could support.`,
    matches: (segment, { earlierBySameSpeaker }) =>
      SUPPORT_DENIAL.test(segment.text) &&
      earlierBySameSpeaker.some((previous) => SUPPORT_MARKER.test(previous.text))
  },
  {
    type: 'strawman',
    title: () => 'Opposing position is restated in absolute terms',
    summary: (segment, { otherSpeaker }) =>
      `The speaker recasts ${otherSpeaker ?? 'the other participant'}'s position as an absolute demand and argues against that version.`,
    matches: (segment, { otherSpeakerTokens }) =>
      otherSpeakerTokens.some((token) => new RegExp(`\\b${token}\\b`, 'i').test(segment.text)) &&
      /\b(wants|thinks|believes|says|claims)\b/i.test(segment.text) &&
      /\b(every|all|forever|any|always|never)\b/i.test(segment.text)
  },
  {
    type: 'evasion',
    title: () => 'Question is not answered',
    summary: () => 'A direct question is answered with a values statement rather than the information requested.',
    matches: (segment, { previousSegment }) =>
      previousSegment !== null &&
      previousSegment.speaker !== segment.speaker &&
      isQuestion(previousSegment) &&
      DEFLECTION.test(segment.text)
  },
  {
    type: 'missing_premise',
    title: () => 'Conclusion rests on an unstated assumption',
    summary: () =>
      'The conclusion needs an assumption that has not been established: that the two outcomes are actually linked.',
    matches: (segment) => CONDITIONAL_LEAP.test(segment.text)
  },
  {
    type: 'unsupported_claim',
    title: () => 'Claim is offered without support',
    summary: (segment) =>
      `${segment.speaker ?? 'The speaker'} states a checkable claim in absolute terms without naming a source.`,
    matches: (segment) => QUANTIFIER.test(segment.text) && !SOURCE_MARKER.test(segment.text)
  }
];

/**
 * Recover the segments the prompt embedded.
 * @param {string} userPrompt
 * @returns {object[]}
 */
export function extractSegments(userPrompt) {
  const match = SEGMENT_BLOCK.exec(String(userPrompt ?? ''));
  if (match === null) return [];

  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Apply the rules to one chunk of segments.
 * @param {object[]} segments
 */
export function findingsFor(segments) {
  const speakers = [...new Set(segments.map((segment) => segment.speaker).filter(Boolean))];
  const findings = [];

  segments.forEach((segment, index) => {
    const otherSpeakerNames = speakers.filter((name) => name !== segment.speaker);

    const context = {
      previousSegment: index > 0 ? segments[index - 1] : null,
      earlierBySameSpeaker: segments.slice(0, index).filter((other) => other.speaker === segment.speaker),
      otherSpeakerNames,
      // Transcripts label speakers with a full name but participants address
      // each other by one part of it, so match on name tokens.
      otherSpeakerTokens: otherSpeakerNames
        .flatMap((name) => String(name).split(/\s+/))
        .filter((token) => token.length >= 3)
        .map((token) => token.replace(/[^A-Za-z0-9]/g, '')),
      otherSpeaker: otherSpeakerNames[0] ?? null
    };

    const rule = RULES.find((candidate) => candidate.matches(segment, context));
    if (rule === undefined) return;

    findings.push({
      segmentId: segment.id,
      type: rule.type,
      title: rule.title(segment, context),
      summary: rule.summary(segment, context),
      confidence: CONFIDENCE[rule.type],
      evidence: firstSentence(segment.text)
    });
  });

  return findings;
}

/**
 * @param {{ modelId?: string, latencyMs?: number }} [options]
 * @returns {import('./index.js').ModelProvider}
 */
export function createStubProvider(options = {}) {
  const modelId = options.modelId ?? 'stub-rules-1.0.0';

  return {
    name: 'stub',
    modelId,
    async generate({ user, signal }) {
      if (signal?.aborted) throw new Error('aborted');
      if (options.latencyMs) await new Promise((done) => setTimeout(done, options.latencyMs));

      return { text: JSON.stringify({ findings: findingsFor(extractSegments(user)) }), modelId };
    }
  };
}
