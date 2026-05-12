import type { Request } from 'express';

export type RequestAuditMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

/**
 * Extracts client IP and User-Agent for audit trails.
 * Prefer reverse-proxy headers when present.
 */
export function getRequestAuditMeta(req: Request): RequestAuditMeta {
  const forwarded = req.headers['x-forwarded-for'];
  const fromForwarded =
    typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : Array.isArray(forwarded) ? forwarded[0] : undefined;
  const ip = fromForwarded ?? req.ip ?? req.socket?.remoteAddress ?? null;
  const ua = req.headers['user-agent'];
  return {
    ipAddress: ip,
    userAgent: typeof ua === 'string' ? ua : null,
  };
}
