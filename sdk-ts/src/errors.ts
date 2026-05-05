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
}

export class AuthError extends ApiError {
  override name = 'AuthError';
}

export class BadRequestError extends ApiError {
  override name = 'BadRequestError';
}

export class NotFoundError extends ApiError {
  override name = 'NotFoundError';
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

export function classifyError(status: number, body: ApiErrorBody | null, url: string, retryAfterSec: number | null): ApiError {
  const msg = body?.error ?? body?.message ?? `HTTP ${status}`;
  if (status === 401 || status === 403) return new AuthError(String(msg), status, body, url);
  if (status === 404) return new NotFoundError(String(msg), status, body, url);
  if (status === 429) return new RateLimitError(String(msg), status, body, url, retryAfterSec);
  if (status >= 500) return new ServerError(String(msg), status, body, url);
  return new BadRequestError(String(msg), status, body, url);
}
