import { AuditEventType } from '@prisma/client';
import { resolveAuditEventType } from './audit-event-type.util';

describe('resolveAuditEventType', () => {
  it('classifies observation create as CREATE', () => {
    expect(resolveAuditEventType('service_user_observation_created')).toBe(
      AuditEventType.CREATE,
    );
  });

  it('classifies profile view as VIEW', () => {
    expect(resolveAuditEventType('service_user_profile_viewed')).toBe(AuditEventType.VIEW);
  });

  it('classifies auto end-date as SYSTEM', () => {
    expect(
      resolveAuditEventType('medication_status_changed', { autoEndDate: true }),
    ).toBe(AuditEventType.SYSTEM);
  });

  it('classifies MAR export as EXPORT', () => {
    expect(resolveAuditEventType('medication_mar_exported')).toBe(AuditEventType.EXPORT);
  });

  it('respects explicit override', () => {
    expect(
      resolveAuditEventType('custom_action', null, AuditEventType.SECURITY),
    ).toBe(AuditEventType.SECURITY);
  });
});
