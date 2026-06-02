import { MedicationAdministrationStatus } from '@prisma/client';
import {
  administrationStatusToCode,
  displayForCode,
  eventPendingManagerReview,
  resolveEventMarStatusCode,
} from './medication-chart-display.util';

describe('resolveEventMarStatusCode', () => {
  it('prefers stored statusCode over enum mapping', () => {
    expect(
      resolveEventMarStatusCode({
        status: MedicationAdministrationStatus.GIVEN,
        statusCode: 'F',
      }),
    ).toBe('F');
  });

  it('falls back to administrationStatusToCode', () => {
    expect(
      resolveEventMarStatusCode({
        status: MedicationAdministrationStatus.REFUSED,
        statusCode: null,
      }),
    ).toBe(administrationStatusToCode(MedicationAdministrationStatus.REFUSED));
  });
});

describe('eventPendingManagerReview', () => {
  it('is false when review is not required for the code', () => {
    const display = displayForCode('G', new Map());
    expect(eventPendingManagerReview(display, { managerReviewedAt: null })).toBe(false);
  });

  it('is true only while manager review is outstanding', () => {
    const display = {
      code: 'R',
      label: 'Refused',
      color: '#E53935',
      textColor: '#FFFFFF',
      requiresReview: true,
    };
    expect(eventPendingManagerReview(display, { managerReviewedAt: null })).toBe(true);
    expect(
      eventPendingManagerReview(display, { managerReviewedAt: new Date('2026-02-01') }),
    ).toBe(false);
  });
});
