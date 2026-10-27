import { DrivingTravelService, pointKey } from './driving-travel.service';

const chingford = { lat: 51.632, lng: 0.001 };
const tenKmSouth = { lat: 51.5421, lng: 0.001 };

type CacheRow = { originKey: string; destinationKey: string; meters: number; seconds: number };

function setup(options: { key?: string | null; cached?: CacheRow[]; google?: jest.Mock } = {}) {
  const prisma = {
    travelRouteCache: {
      findMany: jest.fn().mockResolvedValue(options.cached ?? []),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  class TestService extends DrivingTravelService {
    protected apiKey() {
      return options.key === undefined ? 'k' : options.key;
    }
  }
  const service = new TestService(prisma as never);
  const google =
    options.google ??
    jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ routes: [{ distanceMeters: 16093, duration: '1500s' }] }),
    });
  service.fetchImpl = google as unknown as typeof fetch;
  return { service, prisma, google };
}

describe('DrivingTravelService', () => {
  it('rounds map points to 5 decimals for the cache key', () => {
    expect(pointKey({ lat: 51.6320004, lng: -0.1234567 })).toBe('51.63200,-0.12346');
  });

  it('uses a kept Google answer without asking Google', async () => {
    const { service, google } = setup({
      cached: [{ originKey: pointKey(chingford), destinationKey: pointKey(tenKmSouth), meters: 12000, seconds: 1200 }],
    });
    await expect(service.between(chingford, tenKmSouth)).resolves.toEqual({ km: 12, minutes: 20, source: 'GOOGLE' });
    expect(google).not.toHaveBeenCalled();
  });

  it('asks Google once for a new journey and keeps the answer', async () => {
    const { service, prisma, google } = setup();
    const legs = await service.legs([
      { from: chingford, to: tenKmSouth },
      { from: chingford, to: tenKmSouth },
    ]);
    expect(legs).toEqual([
      { km: 16.093, minutes: 25, source: 'GOOGLE' },
      { km: 16.093, minutes: 25, source: 'GOOGLE' },
    ]);
    expect(google).toHaveBeenCalledTimes(1);
    expect(prisma.travelRouteCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ originKey: pointKey(chingford), meters: 16093, seconds: 1500 }),
      }),
    );
  });

  it('falls back to the estimate, and keeps nothing, when Google fails or there is no key', async () => {
    const failing = jest.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'denied' });
    const { service, prisma } = setup({ google: failing });
    await expect(service.between(chingford, tenKmSouth)).resolves.toMatchObject({ source: 'ESTIMATE' });
    expect(prisma.travelRouteCache.upsert).not.toHaveBeenCalled();

    const noKey = setup({ key: null });
    await expect(noKey.service.between(chingford, tenKmSouth)).resolves.toMatchObject({ source: 'ESTIMATE' });
    expect(noKey.google).not.toHaveBeenCalled();
  });

  it('gives nothing for the same place, without a lookup', async () => {
    const { service, prisma, google } = setup();
    await expect(service.between(chingford, chingford)).resolves.toBeNull();
    expect(prisma.travelRouteCache.findMany).not.toHaveBeenCalled();
    expect(google).not.toHaveBeenCalled();
  });
});
