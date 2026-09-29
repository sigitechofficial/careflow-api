/**
 * Geocode branch (ScheduleArea) addresses with Google's Geocoding API — the provider the admin
 * site already uses (Google Maps JS: Places + Geocoder, VITE_GOOGLE_MAPS_API_KEY). Coordinates
 * are never guessed: a result is accepted only when Google returns the branch's own postcode.
 *
 * Needs a SERVER-side key with the Geocoding API enabled (the admin browser key is normally
 * HTTP-referrer restricted and will be refused from a server):
 *   GOOGLE_MAPS_GEOCODING_API_KEY=... npx ts-node --transpile-only prisma/scripts/geocode-branches.ts          # dry run
 *   GOOGLE_MAPS_GEOCODING_API_KEY=... npx ts-node --transpile-only prisma/scripts/geocode-branches.ts --apply  # write lat/lng
 * Options: --force (re-geocode branches that already have coordinates), --all (not only CQC branches).
 */
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ALL = process.argv.includes('--all');
const API_KEY = process.env.GOOGLE_MAPS_GEOCODING_API_KEY?.trim();

type GeocodeResult = {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number }; location_type: string };
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
};

const normalizePostcode = (raw: string | null | undefined) =>
  (raw ?? '').replace(/\s+/g, '').toUpperCase();

async function geocode(
  address: string,
  countryCode: string,
): Promise<GeocodeResult | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('components', `country:${countryCode || 'GB'}`);
  url.searchParams.set('region', (countryCode || 'GB').toLowerCase());
  url.searchParams.set('key', API_KEY as string);
  const res = await fetch(url);
  const body = (await res.json()) as {
    status: string;
    error_message?: string;
    results: GeocodeResult[];
  };
  if (body.status === 'ZERO_RESULTS') return null;
  if (body.status !== 'OK')
    throw new Error(
      `Geocoding API ${body.status}: ${body.error_message ?? ''}`,
    );
  return body.results[0] ?? null;
}

async function main() {
  if (!API_KEY) {
    console.log(
      'GOOGLE_MAPS_GEOCODING_API_KEY is not set — nothing geocoded. Branch latitude/longitude stay null.\n' +
        'Create a server key (Geocoding API enabled, IP-restricted) and re-run; see the header of this file.',
    );
    if (APPLY) process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const branches = await prisma.scheduleArea.findMany({
      where: {
        deletedAt: null,
        ...(ALL ? {} : { cqcLocationId: { not: null } }),
        ...(FORCE ? {} : { OR: [{ latitude: null }, { longitude: null }] }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    console.log(
      `${APPLY ? 'APPLY' : 'DRY RUN'}: ${branches.length} branch(es) to geocode`,
    );

    for (const b of branches) {
      const address =
        [b.addressLine1, b.addressLine2, b.town, b.county, b.postcode]
          .filter((p) => p && p.trim())
          .join(', ') ||
        b.address ||
        '';
      if (!address || !b.postcode) {
        console.log(`  SKIP ${b.name}: no structured address/postcode`);
        continue;
      }
      const result = await geocode(address, b.countryCode);
      const resultPostcode = result?.address_components.find((c) =>
        c.types.includes('postal_code'),
      )?.long_name;
      if (
        !result ||
        normalizePostcode(resultPostcode) !== normalizePostcode(b.postcode)
      ) {
        console.log(
          `  SKIP ${b.name}: no result matching postcode ${b.postcode} (got ${resultPostcode ?? 'none'})`,
        );
        continue;
      }
      const { lat, lng } = result.geometry.location;
      console.log(
        `  ${APPLY ? 'SET ' : 'WOULD SET'} ${b.name}: ${lat}, ${lng} (${result.geometry.location_type}) — ${result.formatted_address}`,
      );
      if (APPLY) {
        await prisma.scheduleArea.update({
          where: { id: b.id },
          data: { latitude: lat, longitude: lng },
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
