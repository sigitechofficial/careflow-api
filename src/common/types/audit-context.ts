import type { RequestAuditMeta } from '../utils/request-audit-meta.util';

/** Optional audit context passed from controllers into services. */
export type AuditContext = RequestAuditMeta & {
  userId?: string;
};
