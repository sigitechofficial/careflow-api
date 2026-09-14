import {
  ScheduledJobStatus,
  ScheduledVisitStatus,
} from '@prisma/client';
import {
  buildShellLocation,
  EMPLOYEE_APP_SHELL_LOCATION_REMOVED_KEYS,
  isVisitClosedForCarerSos,
} from './employee-app-visits.service';

describe('buildShellLocation', () => {
  it('serializes lat/lng as 4dp strings plus allowedRadiusMeters', () => {
    const location = buildShellLocation({
      latitude: 31.439,
      longitude: 74.228,
      allowedRadiusMeters: 1000,
    });

    expect(location).toEqual({
      latitude: '31.4390',
      longitude: '74.2280',
      allowedRadiusMeters: 1000,
    });
    expect(Object.keys(location).sort()).toEqual(
      ['allowedRadiusMeters', 'latitude', 'longitude'].sort(),
    );

    for (const key of EMPLOYEE_APP_SHELL_LOCATION_REMOVED_KEYS) {
      expect(location).not.toHaveProperty(key);
    }
  });

  it('allows null coordinates without adding removed location keys', () => {
    const location = buildShellLocation({
      latitude: null,
      longitude: null,
      allowedRadiusMeters: 1000,
    });

    expect(location.latitude).toBeNull();
    expect(location.longitude).toBeNull();
    expect(location).not.toHaveProperty('withinArea');
    expect(location).not.toHaveProperty('serviceUser');
    expect(location).not.toHaveProperty('label');
    expect(location).not.toHaveProperty('tone');
  });
});

describe('visit details payload keys', () => {
  it('documents that data.tabs must not be present on details responses', () => {
    const detailsData = {
      schemaVersion: 1,
      jobId: 'job-1',
      shell: {
        location: buildShellLocation({
          latitude: 51.5,
          longitude: -0.1,
          allowedRadiusMeters: 1000,
        }),
      },
      overview: {},
      tasks: {},
      medication: {},
      observations: {},
      log: {},
    };

    expect(detailsData).not.toHaveProperty('tabs');
    expect(detailsData.shell.location).not.toHaveProperty('withinArea');
    expect(detailsData.shell.location).not.toHaveProperty('serviceUser');
    expect(detailsData.shell.location.latitude).toBe('51.5000');
    expect(detailsData.shell.location.longitude).toBe('-0.1000');
  });
});

describe('isVisitClosedForCarerSos', () => {
  it('blocks SOS after the visit is completed or cancelled', () => {
    expect(
      isVisitClosedForCarerSos(ScheduledVisitStatus.COMPLETED, ScheduledJobStatus.COMPLETED),
    ).toBe(true);
    expect(
      isVisitClosedForCarerSos(ScheduledVisitStatus.CANCELLED, ScheduledJobStatus.ALLOCATED),
    ).toBe(true);
    expect(
      isVisitClosedForCarerSos(ScheduledVisitStatus.CALLED_OFF, ScheduledJobStatus.ALLOCATED),
    ).toBe(true);
    expect(
      isVisitClosedForCarerSos(ScheduledVisitStatus.STARTED, ScheduledJobStatus.IN_PROGRESS),
    ).toBe(false);
  });
});
