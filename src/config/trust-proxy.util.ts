/**
 * Number of reverse-proxy hops in front of the API whose `X-Forwarded-For` entry Express may trust.
 * 0 (default) = do not trust the header at all (direct / local / cPanel without a proxy).
 * 1 = one proxy (e.g. Azure Container Apps ingress): `req.ip` becomes the right-most XFF entry,
 * i.e. the address that proxy appended, so a client-supplied (spoofed) XFF prefix is ignored.
 */
export function parseTrustProxyHops(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Applies `trust proxy` to an Express-based app only when hops > 0 (keeps current behaviour at 0). */
export function applyTrustProxy(
  app: { set(setting: string, value: unknown): unknown },
  hops: number,
): void {
  if (hops > 0) app.set('trust proxy', hops);
}
