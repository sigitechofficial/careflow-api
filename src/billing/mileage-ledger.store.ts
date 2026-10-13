/**
 * TR-09 / D-21: a carer's reimbursed business miles, journey by journey.
 *
 * The year-to-date total that decides which rate applies is counted from these: mileage lines of
 * visits in approved or locked pay runs, and mileage corrections that a run has paid. Each is
 * placed at the moment of the journey it belongs to, not at the date of the run that paid it.
 */
import { PayrollRunLineType, PayrollRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { operationalDayBounds } from '../common/utils/operational-day.util';
import { milesOfMileageLine } from './pay-mileage.util';

type Db = PrismaService | Prisma.TransactionClient;

export const MILEAGE_CORRECTION = 'MILEAGE_CORRECTION';

export type MileageJourney = { at: Date; miles: number; visitReconciliationId: string | null };

const COUNTED_RUNS = [PayrollRunStatus.APPROVED, PayrollRunStatus.LOCKED, PayrollRunStatus.EXPORTED];

export async function mileageJourneysInTaxYear(
  db: Db,
  input: { employeeId: string; taxYearStartKey: string; timeZone: string; excludeRunId?: string },
): Promise<MileageJourney[]> {
  const nextYearKey = `${Number(input.taxYearStartKey.slice(0, 4)) + 1}-04-06`;
  const from = operationalDayBounds(input.taxYearStartKey, input.timeZone).start;
  const to = operationalDayBounds(nextYearKey, input.timeZone).start;
  const inCountedRun = {
    employeeId: input.employeeId,
    lineType: PayrollRunLineType.MILEAGE,
    exceptionMessage: null,
    ...(input.excludeRunId ? { payrollRunId: { not: input.excludeRunId } } : {}),
    payrollRun: { status: { in: COUNTED_RUNS } },
  };
  const [visitLines, correctionLines] = await Promise.all([
    db.payrollRunLine.findMany({
      where: { ...inCountedRun, visitReconciliation: { plannedStartDateTime: { gte: from, lt: to } } },
      select: {
        quantity: true,
        description: true,
        visitReconciliationId: true,
        visitReconciliation: { select: { plannedStartDateTime: true } },
      },
    }),
    db.payrollRunLine.findMany({
      where: { ...inCountedRun, employeePayItem: { sourceType: MILEAGE_CORRECTION } },
      select: { quantity: true, employeePayItem: { select: { sourceId: true } } },
    }),
  ]);
  const correctedVisitIds = [
    ...new Set(correctionLines.map((l) => l.employeePayItem?.sourceId).filter((v): v is string => !!v)),
  ];
  const correctedVisits = correctedVisitIds.length
    ? await db.visitReconciliation.findMany({
        where: { id: { in: correctedVisitIds }, plannedStartDateTime: { gte: from, lt: to } },
        select: { id: true, plannedStartDateTime: true },
      })
    : [];
  const startOf = new Map(correctedVisits.map((v) => [v.id, v.plannedStartDateTime]));
  return [
    ...visitLines.map((line) => ({
      at: line.visitReconciliation!.plannedStartDateTime,
      miles: milesOfMileageLine(line),
      visitReconciliationId: line.visitReconciliationId,
    })),
    // A correction belongs to the journey it corrects (and to that journey's tax year).
    ...correctionLines.flatMap((line) => {
      const visitId = line.employeePayItem?.sourceId ?? null;
      const at = visitId ? startOf.get(visitId) : undefined;
      return at ? [{ at, miles: Number(line.quantity ?? 0), visitReconciliationId: visitId }] : [];
    }),
  ];
}
