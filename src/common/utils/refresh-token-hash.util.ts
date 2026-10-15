import { createHash, timingSafeEqual } from 'crypto';

/**
 * Digest stored for a refresh token (`refreshTokenHash` columns).
 *
 * Refresh tokens are high-entropy signed JWTs, so a fast SHA-256 of the FULL token is enough at
 * rest. Do NOT use bcrypt here: bcrypt only reads the first 72 bytes, and refresh JWTs of the same
 * account share a longer prefix (header + `sub`), so every older token would match the newest hash
 * and logout / password change could never revoke it.
 */
export function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken, 'utf8').digest('hex');
}

/**
 * Constant-time check of a presented refresh token against the stored digest.
 * A null/empty stored value means "no valid refresh token" (logged out / password changed or reset).
 * Legacy bcrypt values never match (different length), which simply forces one re-login.
 */
export function refreshTokenMatches(
  refreshToken: string,
  storedHash: string | null | undefined,
): boolean {
  if (!storedHash || typeof refreshToken !== 'string' || !refreshToken)
    return false;
  const presented = Buffer.from(hashRefreshToken(refreshToken), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}
