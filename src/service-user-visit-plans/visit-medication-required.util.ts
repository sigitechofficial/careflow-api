import { MedicationKind, MedicationRecordStatus } from '@prisma/client';

/**
 * Visit plan slots reuse medication round codes as visit window labels (MORNING, etc.).
 * That does NOT mean MAR is required — only that the slot is named after a round.
 * medicationRequired must reflect whether the service user has active scheduled
 * (non-PRN) medication for that round.
 */
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

export function resolveMedicationRequiredForSlot(input: {
  medicationRoundCode?: string | null;
  slotCode?: string | null;
  roundsWithScheduledMedication: Set<string>;
}): boolean {
  const code = (input.medicationRoundCode ?? input.slotCode)?.trim();
  if (!code) return false;
  return input.roundsWithScheduledMedication.has(code.toUpperCase());
}
