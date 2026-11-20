import { VisitAttendanceEventType, VisitAttendanceVerificationMethod } from '@prisma/client';
import { officeClockReason, officeClockTimelineEntry } from './office-clock-timeline.util';

const base = { employeeId: 'emp-1', notes: 'MANUAL:ADMIN_COMPLETE | approvedBy:user-1' };

describe('officeClockTimelineEntry', () => {
  it('logs an office clock-in under its own key, so the carer app row is never replaced', () => {
    const row = officeClockTimelineEntry({
      ...base,
      eventType: VisitAttendanceEventType.CHECK_IN,
      verificationMethod: VisitAttendanceVerificationMethod.MANUAL_OFFICE,
    });
    expect(row).toMatchObject({
      eventType: 'clock_in',
      sourceType: 'check_in',
      sourceId: 'office_check_in:emp-1',
      title: 'Clocked in (entered by the office)',
      detail: 'Recorded when the visit was completed.',
    });
  });

  it('logs an office clock-out', () => {
    const row = officeClockTimelineEntry({
      ...base,
      eventType: VisitAttendanceEventType.CHECK_OUT,
      verificationMethod: VisitAttendanceVerificationMethod.MANUAL_OFFICE,
    });
    expect(row).toMatchObject({ eventType: 'clock_out', sourceId: 'office_check_out:emp-1', title: 'Clocked out (entered by the office)' });
  });

  it('leaves app clock-ins and en-route events to the carer app', () => {
    expect(
      officeClockTimelineEntry({ ...base, eventType: VisitAttendanceEventType.CHECK_IN, verificationMethod: VisitAttendanceVerificationMethod.MOBILE_GPS }),
    ).toBeNull();
    expect(
      officeClockTimelineEntry({ ...base, eventType: VisitAttendanceEventType.EN_ROUTE, verificationMethod: VisitAttendanceVerificationMethod.MANUAL_OFFICE }),
    ).toBeNull();
  });
});

describe('officeClockReason', () => {
  it('turns the stored reason into plain words, without who approved it', () => {
    expect(officeClockReason('MANUAL:PHONE_FAILURE | Battery died | approvedBy:u1 | geofenceOverride:true')).toBe(
      'Reason: phone failure. Battery died',
    );
    expect(officeClockReason('MANUAL:NO_SIGNAL | approvedBy:u1')).toBe('Reason: no signal.');
    expect(officeClockReason(null)).toBe('Recorded when the visit was completed.');
  });
});
