import {
  buildShellLocation,
  EMPLOYEE_APP_SHELL_LOCATION_REMOVED_KEYS,
} from './employee-app-visits.service';

describe('buildShellLocation', () => {
  it('serializes only latitude, longitude, allowedRadiusMeters', () => {
    const location = buildShellLocation({
      latitude: 51.5074,
      longitude: -0.1278,
      allowedRadiusMeters: 1000,
    });

    expect(location).toEqual({
      latitude: 51.5074,
      longitude: -0.1278,
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
  });
});
