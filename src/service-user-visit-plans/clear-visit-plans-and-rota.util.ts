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
