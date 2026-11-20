import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { AddressLookupService, fromIdeal, isFullPostcode, normalisePostcode } from './address-lookup.service';

function respond(map: Record<string, { status: number; body: unknown }>) {
  return jest.fn(async (url: string) => {
    const hit = Object.entries(map).find(([k]) => url.includes(k));
    const r = hit ? hit[1] : { status: 404, body: { status: 404 } };
    return { status: r.status, json: async () => r.body } as Response;
  });
}

describe('AddressLookupService', () => {
  const realFetch = global.fetch;
  const realKey = process.env.IDEAL_POSTCODES_API_KEY;
  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.IDEAL_POSTCODES_API_KEY;
    else process.env.IDEAL_POSTCODES_API_KEY = realKey;
  });

  it('tidies postcodes', () => {
    expect(normalisePostcode(' tw32dl ')).toBe('TW3 2DL');
    expect(isFullPostcode('TW3 2DL')).toBe(true);
    expect(isFullPostcode('TW3')).toBe(false);
  });

  it('suggests postcodes from postcodes.io', async () => {
    global.fetch = respond({ '/postcodes/TW32/autocomplete': { status: 200, body: { result: ['TW3 2DL', 'TW3 2DN'] } } }) as never;
    await expect(new AddressLookupService().suggestPostcodes('tw3 2')).resolves.toEqual(['TW3 2DL', 'TW3 2DN']);
  });

  it('lists the addresses at a postcode, without sending the key anywhere but Ideal Postcodes', async () => {
    process.env.IDEAL_POSTCODES_API_KEY = 'test-key';
    const fetchMock = respond({
      'api.postcodes.io/postcodes/TW3': { status: 200, body: { result: { post_town: 'HOUNSLOW', admin_district: 'Hounslow', region: 'London', latitude: 51.46, longitude: -0.36 } } },
      'ideal-postcodes.co.uk/v1/postcodes/TW3': {
        status: 200,
        body: { code: 2000, result: [{ udprn: 1, line_1: '15 Maswell Park Road', line_2: '', post_town: 'HOUNSLOW', county: 'Middlesex', postcode: 'TW3 2DL', latitude: 51.46, longitude: -0.36 }] },
      },
    });
    global.fetch = fetchMock as never;
    const out = await new AddressLookupService().addressesForPostcode('tw32dl');
    expect(out.addressListAvailable).toBe(true);
    expect(out.addresses[0]).toMatchObject({ addressLine1: '15 Maswell Park Road', town: 'Hounslow', postcode: 'TW3 2DL', latitude: 51.46 });
    const urls = fetchMock.mock.calls.map(c => String(c[0]));
    expect(urls.filter(u => u.includes('test-key')).every(u => u.startsWith('https://api.ideal-postcodes.co.uk/'))).toBe(true);
  });

  it('without a key, still finds where the postcode is so the person can type the street', async () => {
    delete process.env.IDEAL_POSTCODES_API_KEY;
    global.fetch = respond({ 'api.postcodes.io/postcodes/TW3': { status: 200, body: { result: { post_town: 'HOUNSLOW', latitude: 51.4, longitude: -0.3 } } } }) as never;
    const out = await new AddressLookupService().addressesForPostcode('TW3 2DL');
    expect(out).toMatchObject({ addressListAvailable: false, addresses: [], area: { town: 'HOUNSLOW' } });
  });

  it('says plainly when the postcode is wrong or the service refuses', async () => {
    process.env.IDEAL_POSTCODES_API_KEY = 'k';
    global.fetch = respond({ 'ideal-postcodes': { status: 404, body: { code: 4040 } } }) as never;
    await expect(new AddressLookupService().addressesForPostcode('ZZ9 9ZZ')).rejects.toBeInstanceOf(BadRequestException);
    global.fetch = respond({ 'ideal-postcodes': { status: 402, body: { code: 4020 } } }) as never;
    await expect(new AddressLookupService().addressesForPostcode('TW3 2DL')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(new AddressLookupService().addressesForPostcode('TW3')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps an Ideal Postcodes address', () => {
    expect(fromIdeal({ line_1: 'Flat 2', line_2: '15 High St', line_3: 'Lampton', post_town: 'HOUNSLOW', postcode: 'TW3 1AA' }, 0)).toMatchObject({
      addressLine1: 'Flat 2',
      addressLine2: '15 High St, Lampton',
      town: 'Hounslow',
      summary: 'Flat 2, 15 High St, Lampton, Hounslow',
    });
  });

  describe('30-day address cache', () => {
    const idealBody = {
      code: 2000,
      result: [{ udprn: 7, line_1: '22 Lampton Road', post_town: 'HOUNSLOW', county: 'Middlesex', postcode: 'TW3 2DL', latitude: 51.47, longitude: -0.36 }],
    };
    function fakePrisma() {
      const rows = new Map<string, { postcode: string; payload: unknown; fetchedAt: Date }>();
      return {
        rows,
        postcodeAddressCache: {
          findUnique: jest.fn(async ({ where }: { where: { postcode: string } }) => rows.get(where.postcode) ?? null),
          upsert: jest.fn(async ({ create }: { create: { postcode: string; payload: unknown; fetchedAt: Date } }) => {
            rows.set(create.postcode, { ...create });
          }),
        },
      };
    }
    const lookups = (m: jest.Mock) => m.mock.calls.filter(c => String(c[0]).includes('ideal-postcodes')).length;

    it('asks the paid service once, then reuses the stored list, even after a restart', async () => {
      process.env.IDEAL_POSTCODES_API_KEY = 'k';
      const db = fakePrisma();
      const fetchMock = respond({ 'ideal-postcodes': { status: 200, body: idealBody }, 'api.postcodes.io': { status: 200, body: { result: { post_town: 'HOUNSLOW' } } } });
      global.fetch = fetchMock as never;
      await new AddressLookupService(db as never).addressesForPostcode('TW3 2DL');
      const again = await new AddressLookupService(db as never).addressesForPostcode('tw32dl'); // a new server: memory is empty
      expect(again.addresses[0].addressLine1).toBe('22 Lampton Road');
      expect(lookups(fetchMock)).toBe(1);
    });

    it('asks again once the stored list is older than 30 days', async () => {
      process.env.IDEAL_POSTCODES_API_KEY = 'k';
      const db = fakePrisma();
      db.rows.set('TW3 2DL', { postcode: 'TW3 2DL', payload: { postcode: 'TW3 2DL', addressListAvailable: true, addresses: [], area: null }, fetchedAt: new Date(Date.now() - 31 * 86_400_000) });
      const fetchMock = respond({ 'ideal-postcodes': { status: 200, body: idealBody } });
      global.fetch = fetchMock as never;
      const out = await new AddressLookupService(db as never).addressesForPostcode('TW3 2DL');
      expect(lookups(fetchMock)).toBe(1);
      expect(out.addresses).toHaveLength(1);
      expect(db.rows.get('TW3 2DL')!.fetchedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });

    it('still answers when the cache table cannot be read', async () => {
      process.env.IDEAL_POSTCODES_API_KEY = 'k';
      const db = fakePrisma();
      db.postcodeAddressCache.findUnique.mockRejectedValue(new Error('db down'));
      global.fetch = respond({ 'ideal-postcodes': { status: 200, body: idealBody } }) as never;
      await expect(new AddressLookupService(db as never).addressesForPostcode('TW3 2DL')).resolves.toMatchObject({ addressListAvailable: true });
    });
  });
});
