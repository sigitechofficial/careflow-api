import { Prisma } from '@prisma/client';

const EXPENSE_LINE_TYPES = new Set([
  'MILEAGE',
  'PASSENGER_MILEAGE',
  'EXPENSE',
]);

export function isExpenseLineType(lineType: string): boolean {
  return EXPENSE_LINE_TYPES.has(lineType);
}

export function calendarDaysInclusive(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

/** Prorate annual salary across calendar days in the pay period. */
export function prorateAnnualSalary(
  annualSalary: number,
  periodStart: Date,
  periodEnd: Date,
): number {
  const days = calendarDaysInclusive(periodStart, periodEnd);
  const raw = (annualSalary * days) / 365.25;
  return Math.round(raw * 100) / 100;
}

export type GrossBucket = {
  visitPay: number;
  salaryPay: number;
  travelPay: number;
  nmwTopUp: number;
  otherPay: number;
  expenseTotal: number;
  deductionTotal: number;
  totalGross: number;
};

export function emptyGrossBucket(): GrossBucket {
  return {
    visitPay: 0,
    salaryPay: 0,
    travelPay: 0,
    nmwTopUp: 0,
    otherPay: 0,
    expenseTotal: 0,
    deductionTotal: 0,
    totalGross: 0,
  };
}

export function accumulateGrossLine(
  bucket: GrossBucket,
  line: { lineType: string; amount: number; isExpense: boolean },
): void {
  const amount = line.amount;
  if (line.isExpense || isExpenseLineType(line.lineType)) {
    bucket.expenseTotal = round2(bucket.expenseTotal + amount);
    return;
  }
  if (
    line.lineType === 'SALARY' ||
    line.lineType === 'PAY_AGREEMENT_SALARY' ||
    // Backpay, or a recovery when the salary of a paid period was reduced: it stays with salary.
    line.lineType === 'SALARY_ADJUSTMENT'
  ) {
    bucket.salaryPay = round2(bucket.salaryPay + amount);
  } else if (line.lineType === 'VISIT_PAY') {
    bucket.visitPay = round2(bucket.visitPay + amount);
  } else if (line.lineType === 'TRAVEL_TIME' || line.lineType === 'WAITING_TIME') {
    bucket.travelPay = round2(bucket.travelPay + amount);
  } else if (line.lineType === 'NMW_TOP_UP') {
    bucket.nmwTopUp = round2(bucket.nmwTopUp + amount);
  } else if (line.lineType === 'SALARY_DEDUCTION' || amount < 0) {
    bucket.deductionTotal = round2(bucket.deductionTotal + Math.abs(amount));
  } else {
    bucket.otherPay = round2(bucket.otherPay + amount);
  }
}

export function finalizeGrossBucket(bucket: GrossBucket): GrossBucket {
  bucket.totalGross = round2(
    bucket.visitPay +
      bucket.salaryPay +
      bucket.travelPay +
      bucket.nmwTopUp +
      bucket.otherPay -
      bucket.deductionTotal,
  );
  return bucket;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(round2(n).toFixed(2));
}

export function salaryMonthKeysForPeriod(periodStart: Date, periodEnd: Date): string[] {
  const keys = new Set<string>();
  const cursor = new Date(
    Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), 1),
  );
  const endMonth = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  while (cursor.getTime() <= endMonth.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    keys.add(`${y}-${m}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return [...keys];
}
