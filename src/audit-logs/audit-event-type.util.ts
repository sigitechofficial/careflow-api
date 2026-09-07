import { AuditEventType } from '@prisma/client';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return null;
}

/**
 * Resolves the enterprise event category for an audit row.
 * Callers may pass an explicit type; otherwise inferred from action + metadata.
 */
export function resolveAuditEventType(
  action: string,
  metadata?: unknown,
  explicit?: AuditEventType | null | undefined,
): AuditEventType {
  if (explicit) return explicit;

  const meta = asRecord(metadata);
  if (meta?.autoEndDate === true) return AuditEventType.SYSTEM;

  const a = action.toLowerCase();

  if (a.includes('export') || a.includes('exported')) {
    return AuditEventType.EXPORT;
  }

  if (
    a.includes('login') ||
    a.includes('logout') ||
    a.includes('password') ||
    a.includes('permission') ||
    a.includes('account_locked') ||
    a.startsWith('role_')
  ) {
    return AuditEventType.SECURITY;
  }

  if (
    a.includes('viewed') ||
    a.endsWith('_view') ||
    a === 'data_viewed' ||
    a.includes('downloaded')
  ) {
    return AuditEventType.VIEW;
  }

  if (a.includes('deleted') || a.includes('archived') || a.includes('cleared')) {
    return AuditEventType.DELETE;
  }

  if (
    a.includes('removed') &&
    !a.includes('permission_removed') &&
    !a.includes('restored')
  ) {
    return AuditEventType.DELETE;
  }

  if (a.includes('created') || a.includes('added') || a.includes('registered')) {
    return AuditEventType.CREATE;
  }

  if (
    a.includes('updated') ||
    a.includes('changed') ||
    a.includes('assigned') ||
    a.includes('recorded') ||
    a.includes('corrected') ||
    a.includes('reviewed') ||
    a.includes('restored') ||
    a.includes('ended') ||
    a.includes('verified') ||
    a.includes('rejected') ||
    a.includes('regenerated') ||
    a.includes('resent') ||
    a.includes('marked') ||
    a.includes('generated') ||
    a.includes('patched')
  ) {
    return AuditEventType.UPDATE;
  }

  return AuditEventType.UPDATE;
}

export function auditEventTypeLabel(type: AuditEventType): string {
  switch (type) {
    case AuditEventType.VIEW:
      return 'View';
    case AuditEventType.CREATE:
      return 'Create';
    case AuditEventType.UPDATE:
      return 'Update';
    case AuditEventType.DELETE:
      return 'Delete';
    case AuditEventType.EXPORT:
      return 'Export';
    case AuditEventType.SECURITY:
      return 'Security';
    case AuditEventType.SYSTEM:
      return 'System';
    default:
      return type;
  }
}
