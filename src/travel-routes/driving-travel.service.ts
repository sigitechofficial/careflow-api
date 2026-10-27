import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  estimateRoute,
  googleDrivingRoute,
  type LatLng,
  type RouteLeg,
} from '../billing/visit-travel-distance.util';

/**
 * Driving distance and time between two map points, shared by the rota and visit billing.
 *
 * Google answers are kept in TravelRouteCache so the same journey is not asked for again. Without a
 * key, or when Google fails, the estimate from the coordinates is used and nothing is stored, so the
 * journey is asked for again next time.
 */

/** Google answers older than this are asked for again. */
export const ROUTE_CACHE_DAYS = 30;
const MAX_PARALLEL_GOOGLE_CALLS = 5;

export type RoutePair = { from: LatLng; to: LatLng };

/** Cache key of a map point: 5 decimals is about a metre. */
export function pointKey(p: LatLng): string {
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

const pairKey = (p: RoutePair) => `${pointKey(p.from)}|${pointKey(p.to)}`;

async function forEachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

@Injectable()
export class DrivingTravelService {
  private readonly logger = new Logger(DrivingTravelService.name);
  /** Replaced in tests. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  constructor(private readonly prisma: PrismaService) {}

  protected apiKey(): string | null {
    return process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
  }

  /** One journey; null when both points are the same place. */
  async between(from: LatLng, to: LatLng): Promise<RouteLeg | null> {
    const [leg] = await this.legs([{ from, to }]);
    return leg;
  }

  /** Each journey in the order given; null when both points of a journey are the same place. */
  async legs(pairs: RoutePair[]): Promise<(RouteLeg | null)[]> {
    const found = new Map<string, RouteLeg | null>();
    const toLookUp = new Map<string, RoutePair>();
    for (const p of pairs) {
      const key = pairKey(p);
      if (pointKey(p.from) === pointKey(p.to)) found.set(key, null);
      else toLookUp.set(key, p);
    }

    if (toLookUp.size) {
      const wanted = [...toLookUp.values()];
      const rows = await this.prisma.travelRouteCache.findMany({
        where: {
          originKey: { in: [...new Set(wanted.map((p) => pointKey(p.from)))] },
          destinationKey: { in: [...new Set(wanted.map((p) => pointKey(p.to)))] },
          fetchedAt: { gte: new Date(Date.now() - ROUTE_CACHE_DAYS * 86_400_000) },
        },
        select: { originKey: true, destinationKey: true, meters: true, seconds: true },
      });
      for (const r of rows) {
        const key = `${r.originKey}|${r.destinationKey}`;
        if (toLookUp.has(key)) found.set(key, { km: r.meters / 1000, minutes: r.seconds / 60, source: 'GOOGLE' });
      }
    }

    const missing = [...toLookUp.entries()].filter(([key]) => !found.has(key));
    const apiKey = this.apiKey();
    await forEachLimited(missing, MAX_PARALLEL_GOOGLE_CALLS, async ([key, p]) => {
      let leg: RouteLeg | null = null;
      if (apiKey) {
        try {
          leg = await googleDrivingRoute(p.from, p.to, apiKey, this.fetchImpl);
        } catch (err) {
          this.logger.warn(`Google route ${key} failed, using the estimate: ${String(err)}`);
        }
        if (leg) await this.save(p, leg);
      }
      found.set(key, leg ?? estimateRoute(p.from, p.to));
    });

    return pairs.map((p) => found.get(pairKey(p)) ?? null);
  }

  private async save(p: RoutePair, leg: RouteLeg): Promise<void> {
    const originKey = pointKey(p.from);
    const destinationKey = pointKey(p.to);
    const data = { meters: Math.round(leg.km * 1000), seconds: Math.round(leg.minutes * 60), fetchedAt: new Date() };
    try {
      await this.prisma.travelRouteCache.upsert({
        where: { originKey_destinationKey: { originKey, destinationKey } },
        create: { originKey, destinationKey, ...data },
        update: data,
      });
    } catch (err) {
      // The answer is still used; it is only asked for again next time.
      this.logger.warn(`Could not keep Google route ${originKey}|${destinationKey}: ${String(err)}`);
    }
  }
}
