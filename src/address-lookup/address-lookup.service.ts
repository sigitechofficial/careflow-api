import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * UK address lookup, the same pair of services the laundry platform uses:
 * - postcodes.io (free, no key): postcode suggestions while typing, and where a postcode is (town, county, map position).
 * - Ideal Postcodes (paid, IDEAL_POSTCODES_API_KEY): every address at a postcode.
 * The key stays on the server; the browser only ever calls CareFlow.
 */
export type LookupAddress = {
  id: string;
  /** One line for the list, e.g. "Flat 2, 15 Maswell Park Road, Hounslow". */
  summary: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  county: string;
  country: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
};

export type PostcodeAddresses = {
  postcode: string;
  /** False when the address list service is not set up: the place is still found, the person types the street. */
  addressListAvailable: boolean;
  addresses: LookupAddress[];
  /** Where the postcode is, for a manual entry. */
  area: { town: string; county: string; country: string; latitude: number | null; longitude: number | null } | null;
};

const POSTCODES_IO = 'https://api.postcodes.io';
const IDEAL = 'https://api.ideal-postcodes.co.uk/v1';
const TIMEOUT_MS = 8_000;
const ADDRESS_CACHE_MS = 24 * 60 * 60 * 1000;
const SUGGEST_CACHE_MS = 60 * 60 * 1000;
const CACHE_MAX = 2_000;

/** Full UK postcode, e.g. "TW3 2DL" / "tw32dl". */
const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export function normalisePostcode(raw: string): string {
  const compact = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length < 5) return compact;
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function isFullPostcode(raw: string): boolean {
  return FULL_POSTCODE.test(normalisePostcode(raw));
}

type IdealAddress = {
  udprn?: number | string;
  uprn?: string;
  line_1?: string;
  line_2?: string;
  line_3?: string;
  post_town?: string;
  county?: string;
  postcode?: string;
  latitude?: number | string;
  longitude?: number | string;
};

const clean = (s?: string | null) => (s ?? '').trim();

export function fromIdeal(a: IdealAddress, index: number): LookupAddress {
  const line1 = clean(a.line_1);
  const line2 = [clean(a.line_2), clean(a.line_3)].filter(Boolean).join(', ');
  const rawTown = clean(a.post_town);
  const town = rawTown ? rawTown.charAt(0) + rawTown.slice(1).toLowerCase() : '';
  const lat = a.latitude === undefined || a.latitude === '' ? null : Number(a.latitude);
  const lng = a.longitude === undefined || a.longitude === '' ? null : Number(a.longitude);
  return {
    id: String(a.udprn ?? a.uprn ?? index),
    summary: [line1, line2, town].filter(Boolean).join(', '),
    addressLine1: line1,
    addressLine2: line2,
    town,
    county: clean(a.county),
    country: 'United Kingdom',
    postcode: clean(a.postcode),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  };
}

class TtlCache<T> {
  private readonly map = new Map<string, { at: number; value: T }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: T) {
    if (this.map.size >= CACHE_MAX) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: Date.now(), value });
  }
}

@Injectable()
export class AddressLookupService {
  private readonly logger = new Logger(AddressLookupService.name);
  private readonly addressCache = new TtlCache<PostcodeAddresses>(ADDRESS_CACHE_MS);
  private readonly suggestCache = new TtlCache<string[]>(SUGGEST_CACHE_MS);

  private get idealKey(): string | null {
    return process.env.IDEAL_POSTCODES_API_KEY?.trim() || null;
  }

  status() {
    return { postcodeSuggestions: true, addressList: Boolean(this.idealKey) };
  }

  private async getJson(url: string): Promise<{ status: number; body: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Postcodes that start with what was typed (at least 2 characters). */
  async suggestPostcodes(query: string): Promise<string[]> {
    const compact = String(query ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (compact.length < 2 || compact.length > 8) return [];
    const cached = this.suggestCache.get(compact);
    if (cached) return cached;
    try {
      const { status, body } = await this.getJson(
        `${POSTCODES_IO}/postcodes/${encodeURIComponent(compact)}/autocomplete?limit=10`,
      );
      const list: string[] = status === 200 && Array.isArray(body?.result) ? body.result : [];
      this.suggestCache.set(compact, list);
      return list;
    } catch (e) {
      this.logger.warn(`Postcode suggestions failed: ${(e as Error).message}`);
      return [];
    }
  }

  /** Where a postcode is (no addresses). Null when it does not exist. */
  private async postcodeArea(postcode: string): Promise<PostcodeAddresses['area']> {
    try {
      const { status, body } = await this.getJson(`${POSTCODES_IO}/postcodes/${encodeURIComponent(postcode)}`);
      if (status !== 200 || !body?.result) return null;
      const r = body.result;
      return {
        town: clean(r.post_town ?? r.admin_district),
        county: clean(r.admin_county ?? r.region),
        country: 'United Kingdom',
        latitude: typeof r.latitude === 'number' ? r.latitude : null,
        longitude: typeof r.longitude === 'number' ? r.longitude : null,
      };
    } catch {
      return null;
    }
  }

  async addressesForPostcode(raw: string): Promise<PostcodeAddresses> {
    const postcode = normalisePostcode(raw);
    if (!isFullPostcode(postcode)) {
      throw new BadRequestException('Enter a full UK postcode, for example TW3 2DL.');
    }
    const cached = this.addressCache.get(postcode);
    if (cached) return cached;

    const key = this.idealKey;
    const area = await this.postcodeArea(postcode);
    if (!key) {
      if (!area) throw new BadRequestException(`We couldn't find the postcode ${postcode}. Check it, or type the address.`);
      return { postcode, addressListAvailable: false, addresses: [], area };
    }

    let result: { status: number; body: any };
    try {
      result = await this.getJson(`${IDEAL}/postcodes/${encodeURIComponent(postcode)}?api_key=${encodeURIComponent(key)}`);
    } catch (e) {
      this.logger.warn(`Address lookup failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('The address list is not answering right now. Type the address instead.');
    }
    const code = Number(result.body?.code);
    if (result.status === 404 || code === 4040) {
      throw new BadRequestException(`We couldn't find the postcode ${postcode}. Check it, or type the address.`);
    }
    if (result.status !== 200 || code !== 2000 || !Array.isArray(result.body?.result)) {
      // 4010 bad key, 4020 no lookups left, 4021 daily limit: say so plainly, never the key.
      this.logger.warn(`Address lookup refused: status ${result.status}, code ${code}`);
      throw new ServiceUnavailableException('The address list is not available right now. Type the address instead.');
    }
    const payload: PostcodeAddresses = {
      postcode,
      addressListAvailable: true,
      addresses: (result.body.result as IdealAddress[]).map(fromIdeal),
      area,
    };
    this.addressCache.set(postcode, payload);
    return payload;
  }
}
