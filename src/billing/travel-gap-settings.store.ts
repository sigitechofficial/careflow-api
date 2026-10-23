/**
 * The organisation's rules for paying the time between two visits as waiting or travel time.
 * Every place that works out inter-visit travel (pay run, visit reconciliation, travel
 * intervals) reads them here, so they agree. Defaults match the values used before the setting.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_LONG_BREAK_MINUTES,
  DEFAULT_MAX_AUTO_TRAVEL_GAP_MINUTES,
  DEFAULT_SHORT_GAP_MINUTES,
  TRAVEL_PAY_BASES,
  type DetectInterVisitTravelOptions,
  type InterVisitWindow,
  type TravelPayBasis,
} from './pay-inter-visit-travel.util';

type Db = PrismaService | Prisma.TransactionClient;

export type TravelGapSettings = {
  /** False = gaps are never paid automatically; only travel entered on a visit is paid. */
  enabled: boolean;
  /** GAP = the limits below; DISTANCE = the drive between the two addresses, same day only. */
  basis: TravelPayBasis;
  /** Gaps up to this are paid as waiting time. */
  waitingGapMinutes: number;
  /** Gaps from this between visits to the same service user are a break (not paid). */
  breakGapMinutes: number;
  /** Gaps from this are treated as the carer going home (not paid). */
  wentHomeGapMinutes: number;
  /** DISTANCE: average driving speed used to turn miles into travel minutes. */
  averageSpeedMph: number;
  /** DISTANCE: straight-line miles × this (roads are not straight). */
  roadFactor: number;
};

export const DEFAULT_TRAVEL_GAP_SETTINGS: TravelGapSettings = {
  enabled: true,
  basis: 'GAP',
  waitingGapMinutes: DEFAULT_SHORT_GAP_MINUTES,
  breakGapMinutes: DEFAULT_LONG_BREAK_MINUTES,
  wentHomeGapMinutes: DEFAULT_MAX_AUTO_TRAVEL_GAP_MINUTES,
  averageSpeedMph: 20,
  roadFactor: 1.3,
};

/** Longest gap the limits may cover (12 hours, the same cap as a recorded travel interval). */
export const MAX_TRAVEL_GAP_MINUTES = 12 * 60;

export async function loadTravelGapSettings(db: Db): Promise<TravelGapSettings> {
  const row = await db.organisationGeneralSettings.findFirst({
    select: {
      travelGapPayEnabled: true,
      travelPayBasis: true,
      travelWaitingGapMinutes: true,
      travelBreakGapMinutes: true,
      travelWentHomeGapMinutes: true,
      travelAverageSpeedMph: true,
      travelRoadFactor: true,
    },
  });
  if (!row) return DEFAULT_TRAVEL_GAP_SETTINGS;
  return {
    enabled: row.travelGapPayEnabled,
    basis: (TRAVEL_PAY_BASES as readonly string[]).includes(row.travelPayBasis)
      ? (row.travelPayBasis as TravelPayBasis)
      : 'GAP',
    waitingGapMinutes: row.travelWaitingGapMinutes,
    breakGapMinutes: row.travelBreakGapMinutes,
    wentHomeGapMinutes: row.travelWentHomeGapMinutes,
    averageSpeedMph: row.travelAverageSpeedMph,
    roadFactor: Number(row.travelRoadFactor),
  };
}

/** The settings as options for `detectInterVisitTravel`. */
export async function loadTravelGapOptions(db: Db): Promise<DetectInterVisitTravelOptions> {
  const [s, org] = await Promise.all([
    loadTravelGapSettings(db),
    db.organisationGeneralSettings.findFirst({ select: { timezone: true } }),
  ]);
  return {
    autoPayGaps: s.enabled,
    basis: s.basis,
    shortGapMinutes: s.waitingGapMinutes,
    longBreakMinutes: s.breakGapMinutes,
    maxAutoTravelGapMinutes: s.wentHomeGapMinutes,
    averageSpeedMph: s.averageSpeedMph,
    roadFactor: s.roadFactor,
    timeZone: org?.timezone || 'Europe/London',
  };
}

/**
 * Adds each service user's address map point to the windows (used by the DISTANCE basis).
 * Windows of service users without a located address are returned unchanged.
 */
export async function withServiceUserLocations<T extends InterVisitWindow>(db: Db, windows: T[]): Promise<T[]> {
  const ids = [...new Set(windows.map((w) => w.serviceUserId).filter((v): v is string => !!v))];
  if (!ids.length) return windows;
  const rows = await db.serviceUserAddress.findMany({
    where: { serviceUserId: { in: ids }, deletedAt: null, latitude: { not: null }, longitude: { not: null } },
    select: { serviceUserId: true, latitude: true, longitude: true },
  });
  const byId = new Map(rows.map((r) => [r.serviceUserId, { latitude: Number(r.latitude), longitude: Number(r.longitude) }]));
  return windows.map((w) => {
    const point = w.serviceUserId ? byId.get(w.serviceUserId) : undefined;
    return point ? { ...w, ...point } : w;
  });
}

/** Throws when the settings are out of order or out of range. */
export function assertValidTravelGapSettings(s: TravelGapSettings): void {
  if (!(TRAVEL_PAY_BASES as readonly string[]).includes(s.basis)) {
    throw new BadRequestException('Choose how travel is paid');
  }
  const values = [s.waitingGapMinutes, s.breakGapMinutes, s.wentHomeGapMinutes];
  if (values.some((v) => !Number.isInteger(v) || v < 1 || v > MAX_TRAVEL_GAP_MINUTES)) {
    throw new BadRequestException(`Each limit must be a whole number of minutes from 1 to ${MAX_TRAVEL_GAP_MINUTES}`);
  }
  if (s.waitingGapMinutes >= s.breakGapMinutes) {
    throw new BadRequestException('The waiting time limit must be shorter than the break limit');
  }
  if (s.breakGapMinutes > s.wentHomeGapMinutes) {
    throw new BadRequestException('The break limit can’t be longer than the went-home limit');
  }
  if (!Number.isInteger(s.averageSpeedMph) || s.averageSpeedMph < 5 || s.averageSpeedMph > 70) {
    throw new BadRequestException('The average speed must be a whole number from 5 to 70 mph');
  }
  if (!Number.isFinite(s.roadFactor) || s.roadFactor < 1 || s.roadFactor > 3) {
    throw new BadRequestException('The road factor must be from 1.0 to 3.0');
  }
}
