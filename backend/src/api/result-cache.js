// Final-result cache for completed analyses.
//
// Separate from the transcript cache (W2-T1) on purpose: the expensive artefact
// is the analysis, its lifetime is the 24-hour reuse window from the roadmap,
// and callers need the stored/expiry timestamps to build cache headers.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;

/**
 * @typedef {object} CacheEntry
 * @property {object} analysis contract-valid analysis response
 * @property {object} meta     analyzer bookkeeping (never served to clients)
 * @property {number} storedAt epoch ms
 * @property {number} expiresAt epoch ms
 */

export class AnalysisResultCache {
  /**
   * @param {{ ttlMs?: number, maxEntries?: number, clock?: () => number }} [options]
   */
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, clock = Date.now } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive integer');
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new TypeError('maxEntries must be a positive integer');

    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.clock = clock;
    /** @type {Map<string, CacheEntry>} */
    this.entries = new Map();
    this.stats = { hits: 0, misses: 0, stores: 0, evictions: 0, expirations: 0 };
  }

  /**
   * @param {string} key
   * @returns {(CacheEntry & { ageSeconds: number, expiresInSeconds: number }) | undefined}
   */
  get(key) {
    const entry = this.entries.get(key);

    if (entry === undefined) {
      this.stats.misses += 1;
      return undefined;
    }

    const now = this.clock();
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      this.stats.expirations += 1;
      this.stats.misses += 1;
      return undefined;
    }

    // Refresh insertion order so eviction stays least-recently-used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.stats.hits += 1;

    return {
      ...structuredClone({ analysis: entry.analysis, meta: entry.meta }),
      storedAt: entry.storedAt,
      expiresAt: entry.expiresAt,
      ageSeconds: Math.max(0, Math.floor((now - entry.storedAt) / 1000)),
      expiresInSeconds: Math.max(0, Math.floor((entry.expiresAt - now) / 1000))
    };
  }

  /**
   * @param {string} key
   * @param {{ analysis: object, meta: object }} value
   */
  set(key, { analysis, meta }) {
    const storedAt = this.clock();

    this.entries.delete(key);
    this.entries.set(key, {
      ...structuredClone({ analysis, meta }),
      storedAt,
      expiresAt: storedAt + this.ttlMs
    });
    this.stats.stores += 1;

    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
      this.stats.evictions += 1;
    }
  }

  delete(key) {
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  /** Health-endpoint view. Contains counts only - no keys, payloads, or secrets. */
  describe() {
    return { entries: this.entries.size, maxEntries: this.maxEntries, ttlMs: this.ttlMs, ...this.stats };
  }
}

export const ANALYSIS_CACHE_TTL_MS = DEFAULT_TTL_MS;
