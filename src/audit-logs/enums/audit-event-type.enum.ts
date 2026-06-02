import { AuditEventType } from '@prisma/client';

/** Re-export Prisma enum — single source of truth with DB column. */
export { AuditEventType };

export const AUDIT_EVENT_TYPE_VALUES: AuditEventType[] = [
  AuditEventType.VIEW,
  AuditEventType.CREATE,
  AuditEventType.UPDATE,
  AuditEventType.DELETE,
  AuditEventType.EXPORT,
  AuditEventType.SECURITY,
  AuditEventType.SYSTEM,
];
