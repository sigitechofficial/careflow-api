/**
 * Clear all billing finance records (reconciliations, runs, payments).
 * Optionally reset completed schedule jobs/visits so they can be re-completed.
 *
 * Usage: npx ts-node --transpile-only prisma/scripts/clear-billing-finance-data.ts
 */
import { PrismaClient, ScheduledJobStatus, ScheduledVisitStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const counts = {
    paymentAllocations: await prisma.paymentAllocation.count(),
    payments: await prisma.payment.count(),
    payrollRunLines: await prisma.payrollRunLine.count(),
    payrollRuns: await prisma.payrollRun.count(),
    invoiceRunLines: await prisma.invoiceRunLine.count(),
    invoiceRuns: await prisma.invoiceRun.count(),
    financeExceptions: await prisma.financeException.count(),
    visitReconciliations: await prisma.visitReconciliation.count(),
  };

  console.log('Before clear:', counts);

  const result = await prisma.$transaction(async (tx) => {
    const paymentAllocations = await tx.paymentAllocation.deleteMany();
    const payments = await tx.payment.deleteMany();
    const payrollRunLines = await tx.payrollRunLine.deleteMany();
    const invoiceRunLines = await tx.invoiceRunLine.deleteMany();
    const financeExceptions = await tx.financeException.deleteMany();
    const visitReconciliations = await tx.visitReconciliation.deleteMany();
    const payrollRuns = await tx.payrollRun.deleteMany();
    const invoiceRuns = await tx.invoiceRun.deleteMany();

    const completedJobs = await tx.scheduledJob.updateMany({
      where: {
        deletedAt: null,
        status: { in: [ScheduledJobStatus.COMPLETED, ScheduledJobStatus.PARTIALLY_COMPLETED] },
      },
      data: { status: ScheduledJobStatus.ALLOCATED },
    });

    const completedVisits = await tx.scheduledVisit.updateMany({
      where: {
        deletedAt: null,
        status: {
          in: [ScheduledVisitStatus.COMPLETED, ScheduledVisitStatus.PARTIALLY_COMPLETED],
        },
      },
      data: {
        status: ScheduledVisitStatus.PLANNED,
        actualStartDateTime: null,
        actualEndDateTime: null,
      },
    });

    return {
      paymentAllocations: paymentAllocations.count,
      payments: payments.count,
      payrollRunLines: payrollRunLines.count,
      invoiceRunLines: invoiceRunLines.count,
      financeExceptions: financeExceptions.count,
      visitReconciliations: visitReconciliations.count,
      payrollRuns: payrollRuns.count,
      invoiceRuns: invoiceRuns.count,
      resetJobs: completedJobs.count,
      resetVisits: completedVisits.count,
    };
  });

  console.log('Deleted / reset:', result);
  console.log('Done — billing finance data cleared.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
