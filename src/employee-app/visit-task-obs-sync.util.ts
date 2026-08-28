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
    // An observation already exists for this visit — it was recorded via the
    // observation sheet and owns its OWN clinical value + notes. This task→obs
    // sync must only ensure the job/visit linkage; it must NOT overwrite the
    // observation's notes/value with the TASK's outcome notes/recordedValue
    // (that belongs to the task, and doing so made "Observation notes" and
    // "Task outcome notes" show the same value in admin).
    const existingPayload =
      typeof existing.payload === 'object' &&
      existing.payload &&
      !Array.isArray(existing.payload)
        ? (existing.payload as Record<string, unknown>)
        : {};
    await prisma.serviceUserObservation.update({
      where: { id: existing.id },
      data: {
        // Keep the observation's own reading/notes; only backfill if absent.
        numericValue: existing.numericValue ?? numericValue,
        notes: existing.notes ?? (input.notes?.trim() || null),
        unit: existing.unit ?? type.unitLabel ?? null,
        payload: {
          ...existingPayload,
          // Linkage only — never clobber the observation's own value.
          definitionId: existingPayload.definitionId ?? link.linkedTypeCode,
          scheduledJobId: existingPayload.scheduledJobId ?? input.jobId,
          scheduledVisitId: existingPayload.scheduledVisitId ?? input.visitId,
          source: existingPayload.source ?? 'visit_task',
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
