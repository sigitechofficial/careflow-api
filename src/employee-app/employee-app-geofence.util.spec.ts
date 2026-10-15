import { resolveCarerGeofenceRadiusMeters } from './employee-app-geofence.util';

describe('resolveCarerGeofenceRadiusMeters', () => {
  it('adds the organisation distance and tolerance', () => {
    expect(
      resolveCarerGeofenceRadiusMeters({
        domGeofenceDistanceMeters: 100,
        domGeofenceToleranceMeters: 150,
      }),
    ).toBe(250);
  });

  it('uses the distance alone when no tolerance is set', () => {
    expect(
      resolveCarerGeofenceRadiusMeters({
        domGeofenceDistanceMeters: 300,
        domGeofenceToleranceMeters: 0,
      }),
    ).toBe(300);
  });

  it('falls back to 100 m when the distance is missing or zero', () => {
    expect(resolveCarerGeofenceRadiusMeters(null)).toBe(100);
    expect(
      resolveCarerGeofenceRadiusMeters({
        domGeofenceDistanceMeters: 0,
        domGeofenceToleranceMeters: 50,
      }),
    ).toBe(150);
  });
});
