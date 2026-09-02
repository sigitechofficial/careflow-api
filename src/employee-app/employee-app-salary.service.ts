import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollRunsService } from '../billing/payroll-runs.service';
import {
  formatUkDateLabel,
  formatUkDateRangeLabel,
  formatUkMonthLabelFromKey,
} from '../common/utils/uk-date-label.util';

export type SalaryCalculationBasis = 'MONTHLY' | 'WEEKLY';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isoWeekPeriodKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

function currentUtcMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
}

function currentUtcWeek(): string {
  return isoWeekPeriodKey(new Date());
}

/** Monday UTC of the given ISO week key YYYY-Www. */
function mondayOfIsoWeek(period: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!match) return new Date(NaN);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday;
}

function monthDateRange(month: string): { dateFrom: string; dateTo: string } {
  const [yRaw, mRaw] = month.split('-');
  const y = Number(yRaw);
  const m = Number(mRaw);
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    return { dateFrom: month, dateTo: month };
  }
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return {
    dateFrom: from.toISOString().slice(0, 10),
    dateTo: to.toISOString().slice(0, 10),
  };
}

function weekDateRange(period: string): { dateFrom: string; dateTo: string } {
  const monday = mondayOfIsoWeek(period);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    dateFrom: monday.toISOString().slice(0, 10),
    dateTo: sunday.toISOString().slice(0, 10),
  };
}

function utcMonthLabel(month: string): string {
  return formatUkMonthLabelFromKey(month) ?? month;
}

function utcWeekLabel(period: string): string {
  const monday = mondayOfIsoWeek(period);
  if (Number.isNaN(monday.getTime())) return period;
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return `Week ${period.slice(6)} · ${formatUkDateLabel(monday)} – ${formatUkDateLabel(sunday)}`;
}

@Injectable()
export class EmployeeAppSalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollRuns: PayrollRunsService,
  ) {}

  async getMySalary(
    employeeId: string,
    query: {
      period?: string;
      month?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    const settings = await this.prisma.organisationGeneralSettings.findFirst({
      select: { salaryCalculationBasis: true },
    });
    const basis: SalaryCalculationBasis =
      settings?.salaryCalculationBasis === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY';

    const resolved = this.resolvePeriod(basis, query);
    const earnings = await this.payrollRuns.getEmployeeEarnings(employeeId, {
      dateFrom: resolved.dateFrom,
      dateTo: resolved.dateTo,
    });

    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, deletedAt: null },
      select: {
        defaultPayCardId: true,
        defaultPayCard: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            currency: true,
          },
        },
      },
    });

    const payCard = employment?.defaultPayCard
      ? {
          id: employment.defaultPayCard.id,
          name: employment.defaultPayCard.name,
          code: employment.defaultPayCard.code,
          status: employment.defaultPayCard.status,
          currency: employment.defaultPayCard.currency,
        }
      : null;

    const d = earnings.data;

    return {
      data: {
        employeeId,
        basis,
        period: resolved.period,
        periodLabel: resolved.periodLabel,
        dateFrom: resolved.dateFrom,
        dateTo: resolved.dateTo,
        currency: d.currency,
        generatedAt: new Date().toISOString(),
        payCard,
        summary: {
          salaryAmount: d.salaryAmount,
          salaryAmountValue: d.salaryAmountValue,
          salaryVisitCount: d.salaryVisitCount,
          netSalaryAmount: d.netSalaryAmount,
          netSalaryAmountValue: d.netSalaryAmountValue,
          fineTotal: d.fineTotal,
          fineTotalValue: d.fineTotalValue,
          penaltyTotal: d.penaltyTotal,
          penaltyTotalValue: d.penaltyTotalValue,
          deductionsTotal: d.deductionsTotal,
          deductionsTotalValue: d.deductionsTotalValue,
          totalEarned: d.totalEarned,
          totalEarnedAmount: d.totalEarnedAmount,
          paidVisitCount: d.paidVisitCount,
          remainingVisitCount: d.remainingVisitCount,
          remainingAmount: d.remainingAmount,
          remainingAmountValue: d.remainingAmountValue,
          pendingReviewCount: d.pendingReviewCount,
        },
        deductions: d.deductions,
        visits: d.visits,
      },
    };
  }

  private resolvePeriod(
    basis: SalaryCalculationBasis,
    query: {
      period?: string;
      month?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ): { period: string; periodLabel: string; dateFrom: string; dateTo: string } {
    const dateFrom = query.dateFrom?.trim();
    const dateTo = query.dateTo?.trim();
    if (dateFrom || dateTo) {
      if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
        throw new BadRequestException('Provide both dateFrom and dateTo, or neither');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom!) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo!)) {
        throw new BadRequestException('dateFrom and dateTo must be YYYY-MM-DD');
      }
      if (dateFrom! > dateTo!) {
        throw new BadRequestException('dateFrom must be on or before dateTo');
      }
      return {
        period: `${dateFrom}_${dateTo}`,
        periodLabel: formatUkDateRangeLabel(dateFrom!, dateTo!),
        dateFrom: dateFrom!,
        dateTo: dateTo!,
      };
    }

    const raw = (query.period ?? query.month)?.trim();
    if (raw) {
      if (/^\d{4}-\d{2}$/.test(raw)) {
        const range = monthDateRange(raw);
        return {
          period: raw,
          periodLabel: utcMonthLabel(raw),
          ...range,
        };
      }
      if (/^\d{4}-W\d{2}$/.test(raw)) {
        const monday = mondayOfIsoWeek(raw);
        if (Number.isNaN(monday.getTime())) {
          throw new BadRequestException('period week is invalid');
        }
        const range = weekDateRange(raw);
        return {
          period: raw,
          periodLabel: utcWeekLabel(raw),
          ...range,
        };
      }
      throw new BadRequestException(
        'period must be YYYY-MM (month) or YYYY-Www (ISO week), or use dateFrom/dateTo',
      );
    }

    if (basis === 'WEEKLY') {
      const period = currentUtcWeek();
      return {
        period,
        periodLabel: utcWeekLabel(period),
        ...weekDateRange(period),
      };
    }

    const period = currentUtcMonth();
    return {
      period,
      periodLabel: utcMonthLabel(period),
      ...monthDateRange(period),
    };
  }
}
