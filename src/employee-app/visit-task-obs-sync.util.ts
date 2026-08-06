import { Prisma } from '@prisma/client';
import {
  parseObservationNumeric,
  resolveTaskObsLink,
} from './visit-task-obs-link.util';

type PrismaLike = {
  observationType: {
    findFirst: (args: {
      where: { code: string; isActive: boolean };
      select: { id: true; unitLabel: true; code: true };
    }) => Promise<{ id: string; unitLabel: string | null; code: string } | null>;
  };
  serviceUserObservation: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      numericValue: Prisma.Decimal | number | null;
      notes: string | null;
      unit: string | null;
      payload: unknown;
    } | null>;
    update: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
};

export type SyncObservationFromCompletedVisitTaskInput = {
  serviceUserId: string;
  jobId: string;
  visitId: string;
  taskName: string;
  groupCode?: string | null;
  flagsJson?: unknown;
  recordedValue?: string | null;
  notes?: string | null;
  /** Carer mobile path */
  recordedByEmployeeId?: string | null;
  /** Admin office path */
  recordedByUserId?: string | null;
};

/**
 * When an Obs-linked visit task is completed with a reading, mirror it into
 * ServiceUserObservation so Tasks + Observations stay consistent.
 *
 * Deduping:
 * - Employee: same type + employee within last 12h (mobile behaviour).
 * - Admin: prefer same type + user + scheduledJobId in payload; fall back to 12h window.
 */
export async function syncObservationFromCompletedVisitTask(
  prisma: PrismaLike,
  input: SyncObservationFromCompletedVisitTaskInput,
): Promise<{ synced: boolean; observationTypeCode?: string }> {
  const link = resolveTaskObsLink({
    name: input.taskName,
    groupCode: input.groupCode,
    flagsJson: input.flagsJson,
  });
  if (!link) return { synced: false };

  const type = await prisma.observationType.findFirst({
    where: { code: link.observationTypeCode, isActive: true },
    select: { id: true, unitLabel: true, code: true },
  });
  if (!type) return { synced: false };

  const numericValue =
    parseObservationNumeric(input.recordedValue) ?? parseObservationNumeric(input.notes);
  const since = new Date(Date.now() - 12 * 60 * 60 * 1000);

  let existing = null as Awaited<ReturnType<PrismaLike['serviceUserObservation']['findFirst']>>;

  if (input.recordedByEmployeeId) {
    existing = await prisma.serviceUserObservation.findFirst({
      where: {
        serviceUserId: input.serviceUserId,
        observationTypeId: type.id,
        deletedAt: null,
        recordedAt: { gte: since },
        recordedByEmployeeId: input.recordedByEmployeeId,
      },
      orderBy: { recordedAt: 'desc' },
    });
  } else if (input.recordedByUserId) {
    // Prefer an observation already tied to this scheduled job.
    const recentForUser = await prisma.serviceUserObservation.findFirst({
      where: {
        serviceUserId: input.serviceUserId,
        observationTypeId: type.id,
        deletedAt: null,
        recordedAt: { gte: since },
        recordedByUserId: input.recordedByUserId,
      },
      orderBy: { recordedAt: 'desc' },
    });
    if (recentForUser) {
      const payload =
        recentForUser.payload &&
        typeof recentForUser.payload === 'object' &&
        !Array.isArray(recentForUser.payload)
          ? (recentForUser.payload as Record<string, unknown>)
          : null;
      if (!payload?.scheduledJobId || payload.scheduledJobId === input.jobId) {
        existing = recentForUser;
      }
    }
  }

  const payloadBase: Record<string, unknown> = {
    definitionId: link.linkedTypeCode,
    outcome: 'recorded',
    value: numericValue ?? input.recordedValue ?? null,
    scheduledJobId: input.jobId,
    scheduledVisitId: input.visitId,
    source: 'visit_task',
  };
  if (input.recordedByEmployeeId) {
    payloadBase.recordedByEmployeeId = input.recordedByEmployeeId;
  }
  if (input.recordedByUserId) {
    payloadBase.recordedByUserId = input.recordedByUserId;
  }

  if (existing) {
    await prisma.serviceUserObservation.update({
      where: { id: existing.id },
      data: {
        numericValue: numericValue ?? existing.numericValue,
        notes: input.notes?.trim() || existing.notes,
        unit: type.unitLabel ?? existing.unit,
        payload: {
          ...(typeof existing.payload === 'object' &&
          existing.payload &&
          !Array.isArray(existing.payload)
            ? (existing.payload as Record<string, unknown>)
            : {}),
          ...payloadBase,
        } as Prisma.InputJsonValue,
      },
    });
    return { synced: true, observationTypeCode: type.code };
  }

  await prisma.serviceUserObservation.create({
    data: {
      serviceUserId: input.serviceUserId,
      observationTypeId: type.id,
      recordedAt: new Date(),
      numericValue,
      notes: input.notes?.trim() || null,
      unit: type.unitLabel ?? null,
      payload: payloadBase as Prisma.InputJsonValue,
      recordedByEmployeeId: input.recordedByEmployeeId ?? undefined,
      recordedByUserId: input.recordedByUserId ?? undefined,
    },
  });

  return { synced: true, observationTypeCode: type.code };
}
