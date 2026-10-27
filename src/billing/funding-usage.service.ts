import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import {
  dayKeyInTimeZone,
  operationalDayBounds,
  operationalTodayIso,
} from '../common/utils/operational-day.util';
import { FundingUsageQueryDto } from './dto/funding-usage.dto';
import { fundingBudgetForPeriod, fundingUsagePeriodDays, summariseFundingUsage } from './funding-usage.util';

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v));

/** What a service user's visits cost in carer pay and charge in a week or month, against their funding budget. */
@Injectable()
export class FundingUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  async forServiceUser(serviceUserId: string, query: FundingUsageQueryDto) {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const period = query.period ?? 'month';
    const { from, to, days } = fundingUsagePeriodDays(period, query.date ?? operationalTodayIso(new Date(), timeZone));

    const [rows, fundingLines] = await Promise.all([
      this.prisma.visitReconciliation.findMany({
        where: {
          serviceUserId,
          plannedStartDateTime: {
            gte: operationalDayBounds(from, timeZone).start,
            lte: operationalDayBounds(to, timeZone).end,
          },
        },
        select: {
          scheduledVisitId: true,
          status: true,
          payableAmount: true,
          billableAmount: true,
          billableMinutes: true,
          includedInPayrollRunId: true,
          paidByUkPayrollRunId: true,
          includedInInvoiceRunId: true,
        },
      }),
      this.prisma.serviceUserFunding.findMany({
        where: { serviceUserId, deletedAt: null, isActive: true },
        select: {
          startDate: true,
          endDate: true,
          weeklyBudget: true,
          hourlyRate: true,
          authorisedWeeklyHours: true,
          funder: { select: { name: true } },
          fundingType: { select: { name: true } },
        },
        orderBy: [{ splitPriority: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const usage = summariseFundingUsage(
      rows.map(r => ({
        scheduledVisitId: r.scheduledVisitId,
        status: r.status,
        payableAmount: num(r.payableAmount),
        billableAmount: num(r.billableAmount),
        billableMinutes: r.billableMinutes,
        paySettled: Boolean(r.includedInPayrollRunId || r.paidByUkPayrollRunId),
        invoiced: Boolean(r.includedInInvoiceRunId),
      })),
    );
    const budget = fundingBudgetForPeriod(
      fundingLines.map(l => ({
        funderName: l.funder?.name ?? null,
        fundingTypeName: l.fundingType?.name ?? null,
        startDate: l.startDate ? dayKeyInTimeZone(l.startDate, timeZone) : null,
        endDate: l.endDate ? dayKeyInTimeZone(l.endDate, timeZone) : null,
        weeklyBudget: num(l.weeklyBudget),
        hourlyRate: num(l.hourlyRate),
        authorisedWeeklyHours: l.authorisedWeeklyHours,
      })),
      from,
      to,
    );

    return {
      data: {
        period: { kind: period, from, to, days },
        ...usage,
        budget: {
          amount: budget.amount,
          remaining: budget.amount != null ? round2(budget.amount - usage.clientCharge.total) : null,
          hours: budget.hours,
          hoursRemaining: budget.hours != null ? round2(budget.hours - usage.billableHours) : null,
          lines: budget.lines,
        },
      },
    };
  }
}
