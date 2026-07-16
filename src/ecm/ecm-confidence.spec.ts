import {
  mapConfidence,
  confidenceFactors,
} from './ecm-evaluation.mapper';

describe('mapConfidence / confidenceFactors (BE1.31)', () => {
  it('rejects mock location', () => {
    expect(
      mapConfidence({
        hasCheckIn: true,
        hasCheckOut: true,
        isMockLocation: true,
        verificationMethod: 'MOBILE_GPS',
      }),
    ).toBe('REJECTED');
  });

  it('marks manual office as MANUALLY_VERIFIED', () => {
    expect(
      mapConfidence({
        hasCheckIn: true,
        hasCheckOut: true,
        manual: true,
      }),
    ).toBe('MANUALLY_VERIFIED');
  });

  it('verifies GPS with check-in and check-out', () => {
    expect(
      mapConfidence({
        hasCheckIn: true,
        hasCheckOut: true,
        verificationMethod: 'MOBILE_GPS',
        outsideGeofence: false,
        accuracyMeters: 20,
        identityConfirmed: true,
      }),
    ).toBe('VERIFIED');
  });

  it('lists confidence factors', () => {
    const factors = confidenceFactors({
      hasCheckIn: true,
      hasCheckOut: true,
      outsideGeofence: true,
      verificationMethod: 'MOBILE_GPS',
    });
    expect(factors).toContain('OUTSIDE_GEOFENCE');
    expect(factors).toContain('HAS_CHECK_OUT');
  });
});
