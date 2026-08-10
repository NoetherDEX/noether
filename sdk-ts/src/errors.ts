/**
 * Typed error hierarchy for the Noether SDK.
 *
 * All HTTP failures from the API surface as one of these. The original
 * response body (when present) is attached as `body` so callers can
 * inspect API-specific error codes (e.g. {error: 'simulation_failed'}).
 */

export interface ApiErrorBody {
  error?: string;
  message?: string;
  [k: string]: unknown;
}

export class NoetherError extends Error {
  override name = 'NoetherError';
}

export class NetworkError extends NoetherError {
  override name = 'NetworkError';
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class ApiError extends NoetherError {
  override name = 'ApiError';
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: ApiErrorBody | null,
    public readonly url: string,
  ) {
    super(message);
  }

  /**
   * Machine readable error code from the response body, e.g.
   * 'not_in_beta' or 'key_limit_reached'. Null when the body has none.
   */
  get code(): string | null {
    return typeof this.body?.error === 'string' ? this.body.error : null;
  }
}

/** 401 responses: missing, malformed, stale or invalid credentials. */
export class AuthError extends ApiError {
  override name = 'AuthError';
}

/**
 * 403 responses. Extends AuthError so existing catch blocks keep
 * working, while callers can now tell a closed beta rejection
 * (code 'not_in_beta') apart from a bad credential 401.
 */
export class ForbiddenError extends AuthError {
  override name = 'ForbiddenError';
}

export class BadRequestError extends ApiError {
  override name = 'BadRequestError';
}

export class NotFoundError extends ApiError {
  override name = 'NotFoundError';
}

/**
 * 409 responses, e.g. code 'key_limit_reached' when a wallet already
 * holds the maximum number of active API keys.
 */
export class ConflictError extends ApiError {
  override name = 'ConflictError';
}

/**
 * 451 responses: trading endpoints refused from a restricted
 * jurisdiction (code 'region_restricted').
 */
export class RegionRestrictedError extends ApiError {
  override name = 'RegionRestrictedError';
}

export class RateLimitError extends ApiError {
  override name = 'RateLimitError';
  constructor(
    message: string,
    status: number,
    body: ApiErrorBody | null,
    url: string,
    public readonly retryAfterSec: number | null,
  ) {
    super(message, status, body, url);
  }
}

export class ServerError extends ApiError {
  override name = 'ServerError';
}

/**
 * 503 responses. Extends ServerError so existing catch blocks keep
 * working. When the gateway asks the client to resubmit shortly
 * (code 'try_again_later' from tx submit), `retryAfterSec` carries the
 * retry hint in seconds read from the response headers.
 */
export class ServiceUnavailableError extends ServerError {
  override name = 'ServiceUnavailableError';
  constructor(
    message: string,
    status: number,
    body: ApiErrorBody | null,
    url: string,
    public readonly retryAfterSec: number | null,
  ) {
    super(message, status, body, url);
  }
}

export function classifyError(status: number, body: ApiErrorBody | null, url: string, retryAfterSec: number | null): ApiError {
  const msg = body?.error ?? body?.message ?? `HTTP ${status}`;
  if (status === 401) return new AuthError(String(msg), status, body, url);
  if (status === 403) return new ForbiddenError(String(msg), status, body, url);
  if (status === 404) return new NotFoundError(String(msg), status, body, url);
  if (status === 409) return new ConflictError(String(msg), status, body, url);
  if (status === 429) return new RateLimitError(String(msg), status, body, url, retryAfterSec);
  if (status === 451) return new RegionRestrictedError(String(msg), status, body, url);
  if (status === 503) return new ServiceUnavailableError(String(msg), status, body, url, retryAfterSec);
  if (status >= 500) return new ServerError(String(msg), status, body, url);
  return new BadRequestError(String(msg), status, body, url);
}
