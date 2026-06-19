import { BadRequestException } from '@nestjs/common';
import { assertVisitCancellationCompliance } from './visit-cancellation-validation.util';

describe('assertVisitCancellationCompliance', () => {
  it('requires welfare check for time-critical visits', () => {
    expect(() =>
      assertVisitCancellationCompliance({
        reasonCode: 'CLIENT_REQUEST',
        outcome: 'CANCELLED',
        welfareChecked: false,
        familyNotified: true,
        commissionerNotified: false,
        chargeDecision: 'NO_CHARGE',
        timeCriticalVisit: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('requires family or commissioner notification for time-critical visits', () => {
    expect(() =>
      assertVisitCancellationCompliance({
        reasonCode: 'CLIENT_REQUEST',
        outcome: 'CANCELLED',
        welfareChecked: true,
        familyNotified: false,
        commissionerNotified: false,
        chargeDecision: 'NO_CHARGE',
        timeCriticalVisit: true,
      }),
    ).toThrow(BadRequestException);
  });

  it('passes valid time-critical cancellation', () => {
    expect(() =>
      assertVisitCancellationCompliance({
        reasonCode: 'CLIENT_HOSPITAL_ADMISSION',
        outcome: 'CANCELLED',
        welfareChecked: true,
        familyNotified: true,
        commissionerNotified: false,
        chargeDecision: 'NO_CHARGE',
        timeCriticalVisit: true,
      }),
    ).not.toThrow();
  });
});
