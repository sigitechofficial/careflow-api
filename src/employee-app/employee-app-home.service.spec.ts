import {
  buildEmployeeAppHomeData,
  EMPLOYEE_APP_HOME_REMOVED_DATA_KEYS,
} from './employee-app-home.service';

describe('buildEmployeeAppHomeData', () => {
  it('serializes kept keys and omits trimmed top-level objects', () => {
    const data = buildEmployeeAppHomeData({
      date: '2026-08-04',
      activeVisit: null,
      visits: [
        {
          jobId: 'job-1',
          clientId: 'su-1',
          client: { name: 'Enid Morrison', initials: 'EM' },
          status: 'upcoming',
          statusLabel: '08:00',
          statusTone: 'neutral',
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
      activeVisit: null,
      visits: expect.any(Array),
      endOfShift: expect.objectContaining({ enabled: true }),
    });
    expect(Object.keys(data).sort()).toEqual(
      ['activeVisit', 'date', 'endOfShift', 'visits'].sort(),
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
      directions: { label: 'Directions', latitude: 51.5, longitude: -0.1 },
    };
    const data = buildEmployeeAppHomeData({
      date: '2026-08-04',
      activeVisit: activeVisit as never,
      visits: [],
      endOfShift: { enabled: false },
    });

    expect(data.activeVisit).toBe(activeVisit);
    expect(data.visits).toEqual([]);
    expect(data).not.toHaveProperty('greeting');
    expect(data).not.toHaveProperty('progress');
  });
});
