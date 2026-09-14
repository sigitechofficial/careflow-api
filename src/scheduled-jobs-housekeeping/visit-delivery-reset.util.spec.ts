import { ScheduledJobStatus, ScheduledVisitStatus } from '@prisma/client';
import {
  applyVisitDeliveryResetMetadata,
  jobHasDeliveryToReset,
} from './visit-delivery-reset.util';

describe('visit-delivery-reset.util', () => {
  it('wipes carer-app and outcome metadata and stamps deliveryResetAt', () => {
    const next = applyVisitDeliveryResetMetadata(
      {
        employeeApp: { checkIn: { method: 'GPS' }, identityConfirmed: true },
        careNotDelivered: true,
        extraCareNotes: 'stay',
        notes: 'keep me',
      },
      { resetAt: '2026-09-14T10:00:00.000Z', reason: 'Wrong clock-in', resetById: 'user-1' },
    );

    expect(next.employeeApp).toEqual({});
    expect(next.careNotDelivered).toBeUndefined();
    expect(next.extraCareNotes).toBeUndefined();
    expect(next.notes).toBe('keep me');
    expect(next.deliveryResetAt).toBe('2026-09-14T10:00:00.000Z');
    expect(next.deliveryResetReason).toBe('Wrong clock-in');
    expect(next.deliveryResetById).toBe('user-1');
  });

  it('allows reset after clock-in or completed, not cancelled or untouched allocated', () => {
    expect(
      jobHasDeliveryToReset({
        status: ScheduledJobStatus.IN_PROGRESS,
        actualStartDateTime: '2026-09-14T08:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      jobHasDeliveryToReset({
        status: ScheduledJobStatus.COMPLETED,
      }),
    ).toBe(true);
    expect(
      jobHasDeliveryToReset({
        status: ScheduledJobStatus.ALLOCATED,
        visits: [{ status: ScheduledVisitStatus.STARTED }],
      }),
    ).toBe(true);
    expect(
      jobHasDeliveryToReset({
        status: ScheduledJobStatus.ALLOCATED,
        checkIn: { method: 'GPS' },
      }),
    ).toBe(true);
    expect(
      jobHasDeliveryToReset({
        status: ScheduledJobStatus.CANCELLED,
        actualStartDateTime: '2026-09-14T08:00:00.000Z',
      }),
    ).toBe(false);
    expect(
      jobHasDeliveryToReset({
        status: ScheduledJobStatus.ALLOCATED,
      }),
    ).toBe(false);
  });
});
