const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

/** Build the documented cache key: video, normalized language, source. */
export function buildTranscriptCacheKey({ videoId, language, captionSource }) {
  return `${videoId}:${String(language).toLowerCase()}:${captionSource}`;
}

/**
 * In-process transcript cache. W3-T1 may replace this behind the same get/set
 * boundary when it owns persistence and orchestration.
 */
export class MemoryTranscriptCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, clock = Date.now } = {}) {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive integer');
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new TypeError('maxEntries must be a positive integer');
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.clock = clock;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh insertion order for deterministic least-recently-used eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, {
      expiresAt: this.clock() + this.ttlMs,
      value: structuredClone(value)
    });

    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export const TRANSCRIPT_CACHE_TTL_MS = DEFAULT_TTL_MS;
