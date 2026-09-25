import { MedicationKind, MedicationRecordStatus } from '@prisma/client';
import { dueTimeFallsInHmWindow } from './visit-medication-window.util';

/**
 * Active non-PRN schedule due times for a service user (HH:mm).
 * Used to decide medicationRequired per visit slot by window, not by round code.
 */
export async function loadScheduledMedicationDueTimes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  serviceUserId: string,
): Promise<string[]> {
  const meds = (await db.serviceUserMedication.findMany({
    where: {
      serviceUserId,
      deletedAt: null,
      isActive: true,
      status: MedicationRecordStatus.ACTIVE,
      medicationKind: { not: MedicationKind.PRN },
      schedules: {
        some: {
          deletedAt: null,
          isActive: true,
          dueTime: { not: null },
        },
      },
    },
    select: {
      schedules: {
        where: { deletedAt: null, isActive: true, dueTime: { not: null } },
        select: { dueTime: true },
      },
    },
  })) as Array<{
    schedules?: Array<{ dueTime: string | null } | null> | null;
  }>;

  const times: string[] = [];
  for (const med of meds) {
    for (const schedule of med.schedules ?? []) {
      const t = schedule?.dueTime?.trim();
      if (t) times.push(t);
    }
  }
  return times;
}

/** @deprecated Prefer loadScheduledMedicationDueTimes + resolveMedicationRequiredForSlot window match. */
export async function loadRoundsWithScheduledMedication(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  serviceUserId: string,
): Promise<Set<string>> {
  const meds = (await db.serviceUserMedication.findMany({
    where: {
      serviceUserId,
      deletedAt: null,
      isActive: true,
      status: MedicationRecordStatus.ACTIVE,
      medicationKind: { not: MedicationKind.PRN },
      schedules: {
        some: {
          deletedAt: null,
          isActive: true,
          roundId: { not: null },
        },
      },
    },
    select: {
      schedules: {
        where: { deletedAt: null, isActive: true, roundId: { not: null } },
        select: { round: { select: { code: true } } },
      },
    },
  })) as Array<{
    schedules?: Array<{ round: { code: string } | null } | null> | null;
  }>;

  const rounds = new Set<string>();
  for (const med of meds) {
    for (const schedule of med.schedules ?? []) {
      const code = schedule?.round?.code?.trim();
      if (code) rounds.add(code.toUpperCase());
    }
  }
  return rounds;
}

/**
 * True when any scheduled dueTime falls inside this visit slot's planned window.
 */
export function resolveMedicationRequiredForSlot(input: {
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  scheduledDueTimes: string[];
  /** @deprecated ignored — kept for call-site compatibility during migration */
  medicationRoundCode?: string | null;
  slotCode?: string | null;
  roundsWithScheduledMedication?: Set<string>;
}): boolean {
  const start = input.plannedStartTime?.trim();
  const end = input.plannedEndTime?.trim();
  if (!start || !end) return false;
  return input.scheduledDueTimes.some((due) => dueTimeFallsInHmWindow(due, start, end));
}
