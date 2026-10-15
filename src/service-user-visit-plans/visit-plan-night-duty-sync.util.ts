import { Prisma, VisitPlanNightDuty } from '@prisma/client';
import { isVisitPlanExtraJobMetadata } from './visit-plan-extra-visit.util';
import { SYNCABLE_VISIT_STATUSES } from './visit-plan-slot-carer-sync.util';

/**
 * Copy a visit's night type onto its rota visits that have not started yet.
 * Billing and the carer app read the night type from the job, so a plan change must reach it.
 * Extra visits keep their own night type; started, finished and cancelled visits keep theirs.
 */
export async function syncVisitPlanSlotNightDutyToScheduledJobs(
  tx: Prisma.TransactionClient,
  params: { visitPlanSlotId: string; nightDuty: VisitPlanNightDuty; fromDateTime: Date },
): Promise<number> {
  const visits = await tx.scheduledVisit.findMany({
    where: {
      visitPlanSlotId: params.visitPlanSlotId,
      deletedAt: null,
      scheduledStartDateTime: { gte: params.fromDateTime },
      status: { in: SYNCABLE_VISIT_STATUSES },
      scheduledJob: { deletedAt: null },
    },
    select: { scheduledJob: { select: { id: true, metadata: true } } },
  });
  let updated = 0;
  for (const { scheduledJob: job } of visits) {
    if (isVisitPlanExtraJobMetadata(job.metadata)) continue;
    const meta =
      job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};
    if ((meta.nightDuty ?? VisitPlanNightDuty.NONE) === params.nightDuty) continue;
    await tx.scheduledJob.update({
      where: { id: job.id },
      data: { metadata: { ...meta, nightDuty: params.nightDuty } as Prisma.InputJsonValue },
    });
    updated += 1;
  }
  return updated;
}
