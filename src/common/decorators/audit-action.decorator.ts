import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

export type AuditActionMetadata = {
  module: string;
  action: string;
  recordType?: string;
};

/**
 * Optional metadata for future interceptors / filters.
 * Mutating flows should still log inside services with accurate old/new values.
 */
export const AuditAction = (meta: AuditActionMetadata) => SetMetadata(AUDIT_ACTION_KEY, meta);
