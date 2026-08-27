// Typed errors for the local stack.
//
// Codes match W1-T2's closed v1 enum in contracts/api-error.schema.json.
// Wire format:
//   { "schemaVersion": 1, "error": { "code", "message", "retryable" } }

export const SCHEMA_VERSION = 1;

/** @type {Record<string, { status: number, retryable: boolean }>} */
export const ERROR_CODES = {
  INVALID_REQUEST: { status: 400, retryable: false },
  INVALID_YOUTUBE_URL: { status: 400, retryable: false },
  UNSUPPORTED_SCHEMA_VERSION: { status: 400, retryable: false },
  VIDEO_PRIVATE: { status: 403, retryable: false },
  VIDEO_NOT_FOUND: { status: 404, retryable: false },
  CAPTIONS_DISABLED: { status: 422, retryable: false },
  UNSUPPORTED_LANGUAGE: { status: 422, retryable: false },
  TRANSCRIPT_UNAVAILABLE: { status: 422, retryable: false },
  ANALYSIS_FAILED: { status: 502, retryable: true },
  UPSTREAM_TIMEOUT: { status: 504, retryable: true },
  INTERNAL_ERROR: { status: 500, retryable: false }
};

export class AppError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES | string} code
   * @param {string} message Safe to show a developer. Never include secrets.
   * @param {{ details?: Record<string, unknown>, cause?: unknown, status?: number, retryable?: boolean }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    const known = ERROR_CODES[code] ?? ERROR_CODES.INTERNAL_ERROR;
    this.name = 'AppError';
    this.code = ERROR_CODES[code] ? code : 'INTERNAL_ERROR';
    this.status = options.status ?? known.status;
    this.retryable = options.retryable ?? known.retryable;
    this.details = options.details;
  }
}

/** Configuration/secret problems. Message must stay actionable and value-free. */
export class ConfigError extends AppError {
  constructor(message, details) {
    super('INTERNAL_ERROR', message, { details });
    this.name = 'ConfigError';
  }
}

/**
 * Convert any thrown value into the wire error body.
 * Unknown errors are flattened to INTERNAL_ERROR so provider text never leaks.
 * @param {unknown} error
 */
export function toErrorResponse(error) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError('INTERNAL_ERROR', 'Unexpected server error. Check the backend logs.');

  /** @type {{ code: string, message: string, retryable: boolean, details?: Record<string, unknown> }} */
  const body = {
    code: appError.code,
    message: appError.message,
    retryable: appError.retryable
  };
  if (appError.details) body.details = appError.details;

  return { status: appError.status, body: { schemaVersion: SCHEMA_VERSION, error: body } };
}
