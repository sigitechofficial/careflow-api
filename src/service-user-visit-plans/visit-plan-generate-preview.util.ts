import type { VisitPlanSlot } from '@prisma/client';
import { DEFAULT_OPERATIONAL_TIMEZONE } from '../common/utils/operational-day.util';
import { buildVisitPlanOccurrence, type SlotWithRelations } from './visit-plan-generate-occurrence.util';
import { activeServiceUserAbsenceWhere, calendarDayUtcNoon } from '../service-user-absences/active-absence.util';
import { computeGenerationStart, maxAllowedBackfillDays } from './visit-plan-slot-carer-resolve.util';

export type GenerateSchedulePreviewResult = {
  visitsToCreate: number;
  visitsSkippedAbsent: number;
  visitsSkippedSkip: number;
  visitsSkippedBankHoliday: number;
  visitsSkippedOffPattern: number;
  visitsSkippedNoBackfillAllow: number;
  visitsAlreadyExist: number;
  backfillDays: number;
  maxSlotBackfillDays: number;
  truncated: boolean;
};

type PreviewParams = {
  serviceUserId: string;
  planId: string;
  fromDate: Date;
  toDate: Date;
  backfillDays: number;
  /** Organisation limit (Settings → Dom Care); 0 = backfill off. */
  orgMaxBackfillDays: number;
  /** Only generate days strictly before fromDate (rota start catch-up). */
  backfillOnly?: boolean;
  enabledSlots: SlotWithRelations[];
  scheduleAnchor: Date;
  planEffectiveTo: Date | null;
  bankHolidayDates: Set<string>;
  absenceDays: Set<string>;
  /** Org operational IANA timezone for converting slot HH:mm → UTC. */
  timeZone?: string;
};

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function previewGenerateScheduleFromPlan(
  prisma: {
    serviceUserAbsence: { count: (args: unknown) => Promise<number> };
    scheduledVisit: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  },
  params: PreviewParams,
): Promise<GenerateSchedulePreviewResult> {
  const dayMs = 86400000;
  const backfillOnly = params.backfillOnly === true && params.backfillDays > 0;
  const clampToSlot = !backfillOnly;
  const orgMax = params.orgMaxBackfillDays;
  const maxSlotBackfillDays = Math.max(
    0,
    ...params.enabledSlots.map((s) => maxAllowedBackfillDays(s.allowBackfillDays, orgMax, orgMax)),
  );

  const rangeStart = new Date(params.fromDate);
  if (params.backfillDays > 0) {
    rangeStart.setUTCDate(rangeStart.getUTCDate() - params.backfillDays);
  }

  const rangeEnd = backfillOnly
    ? new Date(params.fromDate.getTime() - dayMs)
    : params.toDate;

  let visitsToCreate = 0;
  let visitsSkippedAbsent = 0;
  let visitsSkippedSkip = 0;
  const visitsSkippedBankHoliday = 0;
  let visitsSkippedOffPattern = 0;
  let visitsSkippedNoBackfillAllow = 0;
  let visitsAlreadyExist = 0;

  const empty = (): GenerateSchedulePreviewResult => ({
    visitsToCreate: 0,
    visitsSkippedAbsent: 0,
    visitsSkippedSkip: 0,
    visitsSkippedBankHoliday: 0,
    visitsSkippedOffPattern: 0,
    visitsSkippedNoBackfillAllow: 0,
    visitsAlreadyExist: 0,
    backfillDays: params.backfillDays,
    maxSlotBackfillDays,
    truncated: false,
  });

  if (rangeEnd.getTime() < rangeStart.getTime()) {
    return empty();
  }

  for (let t = rangeStart.getTime(); t <= rangeEnd.getTime(); t += dayMs) {
    const day = new Date(t);
    const dateStr = utcDateKey(day);
    const isBackfillDay = backfillOnly || t < params.fromDate.getTime();

    // Bank holidays no longer suppress visit generation — home-care visits
    // still occur on bank holidays (holiday only affects carer pay banding).
    if (params.absenceDays.has(dateStr)) {
      visitsSkippedAbsent += 1;
      continue;
    }

    const absentOnDay = await prisma.serviceUserAbsence.count({
      where: { serviceUserId: params.serviceUserId, ...activeServiceUserAbsenceWhere(calendarDayUtcNoon(day)) },
    });
    if (absentOnDay > 0) {
      visitsSkippedAbsent += 1;
      continue;
    }

    if (isBackfillDay) {
      const anySlotAllowsBackfill = params.enabledSlots.some((slot) => {
        const allowed = maxAllowedBackfillDays(slot.allowBackfillDays, params.backfillDays, orgMax);
        if (allowed <= 0) return false;
        const slotStart = computeGenerationStart(
          params.fromDate,
          params.backfillDays,
          slot.slotEffectiveFrom,
          { clampToSlotEffectiveFrom: clampToSlot },
        );
        return day.getTime() >= slotStart.getTime();
      });
      if (!anySlotAllowsBackfill) {
        visitsSkippedNoBackfillAllow += 1;
        continue;
      }
    }

    for (const slot of params.enabledSlots) {
      let extendBefore = 0;
      if (isBackfillDay) {
        const allowed = maxAllowedBackfillDays(slot.allowBackfillDays, params.backfillDays, orgMax);
        if (allowed <= 0) continue;
        const slotStart = computeGenerationStart(
          params.fromDate,
          params.backfillDays,
          slot.slotEffectiveFrom,
          { clampToSlotEffectiveFrom: clampToSlot },
        );
        if (day.getTime() < slotStart.getTime()) continue;
        extendBefore = allowed;
      }

      const occurrence = buildVisitPlanOccurrence(slot, day, params.scheduleAnchor, params.planEffectiveTo, {
        extendBeforeEffectiveFromDays: extendBefore,
        timeZone: params.timeZone?.trim() || DEFAULT_OPERATIONAL_TIMEZONE,
      });
      if (!occurrence) {
        const hasSkip = (slot.exceptions ?? []).some(
          (ex) =>
            ex.exceptionType === 'SKIP' && utcDateKey(ex.exceptionDate) === dateStr,
        );
        if (hasSkip) visitsSkippedSkip += 1;
        else visitsSkippedOffPattern += 1;
        continue;
      }

      const existingVisit = await prisma.scheduledVisit.findFirst({
        where: {
          visitPlanSlotId: slot.id,
          deletedAt: null,
          scheduledStartDateTime: occurrence.start,
        },
      });
      if (existingVisit) {
        visitsAlreadyExist += 1;
        continue;
      }

      visitsToCreate += 1;
    }
  }

  return {
    visitsToCreate,
    visitsSkippedAbsent,
    visitsSkippedSkip,
    visitsSkippedBankHoliday,
    visitsSkippedOffPattern,
    visitsSkippedNoBackfillAllow,
    visitsAlreadyExist,
    backfillDays: params.backfillDays,
    maxSlotBackfillDays,
    truncated: false,
  };
}

export function slotAsWithRelations(slot: VisitPlanSlot & {
  carerAssignments?: SlotWithRelations['carerAssignments'];
  exceptions?: SlotWithRelations['exceptions'];
}): SlotWithRelations {
  return slot as SlotWithRelations;
}
