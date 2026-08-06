import {
  MedicationKind,
  MedicationRecordStatus,
  Prisma,
  VisitPlanMonthlyDayMode,
  VisitPlanRepeatUnit,
  VisitPlanScheduleFrequency,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_VISIT_TASK_SCHEDULE } from './visit-task-schedule.util';

export const EMAR_MEDICATION_PROMPT_NAME = 'Medication prompt';

export const EMAR_MEDICATION_PROMPT_INSTRUCTIONS =
  'Complete the eMAR for medicines due on this visit. Record each dose on the Medication tab — do not leave medicines unattended.';

const EMAR_PROMPT_FLAGS = {
  emarPrompt: true,
  moduleLink: 'emar',
} as const;

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * Rounds that have at least one active, scheduled (non-PRN) medication for this service user.
 */
export async function findRoundsWithScheduledEmarMeds(
  prisma: Tx,
  serviceUserId: string,
): Promise<Map<string, number>> {
  const rows = await prisma.serviceUserMedication.findMany({
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
  });

  const counts = new Map<string, number>();
  for (const med of rows) {
    const codes = new Set(
      med.schedules
        .map((s) => s.round?.code?.trim().toUpperCase())
        .filter((c): c is string => Boolean(c)),
    );
    for (const code of codes) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

/** Ensure the shared catalogue task exists (eMAR link via name + flags). */
export async function ensureEmarMedicationPromptCatalogueTask(
  prisma: Tx,
): Promise<{ id: string; name: string } | null> {
  const existing = await prisma.taskCatalogueTask.findFirst({
    where: { name: EMAR_MEDICATION_PROMPT_NAME, deletedAt: null },
    select: { id: true, name: true, flagsJson: true },
  });
  if (existing) {
    const flags =
      existing.flagsJson && typeof existing.flagsJson === 'object' && !Array.isArray(existing.flagsJson)
        ? (existing.flagsJson as Record<string, unknown>)
        : {};
    if (!flags.emarPrompt) {
      await prisma.taskCatalogueTask.update({
        where: { id: existing.id },
        data: {
          flagsJson: { ...flags, ...EMAR_PROMPT_FLAGS } as Prisma.InputJsonValue,
          isActive: true,
        },
      });
    }
    return { id: existing.id, name: existing.name };
  }

  const preferredCategory =
    (await prisma.taskCatalogueTask.findFirst({
      where: {
        deletedAt: null,
        isActive: true,
        category: { group: { code: 'observations_monitoring', deletedAt: null } },
      },
      select: { categoryId: true },
      orderBy: { sortOrder: 'asc' },
    })) ??
    (await prisma.taskCatalogueTask.findFirst({
      where: { deletedAt: null, isActive: true },
      select: { categoryId: true },
    }));

  if (!preferredCategory) return null;

  const created = await prisma.taskCatalogueTask.create({
    data: {
      categoryId: preferredCategory.categoryId,
      name: EMAR_MEDICATION_PROMPT_NAME,
      sortOrder: 5,
      supportLevelApplicable: true,
      consentRequired: false,
      flagsJson: EMAR_PROMPT_FLAGS as unknown as Prisma.InputJsonValue,
      isActive: true,
    },
    select: { id: true, name: true },
  });
  return created;
}

/**
 * Keep one "Medication prompt" visit task on each round that has scheduled eMAR doses.
 * Removes the prompt from rounds with no scheduled (non-PRN) meds.
 */
export async function syncEmarMedicationPromptsForServiceUser(
  prisma: PrismaService,
  serviceUserId: string,
  actorUserId?: string | null,
): Promise<{ added: string[]; removed: string[]; medicationCountByRound: Record<string, number> }> {
  const [roundMedCounts, promptTask] = await Promise.all([
    findRoundsWithScheduledEmarMeds(prisma, serviceUserId),
    ensureEmarMedicationPromptCatalogueTask(prisma),
  ]);

  const medicationCountByRound = Object.fromEntries(roundMedCounts);
  if (!promptTask) {
    return { added: [], removed: [], medicationCountByRound };
  }

  const added: string[] = [];
  const removed: string[] = [];

  await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceUserVisitTaskAssignment.findMany({
      where: {
        serviceUserId,
        taskCatalogueTaskId: promptTask.id,
        deletedAt: null,
      },
      select: {
        id: true,
        medicationRoundCode: true,
        isActive: true,
      },
    });
    const byRound = new Map(existing.map((row) => [row.medicationRoundCode.toUpperCase(), row]));

    for (const [roundCode, count] of roundMedCounts.entries()) {
      if (count <= 0) continue;
      const prev = byRound.get(roundCode);
      if (prev) {
        if (!prev.isActive) {
          await tx.serviceUserVisitTaskAssignment.update({
            where: { id: prev.id },
            data: {
              isActive: true,
              deletedAt: null,
              priority: 'important',
              carerInstructions: EMAR_MEDICATION_PROMPT_INSTRUCTIONS,
              updatedById: actorUserId ?? undefined,
            },
          });
          added.push(roundCode);
        }
        byRound.delete(roundCode);
        continue;
      }

      // Soft-deleted row may still exist under unique key — revive if found.
      const softDeleted = await tx.serviceUserVisitTaskAssignment.findFirst({
        where: {
          serviceUserId,
          medicationRoundCode: roundCode,
          taskCatalogueTaskId: promptTask.id,
        },
        select: { id: true },
      });

      if (softDeleted) {
        await tx.serviceUserVisitTaskAssignment.update({
          where: { id: softDeleted.id },
          data: {
            isActive: true,
            deletedAt: null,
            sortOrder: 0,
            priority: 'important',
            carerInstructions: EMAR_MEDICATION_PROMPT_INSTRUCTIONS,
            daysOfWeek: DEFAULT_VISIT_TASK_SCHEDULE.daysOfWeek,
            scheduleFrequency: VisitPlanScheduleFrequency.DAILY,
            repeatEvery: 1,
            repeatUnit: VisitPlanRepeatUnit.DAYS,
            timeCritical: false,
            timeToleranceMinutes: 30,
            monthlyDayMode: VisitPlanMonthlyDayMode.BY_DATE,
            monthlyDaysOfMonth: [],
            updatedById: actorUserId ?? undefined,
          },
        });
      } else {
        await tx.serviceUserVisitTaskAssignment.create({
          data: {
            serviceUserId,
            medicationRoundCode: roundCode,
            taskCatalogueTaskId: promptTask.id,
            sortOrder: 0,
            priority: 'important',
            carerInstructions: EMAR_MEDICATION_PROMPT_INSTRUCTIONS,
            daysOfWeek: DEFAULT_VISIT_TASK_SCHEDULE.daysOfWeek,
            scheduleFrequency: VisitPlanScheduleFrequency.DAILY,
            repeatEvery: 1,
            repeatUnit: VisitPlanRepeatUnit.DAYS,
            timeCritical: false,
            timeToleranceMinutes: 30,
            monthlyDayMode: VisitPlanMonthlyDayMode.BY_DATE,
            monthlyDaysOfMonth: [],
            isActive: true,
            createdById: actorUserId ?? undefined,
            updatedById: actorUserId ?? undefined,
          },
        });
      }
      added.push(roundCode);
    }

    // Rounds that still have a prompt but no scheduled meds → soft-remove.
    for (const [roundCode, row] of byRound.entries()) {
      if (roundMedCounts.has(roundCode)) continue;
      await tx.serviceUserVisitTaskAssignment.update({
        where: { id: row.id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          updatedById: actorUserId ?? undefined,
        },
      });
      removed.push(roundCode);
    }
  });

  return { added, removed, medicationCountByRound };
}

export function isEmarMedicationPromptTask(input: {
  name?: string | null;
  flagsJson?: unknown;
}): boolean {
  if (input.name?.trim() === EMAR_MEDICATION_PROMPT_NAME) return true;
  if (input.flagsJson && typeof input.flagsJson === 'object' && !Array.isArray(input.flagsJson)) {
    return Boolean((input.flagsJson as { emarPrompt?: unknown }).emarPrompt);
  }
  return false;
}
