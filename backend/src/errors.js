// Typed errors for the local stack.
//
// PROVISIONAL: W1-T2 owns the canonical error contract. When it merges, keep
// these codes in sync with `contracts/` and delete anything it supersedes.
// Wire format:
//   { "schemaVersion": 1, "error": { "code", "message", "retryable" } }

export const SCHEMA_VERSION = 1;

/** @type {Record<string, { status: number, retryable: boolean }>} */
export const ERROR_CODES = {
  INVALID_URL: { status: 400, retryable: false },
  UNSUPPORTED_HOST: { status: 400, retryable: false },
  INVALID_REQUEST: { status: 400, retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },
  VIDEO_UNAVAILABLE: { status: 404, retryable: false },
  TRANSCRIPT_UNAVAILABLE: { status: 422, retryable: false },
  // Mock-only: no golden fixture exists for the requested video id. The real
  // backend never returns this code.
  MOCK_FIXTURE_MISSING: { status: 404, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  ANALYSIS_FAILED: { status: 502, retryable: true },
  UPSTREAM_TIMEOUT: { status: 504, retryable: true },
  CONFIG_ERROR: { status: 500, retryable: false },
  INTERNAL: { status: 500, retryable: false }
};

export class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES | string} code
   * @param {string} message Safe to show a developer. Never include secrets.
   * @param {{ details?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    const known = ERROR_CODES[code] ?? ERROR_CODES.INTERNAL;
    this.name = 'AppError';
    this.code = ERROR_CODES[code] ? code : 'INTERNAL';
    this.status = known.status;
    this.retryable = known.retryable;
    this.details = options.details;
  }
}

/** Configuration/secret problems. Message must stay actionable and value-free. */
export class ConfigError extends AppError {
  constructor(message, details) {
    super('CONFIG_ERROR', message, { details });
    this.name = 'ConfigError';
  }
}

/**
 * Convert any thrown value into the wire error body.
 * Unknown errors are flattened to INTERNAL so provider text never leaks.
 * @param {unknown} error
 */
export function toErrorResponse(error) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError('INTERNAL', 'Unexpected server error. Check the backend logs.');

  /** @type {{ code: string, message: string, retryable: boolean, details?: Record<string, unknown> }} */
  const body = {
    code: appError.code,
    message: appError.message,
    retryable: appError.retryable
  };
  if (appError.details) body.details = appError.details;

  return { status: appError.status, body: { schemaVersion: SCHEMA_VERSION, error: body } };
}
