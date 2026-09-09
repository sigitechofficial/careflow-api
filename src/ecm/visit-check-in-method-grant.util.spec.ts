import { VisitCheckInMethodGrantStatus } from '@prisma/client';
import {
  isAuthorisedManualGrantActive,
  mapVisitCheckInMethodGrant,
  shouldReuseCheckInMethodGrant,
} from './visit-check-in-method-grant.util';

describe('visit-check-in-method-grant.util', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  it('only treats unexpired, unconsumed AUTHORISED grants as active Manual', () => {
    expect(
      isAuthorisedManualGrantActive(
        { status: VisitCheckInMethodGrantStatus.AUTHORISED, expiresAt: new Date('2026-09-08T22:00:00.000Z') },
        now,
      ),
    ).toBe(true);
    expect(
      isAuthorisedManualGrantActive(
        { status: VisitCheckInMethodGrantStatus.PENDING, expiresAt: new Date('2026-09-08T22:00:00.000Z') },
        now,
      ),
    ).toBe(false);
    expect(
      isAuthorisedManualGrantActive(
        {
          status: VisitCheckInMethodGrantStatus.AUTHORISED,
          expiresAt: new Date('2026-09-08T22:00:00.000Z'),
          consumedAt: now,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isAuthorisedManualGrantActive(
        { status: 'AUTHORISED', expiresAt: new Date('2026-09-08T11:00:00.000Z') },
        now,
      ),
    ).toBe(false);
  });

  it('reuses unexpired PENDING or AUTHORISED grants, not expired PENDING', () => {
    const expiresAt = new Date('2026-09-08T22:00:00.000Z');
    expect(
      shouldReuseCheckInMethodGrant(
        { status: VisitCheckInMethodGrantStatus.PENDING, expiresAt },
        now,
      ),
    ).toBe(true);
    expect(
      shouldReuseCheckInMethodGrant(
        { status: VisitCheckInMethodGrantStatus.AUTHORISED, expiresAt },
        now,
      ),
    ).toBe(true);
    expect(
      shouldReuseCheckInMethodGrant(
        { status: VisitCheckInMethodGrantStatus.PENDING, expiresAt: new Date('2026-09-08T11:00:00.000Z') },
        now,
      ),
    ).toBe(false);
    expect(
      shouldReuseCheckInMethodGrant(
        { status: VisitCheckInMethodGrantStatus.REJECTED, expiresAt },
        now,
      ),
    ).toBe(false);
  });

  it('maps grant GPS snapshot and manualEnabled for ECM / carer GET', () => {
    const dto = mapVisitCheckInMethodGrant(
      {
        id: 'g1',
        scheduledJobId: 'job-1',
        employeeId: 'emp-1',
        operationalDay: '2026-09-08',
        status: VisitCheckInMethodGrantStatus.AUTHORISED,
        carerNote: 'Stuck in traffic',
        officeNote: 'Use Manual today',
        latitude: 51.5,
        longitude: -0.1,
        accuracyMeters: 12.5,
        distanceMeters: 240,
        isMockedLocation: false,
        locationUnavailable: false,
        requestedAt: new Date('2026-09-08T07:10:00.000Z'),
        expiresAt: new Date('2026-09-08T22:59:59.999Z'),
        decidedAt: new Date('2026-09-08T07:20:00.000Z'),
        decidedById: 'user-1',
        decidedByName: 'Office Manager',
        consumedAt: null,
        ecmExceptionId: 'ex-1',
      },
      { employeeName: 'James Doyle', now },
    );
    expect(dto.manualEnabled).toBe(true);
    expect(dto.carerNote).toBe('Stuck in traffic');
    expect(dto.officeNote).toBe('Use Manual today');
    expect(dto.latitude).toBe(51.5);
    expect(dto.employeeName).toBe('James Doyle');
    expect(dto.decidedByName).toBe('Office Manager');
  });
});
