import type { PrismaClient } from '@prisma/client';

export type VisitPlansAndRotaTableCounts = {
  visitAction: number;
  jobAllocation: number;
  callOffVisit: number;
  scheduledVisit: number;
  scheduledJob: number;
  scheduleRun: number;
  scheduleAreaStatus: number;
  scheduleBatch: number;
  visitPlanAmendment: number;
  visitPlanSlot: number;
  serviceUserVisitPlan: number;
};

type CountClient = Pick<
  PrismaClient,
  | 'visitAction'
  | 'jobAllocation'
  | 'callOffVisit'
  | 'scheduledVisit'
  | 'scheduledJob'
  | 'scheduleRun'
  | 'scheduleAreaStatus'
  | 'scheduleBatch'
  | 'visitPlanAmendment'
  | 'visitPlanSlot'
  | 'serviceUserVisitPlan'
>;

export async function countVisitPlansAndRotaRows(
  prisma: CountClient,
): Promise<VisitPlansAndRotaTableCounts> {
  const [
    visitAction,
    jobAllocation,
    callOffVisit,
    scheduledVisit,
    scheduledJob,
    scheduleRun,
    scheduleAreaStatus,
    scheduleBatch,
    visitPlanAmendment,
    visitPlanSlot,
    serviceUserVisitPlan,
  ] = await Promise.all([
    prisma.visitAction.count(),
    prisma.jobAllocation.count(),
    prisma.callOffVisit.count(),
    prisma.scheduledVisit.count(),
    prisma.scheduledJob.count(),
    prisma.scheduleRun.count(),
    prisma.scheduleAreaStatus.count(),
    prisma.scheduleBatch.count(),
    prisma.visitPlanAmendment.count(),
    prisma.visitPlanSlot.count(),
    prisma.serviceUserVisitPlan.count(),
  ]);

  return {
    visitAction,
    jobAllocation,
    callOffVisit,
    scheduledVisit,
    scheduledJob,
    scheduleRun,
    scheduleAreaStatus,
    scheduleBatch,
    visitPlanAmendment,
    visitPlanSlot,
    serviceUserVisitPlan,
  };
}

/** Rows that belong to one service user's visit plans and rota. */
export type ServiceUserVisitsTableCounts = {
  scheduledJob: number;
  scheduledVisit: number;
  jobAllocation: number;
  visitAction: number;
  callOffVisit: number;
  scheduledJobCancellation: number;
  serviceUserVisitPlan: number;
  visitPlanSlot: number;
  visitPlanSlotException: number;
  visitPlanAmendment: number;
  visitPlanStatusEvent: number;
  /** Pending Hours approvals for this service user's visit plans (their visits no longer exist). */
  pendingHoursApproval: number;
};

/**
 * Deletes one service user's visit plans and rota — the same tables as
 * prisma/scripts/clear-service-user-visits.ts, except absences (not visits), which are kept.
 * Other service users, shared schedule runs and batches are not touched. All or nothing.
 */
