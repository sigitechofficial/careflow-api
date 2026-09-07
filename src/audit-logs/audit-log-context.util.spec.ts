import { AuditEventType } from '@prisma/client';
import {
  buildAuditLogContext,
  formatServiceUserDisplayName,
  pickLocationSubjectFromAuditRow,
  resolveServiceUserIdFromAuditRow,
} from './audit-log-context.util';

describe('audit-log-context.util', () => {
  it('resolves service user from MedicationChart recordId', () => {
    expect(
      resolveServiceUserIdFromAuditRow({
        recordType: 'MedicationChart',
        recordId: 'su-1',
        metadata: { chart: 'regular' },
      }),
    ).toBe('su-1');
  });

  it('builds readable restore summary with medication name', () => {
    const ctx = buildAuditLogContext(
      {
        action: 'medication_restored',
        eventType: null,
        description: null,
        metadata: { serviceUserId: 'su-1', restored: true },
        newValues: { medicationName: 'Atorvastatin' },
        oldValues: null,
        recordType: 'ServiceUserMedication',
        recordId: 'med-1',
      },
      {
        serviceUserNames: new Map([['su-1', 'Jane Smith (#42)']]),
        medicationById: new Map([
          ['med-1', { medicationName: 'Atorvastatin', serviceUserId: 'su-1' }],
        ]),
        observationById: new Map(),
      },
    );
    expect(ctx.summary).toBe('Restored Atorvastatin from archive');
    expect(ctx.serviceUserName).toBe('Jane Smith (#42)');
    expect(ctx.subject).toBe('Atorvastatin');
  });

  it('builds observation context from newValues when metadata is sparse', () => {
    const ctx = buildAuditLogContext(
      {
        action: 'service_user_observation_created',
        eventType: 'CREATE' as const,
        description: 'Recorded Weight: 72 kg',
        metadata: null,
        newValues: {
          serviceUserId: 'su-1',
          observationType: { name: 'Weight' },
          numericValue: 72,
          unit: 'kg',
        },
        oldValues: null,
        recordType: 'ServiceUserObservation',
        recordId: 'obs-1',
      },
      {
        serviceUserNames: new Map([['su-1', 'Jane Smith']]),
        medicationById: new Map(),
        observationById: new Map([
          [
            'obs-1',
            {
              serviceUserId: 'su-1',
              observationTypeName: 'Weight',
              valueLabel: '72 kg',
            },
          ],
        ]),
      },
    );
    expect(ctx.serviceUserName).toBe('Jane Smith');
    expect(ctx.subject).toBe('Weight: 72 kg');
    expect(ctx.eventType).toBe(AuditEventType.CREATE);
  });

  it('formats display name with preferred name', () => {
    expect(
      formatServiceUserDisplayName({
        firstName: 'Jane',
        lastName: 'Smith',
        preferredName: 'Janey',
        serviceUserNumber: '42',
      }),
    ).toBe('Janey (#42)');
  });

  it('builds a location assignment subject from zone/branch/area/postcode', () => {
    expect(
      pickLocationSubjectFromAuditRow({
        action: 'location.service_user.assigned',
        newValues: {
          zoneName: 'North',
          branchName: 'Leeds',
          areaName: 'LS1',
          postcode: 'LS1 1AA',
        },
      }),
    ).toBe('North / Leeds / LS1 / LS1 1AA');
  });
});
