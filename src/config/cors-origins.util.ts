/**
 * Browser origins allowed to call the API cross-origin, from `ALLOWED_ORIGINS`
 * (comma-separated exact origins, e.g. `https://careflow.example.com,https://x.azurestaticapps.net`).
 */
export function parseAllowedOrigins(
  raw = process.env.ALLOWED_ORIGINS,
): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * CORS `origin` option shared by the HTTP API and the Socket.io gateway.
 * - `ALLOWED_ORIGINS` set → only those origins.
 * - unset outside production → any origin (local dev / LAN devices, as before).
 * - unset in production → no cross-origin browser access (fail closed).
 * Requests without an `Origin` header (mobile apps, curl, platform health probes) are not
 * subject to CORS and are unaffected either way.
 */
export function corsOrigin(
  env: NodeJS.ProcessEnv = process.env,
): boolean | string[] {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (allowed.length > 0) return allowed;
  return env.NODE_ENV !== 'production';
}