export async function clearServiceUserVisitPlansAndRota(
  prisma: PrismaClient,
  serviceUserId: string,
  options: { dryRun: boolean },
): Promise<{
  counts: ServiceUserVisitsTableCounts;
  deleted?: ServiceUserVisitsTableCounts;
}> {
  const [jobIds, visitIds, planIds] = await Promise.all([
    prisma.scheduledJob
      .findMany({ where: { serviceUserId }, select: { id: true } })
      .then((r) => r.map((x) => x.id)),
    prisma.scheduledVisit
      .findMany({ where: { serviceUserId }, select: { id: true } })
      .then((r) => r.map((x) => x.id)),
    prisma.serviceUserVisitPlan
      .findMany({ where: { serviceUserId }, select: { id: true } })
      .then((r) => r.map((x) => x.id)),
  ]);
  const byJobOrVisit = {
    OR: [
      { scheduledJobId: { in: jobIds } },
      { scheduledVisitId: { in: visitIds } },
    ],
  };
  const pendingApprovals = {
    serviceUserId,
    status: 'PENDING' as const,
    visitPlanId: { in: planIds },
  };

  const [
    jobAllocation,
    visitAction,
    callOffVisit,
    scheduledJobCancellation,
    visitPlanAmendment,
    visitPlanStatusEvent,
    visitPlanSlotException,
    visitPlanSlot,
    pendingHoursApproval,
  ] = await Promise.all([
    prisma.jobAllocation.count({ where: byJobOrVisit }),
    prisma.visitAction.count({ where: byJobOrVisit }),
    prisma.callOffVisit.count({ where: { scheduledJobId: { in: jobIds } } }),
    prisma.scheduledJobCancellation.count({
      where: { scheduledJobId: { in: jobIds } },
    }),
    prisma.visitPlanAmendment.count({
      where: { visitPlanId: { in: planIds } },
    }),
    prisma.visitPlanStatusEvent.count({
      where: { visitPlanId: { in: planIds } },
    }),
    prisma.visitPlanSlotException.count({
      where: { visitPlanSlot: { visitPlanId: { in: planIds } } },
    }),
    prisma.visitPlanSlot.count({ where: { visitPlanId: { in: planIds } } }),
    prisma.employeeHoursApproval.count({ where: pendingApprovals }),
  ]);
  const counts: ServiceUserVisitsTableCounts = {
    scheduledJob: jobIds.length,
    scheduledVisit: visitIds.length,
    jobAllocation,
    visitAction,
    callOffVisit,
    scheduledJobCancellation,
    serviceUserVisitPlan: planIds.length,
    visitPlanSlot,
    visitPlanSlotException,
    visitPlanAmendment,
    visitPlanStatusEvent,
    pendingHoursApproval,
  };
  if (options.dryRun) return { counts };

  const deleted = await prisma.$transaction(
    async (tx) => {
      const jobAllocation = await tx.jobAllocation.deleteMany({
        where: byJobOrVisit,
      });
      const visitAction = await tx.visitAction.deleteMany({
        where: byJobOrVisit,
      });
      const callOffVisit = await tx.callOffVisit.deleteMany({
        where: { scheduledJobId: { in: jobIds } },
      });
      const scheduledJobCancellation =
        await tx.scheduledJobCancellation.deleteMany({
          where: { scheduledJobId: { in: jobIds } },
        });
      const scheduledVisit = await tx.scheduledVisit.deleteMany({
        where: { serviceUserId },
      });
      const scheduledJob = await tx.scheduledJob.deleteMany({
        where: { serviceUserId },
      });
      const pendingHoursApproval = await tx.employeeHoursApproval.deleteMany({
        where: pendingApprovals,
      });
      const visitPlanAmendment = await tx.visitPlanAmendment.deleteMany({
        where: { visitPlanId: { in: planIds } },
      });
      const visitPlanStatusEvent = await tx.visitPlanStatusEvent.deleteMany({
        where: { visitPlanId: { in: planIds } },
      });
      const visitPlanSlotException = await tx.visitPlanSlotException.deleteMany(
        {
          where: { visitPlanSlot: { visitPlanId: { in: planIds } } },
        },
      );
      const visitPlanSlot = await tx.visitPlanSlot.deleteMany({
        where: { visitPlanId: { in: planIds } },
      });
      const serviceUserVisitPlan = await tx.serviceUserVisitPlan.deleteMany({
        where: { serviceUserId },
      });
      return {
        scheduledJob: scheduledJob.count,
        scheduledVisit: scheduledVisit.count,
        jobAllocation: jobAllocation.count,
        visitAction: visitAction.count,
        callOffVisit: callOffVisit.count,
        scheduledJobCancellation: scheduledJobCancellation.count,
        serviceUserVisitPlan: serviceUserVisitPlan.count,
        visitPlanSlot: visitPlanSlot.count,
        visitPlanSlotException: visitPlanSlotException.count,
        visitPlanAmendment: visitPlanAmendment.count,
        visitPlanStatusEvent: visitPlanStatusEvent.count,
        pendingHoursApproval: pendingHoursApproval.count,
      } satisfies ServiceUserVisitsTableCounts;
    },
    { timeout: 120_000 },
  );
  return { counts, deleted };
}

export async function clearVisitPlansAndRota(
  prisma: PrismaClient,
  options: { dryRun: boolean },
): Promise<{ counts: VisitPlansAndRotaTableCounts; deleted?: VisitPlansAndRotaTableCounts }> {
  const counts = await countVisitPlansAndRotaRows(prisma);

  if (options.dryRun) {
    return { counts };
  }

  const deleted = await prisma.$transaction(
    async (tx) => {
      const visitAction = await tx.visitAction.deleteMany();
      const jobAllocation = await tx.jobAllocation.deleteMany();
      const callOffVisit = await tx.callOffVisit.deleteMany();
      const scheduledVisit = await tx.scheduledVisit.deleteMany();
      const scheduledJob = await tx.scheduledJob.deleteMany();
      const scheduleRun = await tx.scheduleRun.deleteMany();
      const scheduleAreaStatus = await tx.scheduleAreaStatus.deleteMany();
      const scheduleBatch = await tx.scheduleBatch.deleteMany();
      const visitPlanAmendment = await tx.visitPlanAmendment.deleteMany();
      const visitPlanSlot = await tx.visitPlanSlot.deleteMany();
      const serviceUserVisitPlan = await tx.serviceUserVisitPlan.deleteMany();

      return {
        visitAction: visitAction.count,
        jobAllocation: jobAllocation.count,
        callOffVisit: callOffVisit.count,
        scheduledVisit: scheduledVisit.count,
        scheduledJob: scheduledJob.count,
        scheduleRun: scheduleRun.count,
        scheduleAreaStatus: scheduleAreaStatus.count,
        scheduleBatch: scheduleBatch.count,
        visitPlanAmendment: visitPlanAmendment.count,
        visitPlanSlot: visitPlanSlot.count,
        serviceUserVisitPlan: serviceUserVisitPlan.count,
      } satisfies VisitPlansAndRotaTableCounts;
    },
    { timeout: 120_000 },
  );

  return { counts, deleted };
}
