import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const HMAC_HEADERS = {
  KEY_ID: 'x-api-key',
  TIMESTAMP: 'x-timestamp',
  SIGNATURE: 'x-signature',
} as const;

export const TIMESTAMP_TOLERANCE_SEC = 30;

/**
 * Canonical string to sign:
 *
 *   <METHOD>\n<PATH>\n<TIMESTAMP>\n<sha256_hex(body)>
 *
 * - METHOD is uppercase.
 * - PATH is the request path **with** query string, URL-encoded as it
 *   was sent.
 * - TIMESTAMP is unix seconds.
 * - body is the literal request body (empty string for GET).
 */
export function buildStringToSign(
  method: string,
  path: string,
  timestamp: number,
  body: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}

export function signRequest(secret: string, stringToSign: string): string {
  return createHmac('sha256', secret).update(stringToSign).digest('hex');
}

export function verifyRequest(secret: string, stringToSign: string, providedHex: string): boolean {
  const expected = signRequest(secret, stringToSign);
  if (expected.length !== providedHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(providedHex, 'hex'));
  } catch {
    return false;
  }
}

export function isFreshTimestamp(ts: number, now: number = Math.floor(Date.now() / 1000)): boolean {
  if (!Number.isFinite(ts)) return false;
  return Math.abs(now - ts) <= TIMESTAMP_TOLERANCE_SEC;
}
