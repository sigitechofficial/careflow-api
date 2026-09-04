import {
  buildAdminCheckInSummary,
  checkInMethodDetailLine,
  extractEmployeeAppCheckIn,
  formatCheckInTimelineDetail,
  manualCheckInReasonLabel,
} from './check-in-display.util';

describe('check-in-display.util', () => {
  it('maps known manual reason codes', () => {
    expect(manualCheckInReasonLabel('GPS_UNAVAILABLE')).toBe('GPS unavailable');
    expect(manualCheckInReasonLabel('OTHER')).toBe('Other');
    expect(manualCheckInReasonLabel(null)).toBeNull();
  });

  it('extracts the employee-app check-in blob from job metadata', () => {
    expect(
      extractEmployeeAppCheckIn({
        employeeApp: {
          checkIn: {
            method: 'MANUAL',
            manualOverrideReasonCode: 'DEVICE_ISSUE',
            manualOverrideNotes: 'Phone GPS frozen',
          },
        },
      }),
    ).toEqual({
      method: 'MANUAL',
      manualOverrideReasonCode: 'DEVICE_ISSUE',
      manualOverrideNotes: 'Phone GPS frozen',
      timingStatus: null,
      timingExceptionReasonCode: null,
      timingExceptionNotes: null,
      outsideGeofenceReason: null,
    });
    expect(extractEmployeeAppCheckIn({})).toBeNull();
  });

  it('builds an admin summary for overview', () => {
    const summary = buildAdminCheckInSummary({
      method: 'manual',
      manualOverrideReasonCode: 'GPS_UNAVAILABLE',
      manualOverrideNotes: 'No lock',
    });
    expect(summary).toMatchObject({
      method: 'MANUAL',
      methodLabel: 'Manual',
      reasonCode: 'GPS_UNAVAILABLE',
      reasonLabel: 'GPS unavailable',
      notes: 'No lock',
    });
  });

  it('formats log detail with method, reason and notes', () => {
    expect(checkInMethodDetailLine('GPS')).toBe('GPS confirmed');
    expect(
      formatCheckInTimelineDetail({
        method: 'MANUAL',
        manualOverrideReasonCode: 'DEVICE_ISSUE',
        manualOverrideNotes: 'Phone GPS frozen',
      }),
    ).toBe('Manual clock-in\nReason: Device issue\nClock in notes: Phone GPS frozen');
  });

  it('labels late and early arrival instead of generic timing', () => {
    const late = buildAdminCheckInSummary({
      method: 'GPS',
      timingStatus: 'late',
      timingExceptionReasonCode: 'PREVIOUS_VISIT_OVERRAN',
      timingExceptionNotes: 'late arrival due to traffic',
    });
    expect(late).toMatchObject({
      timingStatus: 'late',
      timingKindLabel: 'Late arrival',
      timingNotesLabel: 'More detail on late arrival',
      timingExceptionReasonLabel: 'Previous visit overran',
    });
    expect(
      formatCheckInTimelineDetail({
        method: 'GPS',
        timingStatus: 'early',
        timingExceptionReasonCode: 'CLIENT_REQUEST_OR_NEED',
        timingExceptionNotes: 'family asked us to come sooner',
      }),
    ).toBe(
      'GPS confirmed\nEarly arrival: Client request or need\nMore detail on early arrival: family asked us to come sooner',
    );
  });
});
