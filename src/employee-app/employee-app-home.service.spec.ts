import {
  buildEmployeeAppHomeData,
  EMPLOYEE_APP_HOME_REMOVED_DATA_KEYS,
} from './employee-app-home.service';

describe('buildEmployeeAppHomeData', () => {
  it('serializes kept keys and omits trimmed top-level objects', () => {
    const data = buildEmployeeAppHomeData({
      date: '2026-08-04',
      organisationTimezone: 'Asia/Karachi',
      activeVisit: null,
      visits: [
        {
          jobId: 'job-1',
          clientId: 'su-1',
          client: { name: 'Enid Morrison', initials: 'EM' },
          status: 'upcoming',
          statusLabel: '08:00',
          statusTone: 'neutral',
          scheduledStart: '08:00',
          scheduledEnd: '09:00',
          scheduledStartIso: '2026-08-04T08:00:00.000Z',
          scheduledEndIso: '2026-08-04T09:00:00.000Z',
          tags: [],
        },
      ],
      endOfShift: {
        enabled: true,
        durationLabel: '1h',
        outstandingCount: 1,
        currency: 'GBP',
      },
    });

    expect(data).toEqual({
      date: '2026-08-04',
      organisationTimezone: 'Asia/Karachi',
      activeVisit: null,
      visits: expect.any(Array),
      endOfShift: expect.objectContaining({ enabled: true }),
    });
    expect(Object.keys(data).sort()).toEqual(
      ['activeVisit', 'date', 'endOfShift', 'organisationTimezone', 'visits'].sort(),
    );

    expect(data.visits[0]).toEqual(
      expect.objectContaining({
        scheduledStartIso: '2026-08-04T08:00:00.000Z',
        scheduledEndIso: '2026-08-04T09:00:00.000Z',
      }),
    );
    for (const key of EMPLOYEE_APP_HOME_REMOVED_DATA_KEYS) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it('keeps activeVisit when provided without reshaping nested fields', () => {
    const activeVisit = {
      jobId: 'job-active',
      clientId: 'su-1',
      alreadyClockedIn: true,
      identityConfirmed: false,
      scheduledStartIso: '2026-08-04T10:00:00.000Z',
      scheduledEndIso: '2026-08-04T10:30:00.000Z',
      directions: { label: 'Directions', latitude: 51.5, longitude: -0.1 },
    };
    const data = buildEmployeeAppHomeData({
      date: '2026-08-04',
      organisationTimezone: 'Europe/London',
      activeVisit: activeVisit as never,
      visits: [],
      endOfShift: { enabled: false },
    });

    expect(data.activeVisit).toBe(activeVisit);
    expect(data.activeVisit).toEqual(
      expect.objectContaining({
        scheduledStartIso: '2026-08-04T10:00:00.000Z',
        scheduledEndIso: '2026-08-04T10:30:00.000Z',
      }),
    );
    expect(data.visits).toEqual([]);
    expect(data).not.toHaveProperty('greeting');
    expect(data).not.toHaveProperty('progress');
  });
});
