import { estimateTravelBetween, haversineKm, latLngOf, travelBetween } from './visit-travel-distance.util';

describe('travel between service users from coordinates', () => {
  const chingford = { lat: 51.632, lng: 0.001 };
  const tenKmSouth = { lat: 51.5421, lng: 0.001 };

  it('measures straight-line distance', () => {
    expect(haversineKm(chingford, tenKmSouth)).toBeCloseTo(10, 1);
  });

  it('turns it into road miles and driving minutes, as the rota does', () => {
    // 10 km × 1.35 = 13.5 road km ≈ 8.4 miles; 13.5 km at 28 km/h ≈ 29 minutes.
    expect(estimateTravelBetween(chingford, tenKmSouth)).toEqual({ miles: 8.4, minutes: 29, source: 'ESTIMATE' });
  });

  it('gives nothing for the same place', () => {
    expect(estimateTravelBetween(chingford, chingford)).toBeNull();
  });

  it('uses Google driving distance and time when a key is set', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 16093, duration: '1500s' }] }),
    }) as unknown as typeof fetch;
    await expect(travelBetween(chingford, tenKmSouth, { apiKey: 'k', fetchImpl })).resolves.toEqual({
      miles: 10,
      minutes: 25,
      source: 'GOOGLE',
    });
    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(init.headers['X-Goog-Api-Key']).toBe('k');
  });

  it('falls back to the estimate when Google fails or there is no key', async () => {
    const onGoogleError = jest.fn();
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'denied' }) as unknown as typeof fetch;
    await expect(travelBetween(chingford, tenKmSouth, { apiKey: 'k', fetchImpl, onGoogleError })).resolves.toMatchObject({
      source: 'ESTIMATE',
    });
    expect(onGoogleError).toHaveBeenCalled();
    await expect(travelBetween(chingford, tenKmSouth)).resolves.toMatchObject({ source: 'ESTIMATE' });
  });

  it('reads stored decimal coordinates and rejects missing ones', () => {
    expect(latLngOf('51.6320000', '0.0010000')).toEqual({ lat: 51.632, lng: 0.001 });
    expect(latLngOf(null, '0.001')).toBeNull();
    expect(latLngOf('x', '0.001')).toBeNull();
  });
});
