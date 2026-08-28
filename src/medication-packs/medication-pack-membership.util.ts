import {
  MedicationKind,
  MedicationPackMemberStatus,
  MedicationPackStatus,
  MedicationRecordStatus,
  Prisma,
} from '@prisma/client';
import { formatHm } from '../medication-charts/medication-chart-rounds.util';
import type { PrismaService } from '../prisma/prisma.service';

type DbClient = Prisma.TransactionClient | PrismaService;

export type PackCompartmentDraft = {
  label: string;
  dueTime: string;
  windowStart: string | null;
  windowEnd: string | null;
  sortOrder: number;
};

type ScheduleForCompartment = {
  dueTime: string | null;
  round: {
    name: string;
    time: string;
    windowStart: string | null;
    windowEnd: string | null;
    sortOrder: number;
  } | null;
};

/** Unique tray slots from linked medication schedules (one compartment per due time). */
export function compartmentDraftsFromSchedules(
  schedules: ScheduleForCompartment[],
): PackCompartmentDraft[] {
  const byTime = new Map<string, PackCompartmentDraft>();
  for (const schedule of schedules) {
    const dueTime = formatHm(schedule.dueTime) ?? formatHm(schedule.round?.time);
    if (!dueTime) continue;
    if (byTime.has(dueTime)) continue;
    const round = schedule.round;
    byTime.set(dueTime, {
      label: round?.name?.trim() || dueTime,
      dueTime,
      windowStart: formatHm(round?.windowStart) ?? null,
      windowEnd: formatHm(round?.windowEnd) ?? null,
      sortOrder: round?.sortOrder ?? byTime.size,
    });
  }
  return [...byTime.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.dueTime.localeCompare(b.dueTime));
}

export function canLinkMedicationToPack(input: {
  medicationKind: MedicationKind;
  isControlledMedication: boolean;
}): boolean {
  return input.medicationKind !== MedicationKind.PRN && !input.isControlledMedication;
}

export async function ensurePackMemberForMedication(
  db: DbClient,
  input: {
    packId: string;
    medicationId: string;
    userId?: string | null;
    medicationKind: MedicationKind;
    isControlledMedication: boolean;
  },
): Promise<void> {
  if (!canLinkMedicationToPack(input)) return;

  await db.medicationPackMember.upsert({
    where: {
      medicationPackId_serviceUserMedicationId: {
        medicationPackId: input.packId,
        serviceUserMedicationId: input.medicationId,
      },
    },
    create: {
      medicationPackId: input.packId,
      serviceUserMedicationId: input.medicationId,
      status: MedicationPackMemberStatus.ACTIVE,
      linkedById: input.userId ?? undefined,
    },
    update: {
      status: MedicationPackMemberStatus.ACTIVE,
      linkedAt: new Date(),
      linkedById: input.userId ?? undefined,
      endedAt: null,
      endedById: null,
      deletedAt: null,
    },
  });
}

/**
 * Add-medication blister save used to set medicationPackId + pack items only.
 * The Blister packs tab reads MedicationPackMember — backfill the gap.
 */
export async function syncPackMembersFromLinkedMedications(
  db: DbClient,
  packId: string,
  userId?: string | null,
): Promise<number> {
  const pack = await db.medicationPack.findFirst({
    where: { id: packId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!pack) return 0;
  if (pack.status === MedicationPackStatus.ENDED || pack.status === MedicationPackStatus.SUPERSEDED) {
    return 0;
  }

  const linked = await db.serviceUserMedication.findMany({
    where: {
      medicationPackId: packId,
      deletedAt: null,
      isActive: true,
      status: MedicationRecordStatus.ACTIVE,
      medicationKind: { not: MedicationKind.PRN },
      isControlledMedication: false,
    },
    select: { id: true },
  });
  if (linked.length === 0) return 0;

  const existing = await db.medicationPackMember.findMany({
    where: { medicationPackId: packId, deletedAt: null },
    select: { serviceUserMedicationId: true, status: true },
  });
  const alreadyActive = new Set(
    existing
      .filter((m) => m.status === MedicationPackMemberStatus.ACTIVE)
      .map((m) => m.serviceUserMedicationId),
  );
  const endedIds = new Set(
    existing
      .filter((m) => m.status === MedicationPackMemberStatus.ENDED)
      .map((m) => m.serviceUserMedicationId),
  );

  let created = 0;
  for (const med of linked) {
    if (alreadyActive.has(med.id) || endedIds.has(med.id)) continue;
    await ensurePackMemberForMedication(db, {
      packId,
      medicationId: med.id,
      userId,
      medicationKind: MedicationKind.REGULAR,
      isControlledMedication: false,
    });
    created += 1;
  }
  return created;
}

/** When the Add-medication flow never created tray slots, derive them from linked schedules. */
export async function syncPackCompartmentsFromLinkedSchedules(
  db: DbClient,
  packId: string,
): Promise<number> {
  const pack = await db.medicationPack.findFirst({
    where: { id: packId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!pack) return 0;
  if (pack.status === MedicationPackStatus.ENDED || pack.status === MedicationPackStatus.SUPERSEDED) {
    return 0;
  }

  const existingCount = await db.medicationPackCompartment.count({
    where: { medicationPackId: packId, deletedAt: null, isActive: true },
  });
  if (existingCount > 0) return 0;

  const meds = await db.serviceUserMedication.findMany({
    where: {
      medicationPackId: packId,
      deletedAt: null,
      isActive: true,
      status: MedicationRecordStatus.ACTIVE,
    },
    select: {
      schedules: {
        where: { deletedAt: null, isActive: true },
        select: {
          dueTime: true,
          round: {
            select: {
              name: true,
              time: true,
              windowStart: true,
              windowEnd: true,
              sortOrder: true,
            },
          },
        },
      },
    },
  });
  const drafts = compartmentDraftsFromSchedules(meds.flatMap((m) => m.schedules));
  if (drafts.length === 0) return 0;

  await db.medicationPackCompartment.createMany({
    data: drafts.map((draft, index) => ({
      medicationPackId: packId,
      label: draft.label,
      dueTime: draft.dueTime,
      windowStart: draft.windowStart,
      windowEnd: draft.windowEnd,
      sortOrder: draft.sortOrder || index,
    })),
  });
  return drafts.length;
}
