import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollRunLineType,
  PayrollRunStatus,
  Prisma,
  SalaryDeductionType,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { EmployeePayoutsService } from './employee-payouts.service';
import {
  CreateBillingRunDto,
  CreateEmployeeSalaryDeductionDto,
  EmployeeEarningsQueryDto,
  BillingRunsQueryDto,
} from './dto/billing-runs.dto';
import {
  endOfBillingDate,
  formatMoney,
  formatPeriodLabel,
  parseBillingDateOnly,
} from './billing-run.util';
import {
  calculateMileageAmount,
  calculateTravelTimeAmount,
  calculateWaitingTimeAmount,
  formatMinutesAsHours,
  formatTimeRange,
} from './visit-reconciliation.util';
import { formatHmInTimeZone, operationalDayBounds } from '../common/utils/operational-day.util';
import { calculateUkMileage } from './pay-mileage.util';
import {
  detectInterVisitTravel,
  summariseTravelForDestination,
} from './pay-inter-visit-travel.util';
import {
  estimateEmployerCost,
  resolveNmwCategory,
  validateMinimumWage,
  ageInFullYears,
  type NmwPayComponent,
} from './pay-compliance.util';
import {
  derivePeriodKeyFromRange,
} from './employee-payout-period.util';
import {
  buildPayrollRunVisitLogCsv,
  formatPayAmount,
  formatTimeHhMmSs,
  formatTimeHhMmSsOrZero,
  formatVisitDateMmDdYy,
  minutesToDecimalHours,
  payrollRunExportFilename,
  resolveCareTypeExportCode,
  resolveCarerAddress,
  resolveCarerId,
  resolveEmonitored,
  type PayrollVisitExportRow,
} from './payroll-run-export-csv.util';
import { serviceUserIdsForLocation } from './billing-location-scope.util';

const MUTABLE_STATUSES: PayrollRunStatus[] = [
  PayrollRunStatus.DRAFT,
  PayrollRunStatus.EXCEPTION_FOUND,
  PayrollRunStatus.READY_FOR_REVIEW,
];

const PAYROLL_ELIGIBLE_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_PAY,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
];

/** Visits that may still be pending review but already have a calculated payable amount. */
const PRICED_PENDING_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.PENDING_REVIEW,
  VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
];

function earningsRemainingWhere(
  base: Prisma.VisitReconciliationWhereInput,
): Prisma.VisitReconciliationWhereInput {
  return {
    ...base,
    includedInPayrollRunId: null,
    OR: [
      { status: { in: PAYROLL_ELIGIBLE_RECON } },
      {
        status: { in: PRICED_PENDING_RECON },
        payableAmount: { not: null },
      },
    ],
  };
}

function isEarningsRemainingStatus(
  status: VisitReconciliationStatus,
  payableAmount: unknown,
): boolean {
  if (
    status === VisitReconciliationStatus.APPROVED_FOR_PAY ||
    status === VisitReconciliationStatus.APPROVED_FOR_BOTH ||
    status === VisitReconciliationStatus.LOCKED
  ) {
    return true;
  }
  return (
    (status === VisitReconciliationStatus.PENDING_REVIEW ||
      status === VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL) &&
    payableAmount != null
  );
}

/** Period keys (YYYY-MM or YYYY-Www) covered by an earnings date filter; null = all. */
function salaryMonthsForEarningsQuery(dateFrom?: string, dateTo?: string): string[] | null {
  if (!dateFrom && !dateTo) return null;
  const fromStr = (dateFrom ?? dateTo)!;
  const toStr = (dateTo ?? dateFrom)!;
  const from = parseUtcDateOnly(fromStr);
  const to = parseUtcDateOnly(toStr);
  if (from && to) {
    const daySpan = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    const weekFrom = isoWeekPeriodKey(from);
    const weekTo = isoWeekPeriodKey(to);
    if (daySpan >= 0 && daySpan <= 6 && weekFrom === weekTo) {
      return [weekFrom];
    }
  }
  const start = fromStr.slice(0, 7);
  const end = toStr.slice(0, 7);
  if (start === end) return [start];
  const months: string[] = [];
  let [y, m] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (months.length > 36) break;
  }
  return months;
}

function parseUtcDateOnly(isoDate: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO week period key YYYY-Www (UTC, week starts Monday). */
function isoWeekPeriodKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday in current week decides the year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export type PayrollRunRow = {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollRunStatus;
  carers: number;
  visitLines: number;
  grossPay: string;
  nmwTopUp: string;
  exceptions: number;
};

@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeePayouts: EmployeePayoutsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  /**
   * Convert YYYY-MM-DD salary/earnings filters into UTC instants for the
   * organisation operational timezone (not raw Z midnight).
   */
  private async operationalVisitDateFilter(
    dateFrom?: string,
    dateTo?: string,
  ): Promise<Prisma.DateTimeFilter | undefined> {
    if (!dateFrom && !dateTo) return undefined;
    const timeZone = await this.orgSettings.getOperationalTimezone();
    const out: Prisma.DateTimeFilter = {};
    if (dateFrom) {
      out.gte = operationalDayBounds(dateFrom.slice(0, 10), timeZone).start;
    }
    if (dateTo) {
      out.lte = operationalDayBounds(dateTo.slice(0, 10), timeZone).end;
    }
    return out;
  }

  async list(query?: BillingRunsQueryDto) {
    const where: Prisma.PayrollRunWhereInput = {};
    if (query?.locationId) {
      const suIds = await serviceUserIdsForLocation(this.prisma, query.locationId);
      where.OR = [
        { lines: { none: {} } },
        ...(suIds.length
          ? [
              {
                lines: {
                  some: {
                    visitReconciliation: { serviceUserId: { in: suIds } },
                  },
                },
              },
            ]
          : []),
      ];
    }
    const rows = await this.prisma.payrollRun.findMany({
      where,
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    return { data: rows.map((r) => this.mapRow(r)) };
  }

  async getSummary(locationId?: string) {
    const where: Prisma.PayrollRunWhereInput = {
      status: {
        in: [
          PayrollRunStatus.DRAFT,
          PayrollRunStatus.CALCULATING,
          PayrollRunStatus.EXCEPTION_FOUND,
          PayrollRunStatus.READY_FOR_REVIEW,
        ],
      },
    };
    if (locationId) {
      const suIds = await serviceUserIdsForLocation(this.prisma, locationId);
      where.OR = [
        { lines: { none: {} } },
        ...(suIds.length
          ? [
              {
                lines: {
                  some: {
                    visitReconciliation: { serviceUserId: { in: suIds } },
                  },
                },
              },
            ]
          : []),
      ];
    }
    const drafts = await this.prisma.payrollRun.count({ where });
    return { data: { payrollDrafts: drafts } };
  }

  async getById(id: string) {
    const row = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: [{ visitRef: 'asc' }],
          take: 500,
          include: {
            visitReconciliation: {
              select: {
                serviceUserId: true,
                approvedPayStart: true,
                approvedPayEnd: true,
                payableMinutes: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Payroll run not found');

    const employeeIds = [
      ...new Set(row.lines.map((l) => l.employeeId).filter(Boolean)),
    ] as string[];
    const serviceUserIds = [
      ...new Set(
        row.lines
          .map((l) => l.visitReconciliation?.serviceUserId)
          .filter(Boolean),
      ),
    ] as string[];

    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
            },
          })
        : [],
      serviceUserIds.length
        ? this.prisma.serviceUser.findMany({
            where: { id: { in: serviceUserIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              preferredName: true,
            },
          })
        : [],
    ]);

    const empMap = new Map(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName]
          .filter(Boolean)
          .join(' ') || 'Unknown carer',
      ]),
    );
    const suMap = new Map(
      serviceUsers.map((su) => [
        su.id,
        su.preferredName?.trim() ||
          `${su.firstName} ${su.lastName}`.trim() ||
          'Unknown',
      ]),
    );

    const lines = row.lines.map((l) => {
      const recon = l.visitReconciliation;
      const amount = Number(l.amount);
      const lineType = l.lineType;
      const isVisitPay = lineType === PayrollRunLineType.VISIT_PAY;
      const minutes = isVisitPay
        ? (l.minutes ?? recon?.payableMinutes ?? 0)
        : (l.minutes ?? 0);
      const hoursLabel = minutes > 0 ? formatMinutesAsHours(minutes) : null;
      const payableTime =
        isVisitPay && recon?.approvedPayStart && recon?.approvedPayEnd
          ? formatTimeRange(recon.approvedPayStart, recon.approvedPayEnd)
          : lineType === PayrollRunLineType.MILEAGE
            ? 'Mileage'
            : lineType === PayrollRunLineType.TRAVEL_TIME
              ? 'Travel time'
              : '—';

      let unitRate: string | null = null;
      let formula: string | null = null;
      const storedUnit = l.unitAmount != null ? Number(l.unitAmount) : null;

      if (lineType === PayrollRunLineType.MILEAGE && storedUnit != null && storedUnit > 0 && amount > 0) {
        const miles = Math.round((amount / storedUnit) * 100) / 100;
        unitRate = `${formatMoney(storedUnit)}/mile`;
        formula = `${miles.toFixed(2)} mi × ${formatMoney(storedUnit)}/mile = ${formatMoney(amount)}`;
        return {
          id: l.id,
          lineType,
          visitRef: l.visitRef,
          employeeId: l.employeeId,
          carerName: l.employeeId ? (empMap.get(l.employeeId) ?? 'Unknown carer') : '—',
          serviceUserName: recon?.serviceUserId
            ? (suMap.get(recon.serviceUserId) ?? 'Unknown')
            : '—',
          payableTime: 'Mileage',
          hoursLabel: `${miles.toFixed(2)} mi`,
          minutes: 0,
          unitRate,
          formula,
          amount: formatMoney(amount),
          description: l.description,
          exceptionMessage: l.exceptionMessage,
        };
      }

      if (lineType === PayrollRunLineType.TRAVEL_TIME && storedUnit != null && minutes > 0) {
        unitRate = `${formatMoney(storedUnit)}/hr`;
        formula = `${hoursLabel} × ${formatMoney(storedUnit)}/hr = ${formatMoney(amount)}`;
      } else if (isVisitPay && minutes > 0 && amount > 0) {
        const hourly = amount / (minutes / 60);
        unitRate = `${formatMoney(hourly)}/hr`;
        formula = `${hoursLabel} × ${formatMoney(hourly)}/hr = ${formatMoney(amount)}`;
      } else if (amount > 0) {
        formula = formatMoney(amount);
      }

      return {
        id: l.id,
        lineType,
        visitRef: l.visitRef,
        employeeId: l.employeeId,
        carerName: l.employeeId ? (empMap.get(l.employeeId) ?? 'Unknown carer') : '—',
        serviceUserName: recon?.serviceUserId
          ? (suMap.get(recon.serviceUserId) ?? 'Unknown')
          : '—',
        payableTime,
        hoursLabel: isVisitPay || lineType === PayrollRunLineType.TRAVEL_TIME ? hoursLabel : null,
        minutes: isVisitPay || lineType === PayrollRunLineType.TRAVEL_TIME ? minutes : 0,
        unitRate,
        formula,
        amount: formatMoney(amount),
        description: l.description,
        exceptionMessage: l.exceptionMessage,
      };
    });

    const carerTotals = new Map<
      string,
      { name: string; minutes: number; amount: number; visits: Set<string> }
    >();
    for (const l of row.lines) {
      if (!l.employeeId) continue;
      const amount = Number(l.amount);
      const name = empMap.get(l.employeeId) ?? 'Unknown carer';
      const existing = carerTotals.get(l.employeeId) ?? {
        name,
        minutes: 0,
        amount: 0,
        visits: new Set<string>(),
      };
      existing.amount += amount;
      if (l.lineType === PayrollRunLineType.VISIT_PAY) {
        const minutes = l.minutes ?? l.visitReconciliation?.payableMinutes ?? 0;
        existing.minutes += minutes;
        if (l.visitRef) existing.visits.add(l.visitRef);
        else existing.visits.add(l.id);
      }
      carerTotals.set(l.employeeId, existing);
    }

    const carerSummaries = [...carerTotals.entries()]
      .map(([employeeId, totals]) => ({
        employeeId,
        carerName: totals.name,
        visitCount: totals.visits.size,
        totalMinutes: totals.minutes,
        totalHours: formatMinutesAsHours(totals.minutes),
        grossPay: formatMoney(totals.amount),
      }))
      .sort((a, b) => a.carerName.localeCompare(b.carerName));

    const visitLineCount = row.lines.filter(
      (l) => l.lineType === PayrollRunLineType.VISIT_PAY,
    ).length;

    return {
      data: {
        ...this.mapRow({ ...row, visitLineCount }),
        notes: row.notes,
        carerSummaries,
        lines,
      },
    };
  }

  async create(userId: string, dto: CreateBillingRunDto) {
    const periodStart = parseBillingDateOnly(dto.periodStart);
    const periodEnd = parseBillingDateOnly(dto.periodEnd);
    if (periodEnd < periodStart) {
      throw new BadRequestException('Period end must be on or after period start');
    }

    const created = await this.prisma.payrollRun.create({
      data: {
        periodLabel: formatPeriodLabel(periodEnd),
        periodStart,
        periodEnd,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      },
    });
    return { message: 'Payroll run created', data: this.mapRow(created) };
  }

  async calculate(id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!MUTABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException(`Cannot recalculate payroll run in status ${run.status}`);
    }

    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.CALCULATING },
    });

    const periodEnd = endOfBillingDate(run.periodEnd);
    const reconciliations = await this.prisma.visitReconciliation.findMany({
      where: {
        status: { in: PAYROLL_ELIGIBLE_RECON },
        includedInPayrollRunId: null,
        approvedPayStart: { gte: run.periodStart, lte: periodEnd },
      },
      orderBy: { approvedPayStart: 'asc' },
    });

    // Auto inter-visit travel (HMRC: travel between assignments is NMW working time).
    const autoJourneys = detectInterVisitTravel(
      reconciliations
        .filter((r) => r.employeeId && r.approvedPayStart && r.approvedPayEnd)
        .map((r) => ({
          reconciliationId: r.id,
          employeeId: r.employeeId!,
          visitRef: r.visitRef,
          payStart: r.approvedPayStart!,
          payEnd: r.approvedPayEnd!,
          manualTravelMinutes: r.travelMinutes,
          manualUnpaidTravelMinutes:
            (r as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? null,
          serviceUserId: r.serviceUserId,
        })),
    );
    const autoByDestination = new Map(
      [...new Set(autoJourneys.map((j) => j.toReconciliationId))].map((id) => [
        id,
        summariseTravelForDestination(autoJourneys, id),
      ]),
    );

    const lineData: Prisma.PayrollRunLineCreateManyInput[] = [];
    let exceptionCount = 0;
    const employeeIds = new Set<string>();
    /** Auto unpaid NMW travel minutes not covered by paid TRAVEL_TIME / WAITING_TIME lines. */
    const autoUnpaidNmwByEmployee = new Map<string, number>();

    for (const recon of reconciliations) {
      const issues: string[] = [];
      if (!recon.employeeId) issues.push('No carer assigned');
      if (recon.payableAmount == null) issues.push('Payable amount not calculated');
      if (!recon.approvedPayStart || !recon.approvedPayEnd) {
        issues.push('Approved payable time missing');
      }

      const amount = recon.payableAmount != null ? Number(recon.payableAmount) : 0;
      if (issues.length) exceptionCount += 1;

      if (recon.employeeId) employeeIds.add(recon.employeeId);

      lineData.push({
        payrollRunId: id,
        visitReconciliationId: recon.id,
        employeeId: recon.employeeId,
        lineType: PayrollRunLineType.VISIT_PAY,
        description: `Visit pay — ${recon.visitRef}`,
        minutes: recon.payableMinutes,
        amount: issues.length ? 0 : amount,
        payCardId: recon.payCardId,
        visitRef: recon.visitRef,
        exceptionMessage: issues.length ? issues.join('; ') : null,
      });

      const auto = autoByDestination.get(recon.id);
      if (auto?.requiresManagerReview && recon.employeeId && !issues.length) {
        exceptionCount += 1;
      }

      // Mileage / travel / waiting supplements.
      if (recon.payCardId && recon.employeeId && !issues.length) {
        const payCard = await this.prisma.payCard.findUnique({
          where: { id: recon.payCardId },
          select: {
            mileageVehicleType: true,
            useUkMileageRates: true,
            version: true,
          },
        });
        const payRules = await this.prisma.payCardRule.findMany({
          where: { payCardId: recon.payCardId },
        });
        const visitDate = recon.plannedStartDateTime;
        const miles = recon.travelMiles != null ? Number(recon.travelMiles) : 0;
        const manualTravelMins = recon.travelMinutes ?? 0;
        const autoTravelMins = auto?.payableTravelMinutes ?? 0;
        const autoWaitingMins = auto?.payableWaitingMinutes ?? 0;
        // Prefer explicit manual minutes; otherwise use auto inter-visit detection.
        const travelMins = manualTravelMins > 0 ? manualTravelMins : autoTravelMins;
        const waitingMins = manualTravelMins > 0 ? 0 : autoWaitingMins;
        const passengerMiles =
          (recon as { passengerMiles?: unknown }).passengerMiles != null
            ? Number((recon as { passengerMiles?: unknown }).passengerMiles)
            : 0;

        const taxYearStart = new Date(
          Date.UTC(
            visitDate.getUTCMonth() >= 3 ? visitDate.getUTCFullYear() : visitDate.getUTCFullYear() - 1,
            3,
            6,
          ),
        );
        const priorMileage = await this.prisma.payrollRunLine.aggregate({
          where: {
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.MILEAGE,
            payrollRun: {
              status: {
                in: [PayrollRunStatus.APPROVED, PayrollRunStatus.LOCKED, PayrollRunStatus.EXPORTED],
              },
              periodEnd: { gte: taxYearStart, lt: run.periodStart },
            },
          },
          _sum: { amount: true },
        });
        const cardMileageRate = calculateMileageAmount(payRules, visitDate, 1)?.unitRate ?? 0.55;
        const priorAmount = Number(priorMileage._sum.amount ?? 0);
        const ytdBusinessMiles =
          cardMileageRate > 0 ? Math.max(0, priorAmount / cardMileageRate) : 0;

        const cardMileage = calculateMileageAmount(payRules, visitDate, miles);
        const ukMileage =
          miles > 0
            ? calculateUkMileage({
                miles,
                vehicleType: (payCard?.mileageVehicleType as 'CAR_VAN') ?? 'CAR_VAN',
                cardRatePerMile: cardMileage?.unitRate ?? null,
                useUkApprovedRates: payCard?.useUkMileageRates ?? true,
                ytdBusinessMiles,
                passengerMiles,
              })
            : null;

        if (ukMileage) {
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.MILEAGE,
            description: `Mileage — ${recon.visitRef} (${miles.toFixed(2)} mi)`,
            minutes: null,
            unitAmount: ukMileage.unitRate,
            amount: ukMileage.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
          if (ukMileage.passengerAmount > 0) {
            lineData.push({
              payrollRunId: id,
              visitReconciliationId: recon.id,
              employeeId: recon.employeeId,
              lineType: 'PASSENGER_MILEAGE' as PayrollRunLineType,
              description: `Passenger mileage — ${recon.visitRef}`,
              minutes: null,
              unitAmount: 0.05,
              amount: ukMileage.passengerAmount,
              payCardId: recon.payCardId,
              visitRef: recon.visitRef,
              exceptionMessage: null,
            });
          }
        } else if (cardMileage) {
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.MILEAGE,
            description: `Mileage — ${recon.visitRef} (${miles.toFixed(2)} mi)`,
            minutes: null,
            unitAmount: cardMileage.unitRate,
            amount: cardMileage.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        }

        let paidTravelMins = 0;
        const travel = calculateTravelTimeAmount(payRules, visitDate, travelMins);
        if (travel) {
          paidTravelMins = travelMins;
          const autoNote =
            manualTravelMins <= 0 && autoTravelMins > 0
              ? ` [auto inter-visit: ${(auto?.explanations ?? []).join('; ')}]`
              : '';
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.TRAVEL_TIME,
            description: `Travel time — ${recon.visitRef} (${travelMins} min)${autoNote}`,
            minutes: travelMins,
            unitAmount: travel.unitRate,
            amount: travel.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        }

        let paidWaitingMins = 0;
        const waiting = calculateWaitingTimeAmount(payRules, visitDate, waitingMins);
        if (waiting) {
          paidWaitingMins = waitingMins;
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: 'WAITING_TIME' as PayrollRunLineType,
            description: `Waiting time — ${recon.visitRef} (${waitingMins} min) [auto inter-visit]`,
            minutes: waitingMins,
            unitAmount: waiting.unitRate,
            amount: waiting.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        }

        // NMW: remaining auto travel/wait hours that were not paid as wages still count as hours.
        const manualUnpaid =
          (recon as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? 0;
        const autoNmw = auto?.nmwMinutes ?? 0;
        const unpaidForNmw = Math.max(
          manualUnpaid,
          Math.max(0, autoNmw - paidTravelMins - paidWaitingMins),
        );
        if (unpaidForNmw > 0) {
          autoUnpaidNmwByEmployee.set(
            recon.employeeId,
            (autoUnpaidNmwByEmployee.get(recon.employeeId) ?? 0) + unpaidForNmw,
          );
        }
      } else if (recon.employeeId && !issues.length) {
        // No pay card — still surface auto travel as unpaid NMW hours.
        const auto = autoByDestination.get(recon.id);
        const unpaid =
          Math.max(
            (recon as { unpaidTravelMinutes?: number | null }).unpaidTravelMinutes ?? 0,
            auto?.nmwMinutes ?? 0,
          );
        if (unpaid > 0) {
          autoUnpaidNmwByEmployee.set(
            recon.employeeId,
            (autoUnpaidNmwByEmployee.get(recon.employeeId) ?? 0) + unpaid,
          );
        }
      }
    }

    // Pay-reference-period NMW validation per worker (DOB-derived age; unpaid travel hours included).
    const nmwByEmployee = new Map<string, NmwPayComponent[]>();
    for (const line of lineData) {
      if (!line.employeeId) continue;
      const isExpense =
        line.lineType === PayrollRunLineType.MILEAGE ||
        line.lineType === ('PASSENGER_MILEAGE' as PayrollRunLineType) ||
        line.lineType === ('EXPENSE' as PayrollRunLineType);
      const list = nmwByEmployee.get(line.employeeId) ?? [];
      list.push({
        amount: Number(line.amount),
        includesInNmwPay: !isExpense && line.lineType !== PayrollRunLineType.NMW_TOP_UP,
        countsAsNmwHours:
          line.lineType === PayrollRunLineType.VISIT_PAY ||
          line.lineType === PayrollRunLineType.TRAVEL_TIME ||
          line.lineType === ('WAITING_TIME' as PayrollRunLineType),
        hours: line.minutes != null ? line.minutes / 60 : 0,
      });
      nmwByEmployee.set(line.employeeId, list);
    }

    for (const [employeeId, unpaidMins] of autoUnpaidNmwByEmployee) {
      if (unpaidMins <= 0) continue;
      const list = nmwByEmployee.get(employeeId) ?? [];
      list.push({
        amount: 0,
        includesInNmwPay: true,
        countsAsNmwHours: true,
        hours: unpaidMins / 60,
      });
      nmwByEmployee.set(employeeId, list);
    }

    let nmwTopUpTotal = 0;
    let nmwExceptionBump = 0;
    for (const [employeeId, components] of nmwByEmployee) {
      const employment = await this.prisma.employeeEmployment.findFirst({
        where: { employeeId, deletedAt: null },
        select: {
          contractType: { select: { name: true } },
          employee: { select: { personalDetail: { select: { dateOfBirth: true } } } },
        },
      });
      const dob = employment?.employee?.personalDetail?.dateOfBirth ?? null;
      const ageOnPayPeriodEnd = dob
        ? ageInFullYears(dob, run.periodEnd)
        : 21;
      const isApprentice = /apprentice/i.test(employment?.contractType?.name ?? '');
      const category = resolveNmwCategory({
        ageOnPayPeriodEnd,
        isApprentice,
        apprenticeEligible: isApprentice,
      });
      const nmw = validateMinimumWage({
        category,
        components,
        asOf: run.periodEnd,
      });
      if (!nmw.compliant && nmw.topUp > 0) {
        nmwTopUpTotal += nmw.topUp;
        nmwExceptionBump += 1;
        const anyRecon = lineData.find((l) => l.employeeId === employeeId);
        if (anyRecon) {
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: anyRecon.visitReconciliationId,
            employeeId,
            lineType: PayrollRunLineType.NMW_TOP_UP,
            description: `NMW top-up — ${nmw.explanation}`,
            minutes: null,
            amount: nmw.topUp,
            payCardId: anyRecon.payCardId ?? null,
            visitRef: anyRecon.visitRef ?? null,
            exceptionMessage: null,
          });
        }
      }
    }

    const grossPay = lineData
      .filter(
        (l) =>
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType) &&
          l.lineType !== ('EXPENSE' as PayrollRunLineType),
      )
      .reduce((sum, l) => sum + Number(l.amount), 0);
    const expenseTotal = lineData
      .filter(
        (l) =>
          l.lineType === PayrollRunLineType.MILEAGE ||
          l.lineType === ('PASSENGER_MILEAGE' as PayrollRunLineType) ||
          l.lineType === ('EXPENSE' as PayrollRunLineType),
      )
      .reduce((sum, l) => sum + Number(l.amount), 0);

    const employer = estimateEmployerCost({
      grossPay,
      mileageAndExpenses: expenseTotal,
      payFrequency: 'WEEKLY',
    });

    const totalExceptions = exceptionCount + nmwExceptionBump;

    const componentRows = lineData
      .filter((l) => l.employeeId && Number(l.amount) !== 0)
      .map((l) => ({
        workerId: l.employeeId!,
        visitReconciliationId: l.visitReconciliationId,
        payrollRunId: id,
        componentType: String(l.lineType),
        sourceDurationMinutes: l.minutes ?? null,
        approvedDurationMinutes: l.minutes ?? null,
        appliedRate: l.unitAmount != null ? Number(l.unitAmount) : null,
        amount: Number(l.amount),
        taxable:
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType),
        pensionable:
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType),
        nmwInclusion:
          l.lineType !== PayrollRunLineType.MILEAGE &&
          l.lineType !== ('PASSENGER_MILEAGE' as PayrollRunLineType),
        approvalStatus: 'AUTO',
        calculationExplanation: l.description,
        rateCardId: l.payCardId ?? null,
        rateCardVersion: null as number | null,
      }));

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollRunLine.deleteMany({ where: { payrollRunId: id } });
      try {
        await (tx as { payComponent?: { deleteMany: Function } }).payComponent?.deleteMany({
          where: { payrollRunId: id },
        });
      } catch {
        // PayComponent table may not exist until migrate.
      }
      if (lineData.length) {
        await tx.payrollRunLine.createMany({ data: lineData });
      }
      if (componentRows.length) {
        try {
          await (tx as { payComponent: { createMany: Function } }).payComponent.createMany({
            data: componentRows,
          });
        } catch {
          // Ignore if migration not applied yet.
        }
      }
      await tx.payrollRun.update({
        where: { id },
        data: {
          status:
            totalExceptions > 0
              ? PayrollRunStatus.EXCEPTION_FOUND
              : lineData.length
                ? PayrollRunStatus.READY_FOR_REVIEW
                : PayrollRunStatus.DRAFT,
          carerCount: employeeIds.size,
          visitLineCount: lineData.filter((l) => l.lineType === PayrollRunLineType.VISIT_PAY).length,
          grossPay: grossPay + nmwTopUpTotal,
          nmwTopUp: nmwTopUpTotal,
          expenseTotal,
          estimatedEmployerNi: employer.employerNi,
          estimatedEmployerPension: employer.employerPension,
          estimatedEmployerCost: employer.totalEmploymentCost,
          exceptionCount: totalExceptions,
        } as Prisma.PayrollRunUpdateInput,
      });
    });

    return this.getById(id);
  }

  async approve(userId: string, id: string) {
    const run = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (
      run.status !== PayrollRunStatus.READY_FOR_REVIEW &&
      run.status !== PayrollRunStatus.EXCEPTION_FOUND
    ) {
      throw new BadRequestException('Only runs ready for review can be approved');
    }

    await this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: PayrollRunStatus.APPROVED,
        approvedAt: new Date(),
        approvedById: userId,
      },
    });
    return this.getById(id);
  }

  async lock(userId: string, id: string) {
    const run = await this.prisma.payrollRun.findUnique({
      where: { id },
      include: { lines: { select: { visitReconciliationId: true } } },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.APPROVED) {
      throw new BadRequestException('Approve the payroll run before locking');
    }

    const reconIds = run.lines.map((l) => l.visitReconciliationId);

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.LOCKED,
          lockedAt: new Date(),
          approvedById: run.approvedById ?? userId,
        },
      });
      if (reconIds.length) {
        await tx.visitReconciliation.updateMany({
          where: { id: { in: reconIds } },
          data: { includedInPayrollRunId: id, lockedAt: new Date() },
        });
      }
    });

    return this.getById(id);
  }

  async getExportCsv(id: string) {
    const row = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Payroll run not found');
    if (
      row.status !== PayrollRunStatus.LOCKED &&
      row.status !== PayrollRunStatus.EXPORTED
    ) {
      throw new BadRequestException(
        'Only locked or exported payroll runs can be downloaded',
      );
    }

    const visitRows = await this.loadVisitExportRows(id);
    const csv = buildPayrollRunVisitLogCsv(visitRows);
    return {
      csv,
      filename: payrollRunExportFilename(
        row.periodStart.toISOString().slice(0, 10),
        row.periodEnd.toISOString().slice(0, 10),
      ),
    };
  }

  async exportAndMark(id: string) {
    const row = await this.prisma.payrollRun.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Payroll run not found');
    if (row.status === PayrollRunStatus.EXPORTED) {
      throw new BadRequestException('Payroll run has already been exported');
    }
    if (row.status !== PayrollRunStatus.LOCKED) {
      throw new BadRequestException('Approve and lock the payroll run before exporting');
    }

    const exportedAt = new Date();

    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.EXPORTED, exportedAt },
    });

    const visitRows = await this.loadVisitExportRows(id);
    const csv = buildPayrollRunVisitLogCsv(visitRows);
    return {
      csv,
      filename: payrollRunExportFilename(
        row.periodStart.toISOString().slice(0, 10),
        row.periodEnd.toISOString().slice(0, 10),
      ),
    };
  }

  private async loadVisitExportRows(payrollRunId: string): Promise<PayrollVisitExportRow[]> {
    const lines = await this.prisma.payrollRunLine.findMany({
      where: { payrollRunId },
      include: { visitReconciliation: true },
      orderBy: [{ visitRef: 'asc' }],
      take: 5000,
    });

    if (!lines.length) return [];

    const employeeIds = [
      ...new Set(
        lines
          .map((line) => line.employeeId ?? line.visitReconciliation.employeeId)
          .filter(Boolean),
      ),
    ] as string[];
    const serviceUserIds = [
      ...new Set(lines.map((line) => line.visitReconciliation.serviceUserId)),
    ];

    const [employees, serviceUsers] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds } },
            select: {
              id: true,
              personalDetail: {
                select: {
                  firstName: true,
                  lastName: true,
                  addressLine1: true,
                  addressLine2: true,
                  postcode: true,
                },
              },
              employment: {
                select: {
                  employeeNumber: true,
                  payrollNumber: true,
                },
              },
            },
          })
        : [],
      this.prisma.serviceUser.findMany({
        where: { id: { in: serviceUserIds } },
        select: {
          id: true,
          careType: { select: { code: true } },
        },
      }),
    ]);

    const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
    const serviceUserMap = new Map(serviceUsers.map((su) => [su.id, su]));

    const carerTotals = new Map<string, { minutes: number; pay: number }>();
    for (const line of lines) {
      const employeeId = line.employeeId ?? line.visitReconciliation.employeeId;
      if (!employeeId) continue;
      const minutes =
        line.minutes ?? line.visitReconciliation.payableMinutes ?? 0;
      const pay = Number(line.amount);
      const existing = carerTotals.get(employeeId);
      if (existing) {
        existing.minutes += minutes;
        existing.pay += pay;
      } else {
        carerTotals.set(employeeId, { minutes, pay });
      }
    }

    const sorted = [...lines].sort((a, b) => {
      const employeeIdA = a.employeeId ?? a.visitReconciliation.employeeId ?? '';
      const employeeIdB = b.employeeId ?? b.visitReconciliation.employeeId ?? '';
      const employeeA = employeeMap.get(employeeIdA);
      const employeeB = employeeMap.get(employeeIdB);
      const nameA = [
        employeeA?.personalDetail?.lastName,
        employeeA?.personalDetail?.firstName,
      ]
        .filter(Boolean)
        .join(' ');
      const nameB = [
        employeeB?.personalDetail?.lastName,
        employeeB?.personalDetail?.firstName,
      ]
        .filter(Boolean)
        .join(' ');
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      return (
        a.visitReconciliation.plannedStartDateTime.getTime() -
        b.visitReconciliation.plannedStartDateTime.getTime()
      );
    });

    return sorted.map((line) => {
      const recon = line.visitReconciliation;
      const employeeId = line.employeeId ?? recon.employeeId;
      const employee = employeeId ? employeeMap.get(employeeId) : undefined;
      const su = serviceUserMap.get(recon.serviceUserId);
      const emonitored = resolveEmonitored(
        recon.actualStartDateTime,
        recon.actualEndDateTime,
      );
      const visitMinutes = line.minutes ?? recon.payableMinutes ?? 0;
      const visitPay = Number(line.amount);
      const totals = employeeId ? carerTotals.get(employeeId) : undefined;

      return {
        emonitored,
        carerId: resolveCarerId({
          payrollNumber: employee?.employment?.payrollNumber,
          employeeNumber: employee?.employment?.employeeNumber,
        }),
        carerFirstName: employee?.personalDetail?.firstName ?? '',
        carerSecondName: employee?.personalDetail?.lastName ?? '',
        carerAddress: resolveCarerAddress({
          addressLine1: employee?.personalDetail?.addressLine1,
          addressLine2: employee?.personalDetail?.addressLine2,
        }),
        carerPostCode: employee?.personalDetail?.postcode ?? '',
        visitDate: formatVisitDateMmDdYy(recon.plannedStartDateTime),
        careType: resolveCareTypeExportCode(su?.careType?.code),
        plannedArrival: formatTimeHhMmSs(recon.plannedStartDateTime),
        plannedDeparture: formatTimeHhMmSsOrZero(recon.plannedEndDateTime),
        actualArrival:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(recon.actualStartDateTime!)
            : '00:00:00',
        actualDeparture:
          emonitored === 'LOGGED'
            ? formatTimeHhMmSs(recon.actualEndDateTime!)
            : '00:00:00',
        visitHours: minutesToDecimalHours(visitMinutes),
        visitPay: formatPayAmount(visitPay),
        totalHoursWorked: minutesToDecimalHours(totals?.minutes ?? 0),
        grossPay: formatPayAmount(totals?.pay ?? 0),
      };
    });
  }

  /**
   * Employee earnings summary for the HR profile Earnings tab.
   * Paid = included in a LOCKED/EXPORTED payroll run.
   * Remaining = approved for pay but not yet in a locked payroll run.
   */
  /**
   * Org-wide salary overview for a period (visit pay, paid, rejected, fines, penalties, net).
   */
  async listEmployeeSalaries(query: EmployeeEarningsQueryDto) {
    const plannedDateFilter = await this.operationalVisitDateFilter(
      query.dateFrom,
      query.dateTo,
    );

    const paidStatuses: PayrollRunStatus[] = [
      PayrollRunStatus.LOCKED,
      PayrollRunStatus.EXPORTED,
    ];

    const dateOnVisit: Prisma.VisitReconciliationWhereInput = plannedDateFilter
      ? { plannedStartDateTime: plannedDateFilter }
      : {};

    // Visits already enrolled in a UK payroll run are not "remaining" (same as
    // getEmployeeEarnings) — bank payout / UK net tracks those separately.
    const ukCoveredInputs = await this.prisma.ukPayrollInputLine.findMany({
      where: { sourceVisitReconciliationId: { not: null } },
      select: { sourceVisitReconciliationId: true },
      distinct: ['sourceVisitReconciliationId'],
    });
    const ukCoveredReconIds = ukCoveredInputs
      .map((l) => l.sourceVisitReconciliationId)
      .filter((id): id is string => Boolean(id));

    const remainingWhere: Prisma.VisitReconciliationWhereInput = {
      ...earningsRemainingWhere(dateOnVisit),
      ...(ukCoveredReconIds.length
        ? { id: { notIn: ukCoveredReconIds } }
        : {}),
    };

    const [
      salaryGroups,
      paidGroups,
      remainingGroups,
      rejectedGroups,
      pendingGroups,
    ] = await Promise.all([
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: {
          ...dateOnVisit,
          OR: [
            { includedInPayrollRunId: { not: null } },
            { status: { in: PAYROLL_ELIGIBLE_RECON } },
            { status: VisitReconciliationStatus.LOCKED },
            {
              status: { in: PRICED_PENDING_RECON },
              payableAmount: { not: null },
            },
          ],
        },
        _sum: { payableAmount: true },
        _count: { _all: true },
      }),
      this.prisma.payrollRunLine.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { not: null },
          payrollRun: { status: { in: paidStatuses } },
          ...(plannedDateFilter
            ? { visitReconciliation: { plannedStartDateTime: plannedDateFilter } }
            : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: remainingWhere,
        _sum: { payableAmount: true },
        _count: { _all: true },
      }),
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: {
          ...dateOnVisit,
          status: VisitReconciliationStatus.REJECTED_FOR_PAY,
        },
        _sum: { payableAmount: true },
        _count: { _all: true },
      }),
      this.prisma.visitReconciliation.groupBy({
        by: ['employeeId'],
        where: {
          ...dateOnVisit,
          includedInPayrollRunId: null,
          status: {
            in: [
              VisitReconciliationStatus.PENDING_REVIEW,
              VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
            ],
          },
        },
        _count: { _all: true },
      }),
    ]);

    const salaryMonths = salaryMonthsForEarningsQuery(query.dateFrom, query.dateTo);
    const deductions = await this.prisma.employeeSalaryDeduction.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(salaryMonths ? { salaryMonth: { in: salaryMonths } } : {}),
      },
      select: {
        employeeId: true,
        type: true,
        amount: true,
      },
    });

    type Acc = {
      salaryAmount: number;
      salaryVisitCount: number;
      paidAmount: number;
      paidLineCount: number;
      remainingAmount: number;
      remainingVisitCount: number;
      rejectedAmount: number;
      rejectedVisitCount: number;
      pendingReviewCount: number;
      fineTotal: number;
      penaltyTotal: number;
    };

    const byEmployee = new Map<string, Acc>();
    const ensure = (id: string): Acc => {
      let row = byEmployee.get(id);
      if (!row) {
        row = {
          salaryAmount: 0,
          salaryVisitCount: 0,
          paidAmount: 0,
          paidLineCount: 0,
          remainingAmount: 0,
          remainingVisitCount: 0,
          rejectedAmount: 0,
          rejectedVisitCount: 0,
          pendingReviewCount: 0,
          fineTotal: 0,
          penaltyTotal: 0,
        };
        byEmployee.set(id, row);
      }
      return row;
    };

    for (const g of salaryGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.salaryAmount = Number(g._sum.payableAmount ?? 0);
      row.salaryVisitCount = g._count._all;
    }
    for (const g of paidGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.paidAmount = Number(g._sum.amount ?? 0);
      row.paidLineCount = g._count._all;
    }
    for (const g of remainingGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.remainingAmount = Number(g._sum.payableAmount ?? 0);
      row.remainingVisitCount = g._count._all;
    }
    for (const g of rejectedGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.rejectedAmount = Number(g._sum.payableAmount ?? 0);
      row.rejectedVisitCount = g._count._all;
    }
    for (const g of pendingGroups) {
      if (!g.employeeId) continue;
      const row = ensure(g.employeeId);
      row.pendingReviewCount = g._count._all;
    }
    for (const d of deductions) {
      const row = ensure(d.employeeId);
      const amount = Number(d.amount);
      if (d.type === SalaryDeductionType.FINE) row.fineTotal += amount;
      else row.penaltyTotal += amount;
    }

    const employeeIds = [...byEmployee.keys()];
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: employeeIds }, deletedAt: null },
          select: {
            id: true,
            isActive: true,
            personalDetail: { select: { firstName: true, lastName: true } },
            employment: { select: { employeeNumber: true } },
          },
        })
      : [];

    const empMeta = new Map(
      employees.map((e) => {
        const name =
          [e.personalDetail?.firstName, e.personalDetail?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() || 'Unknown';
        return [
          e.id,
          {
            name,
            employeeNumber: e.employment?.employeeNumber ?? null,
            isActive: e.isActive,
          },
        ] as const;
      }),
    );

    const periodKey = derivePeriodKeyFromRange(query.dateFrom, query.dateTo);
    const {
      ukNetByEmployee,
      paidOutByEmployee,
      committedByEmployee,
      hasEligibleUkRun,
    } = await this.employeePayouts.ukNetAndPaidOutForDateRange(
      query.dateFrom,
      query.dateTo,
    );

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const rows = employeeIds
      .map((id) => {
        const meta = empMeta.get(id);
        if (!meta) return null;
        const a = byEmployee.get(id)!;
        const fineTotal = round2(a.fineTotal);
        const penaltyTotal = round2(a.penaltyTotal);
        const deductionsTotal = round2(fineTotal + penaltyTotal);
        const salaryAmount = round2(a.salaryAmount);
        const netSalary = round2(salaryAmount - deductionsTotal);
        const paidAmount = round2(a.paidAmount);
        const remainingAmount = round2(a.remainingAmount);
        const rejectedAmount = round2(a.rejectedAmount);
        const ukNetPay = round2(ukNetByEmployee.get(id) ?? 0);
        const paidOutAmount = round2(paidOutByEmployee.get(id) ?? 0);
        const committed = round2(committedByEmployee.get(id) ?? 0);
        const outstandingPayoutAmount = hasEligibleUkRun
          ? round2(Math.max(0, ukNetPay - committed))
          : 0;
        return {
          employeeId: id,
          employeeName: meta.name,
          employeeNumber: meta.employeeNumber,
          isActive: meta.isActive,
          salaryAmount: formatMoney(salaryAmount),
          salaryAmountValue: salaryAmount,
          salaryVisitCount: a.salaryVisitCount,
          paidAmount: formatMoney(paidAmount),
          paidAmountValue: paidAmount,
          paidLineCount: a.paidLineCount,
          remainingAmount: formatMoney(remainingAmount),
          remainingAmountValue: remainingAmount,
          remainingVisitCount: a.remainingVisitCount,
          rejectedAmount: formatMoney(rejectedAmount),
          rejectedAmountValue: rejectedAmount,
          rejectedVisitCount: a.rejectedVisitCount,
          pendingReviewCount: a.pendingReviewCount,
          fineTotal: formatMoney(fineTotal),
          fineTotalValue: fineTotal,
          penaltyTotal: formatMoney(penaltyTotal),
          penaltyTotalValue: penaltyTotal,
          deductionsTotal: formatMoney(deductionsTotal),
          deductionsTotalValue: deductionsTotal,
          netSalaryAmount: formatMoney(netSalary),
          netSalaryAmountValue: netSalary,
          ukNetPayAmount: formatMoney(ukNetPay),
          ukNetPayAmountValue: ukNetPay,
          hasEligibleUkRun,
          paidOutAmount: formatMoney(paidOutAmount),
          paidOutAmountValue: paidOutAmount,
          outstandingPayoutAmount: formatMoney(outstandingPayoutAmount),
          outstandingPayoutAmountValue: outstandingPayoutAmount,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return {
      data: {
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        periodKey,
        hasEligibleUkRun,
        currency: 'GBP',
        employeeCount: rows.length,
        rows,
      },
    };
  }

  async getEmployeeEarnings(employeeId: string, query: EmployeeEarningsQueryDto) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const timeZone = await this.orgSettings.getOperationalTimezone();
    const plannedDateFilter = await this.operationalVisitDateFilter(
      query.dateFrom,
      query.dateTo,
    );

    const visitDateWhere: Prisma.VisitReconciliationWhereInput = {
      employeeId,
      ...(plannedDateFilter ? { plannedStartDateTime: plannedDateFilter } : {}),
    };

    const paidStatuses: PayrollRunStatus[] = [
      PayrollRunStatus.LOCKED,
      PayrollRunStatus.EXPORTED,
    ];

    const paidLineWhere: Prisma.PayrollRunLineWhereInput = {
      employeeId,
      payrollRun: { status: { in: paidStatuses } },
      ...(plannedDateFilter
        ? { visitReconciliation: { plannedStartDateTime: plannedDateFilter } }
        : {}),
    };

    const remainingWhereBase = earningsRemainingWhere(visitDateWhere);

    const ukInputsForEmployee = await this.prisma.ukPayrollInputLine.findMany({
      where: {
        employeeId,
        sourceVisitReconciliationId: { not: null },
      },
      select: {
        sourceVisitReconciliationId: true,
        runEmployeeId: true,
        runId: true,
        run: { select: { id: true, label: true, status: true } },
      },
    });
    const ukCoveredReconIds = [
      ...new Set(
        ukInputsForEmployee
          .map((l) => l.sourceVisitReconciliationId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const remainingWhere: Prisma.VisitReconciliationWhereInput = {
      ...remainingWhereBase,
      ...(ukCoveredReconIds.length ? { id: { notIn: ukCoveredReconIds } } : {}),
    };

    const pendingWhere: Prisma.VisitReconciliationWhereInput = {
      ...visitDateWhere,
      includedInPayrollRunId: null,
      status: {
        in: PRICED_PENDING_RECON,
      },
      payableAmount: null,
    };

    const [
      paidAggregate,
      paidVisitGroups,
      remainingAmountAgg,
      remainingVisitCount,
      pendingCount,
      visitRows,
    ] = await Promise.all([
      this.prisma.payrollRunLine.aggregate({
        where: paidLineWhere,
        _sum: { amount: true },
      }),
      this.prisma.payrollRunLine.groupBy({
        by: ['visitReconciliationId'],
        where: {
          ...paidLineWhere,
          lineType: PayrollRunLineType.VISIT_PAY,
        },
      }),
      this.prisma.visitReconciliation.aggregate({
        where: remainingWhere,
        _sum: { payableAmount: true },
      }),
      this.prisma.visitReconciliation.count({ where: remainingWhere }),
      this.prisma.visitReconciliation.count({ where: pendingWhere }),
      this.prisma.visitReconciliation.findMany({
        where: {
          employeeId,
          ...(plannedDateFilter ? { plannedStartDateTime: plannedDateFilter } : {}),
          OR: [
            { includedInPayrollRunId: { not: null } },
            { status: { in: PAYROLL_ELIGIBLE_RECON } },
            {
              status: {
                in: [
                  VisitReconciliationStatus.PENDING_REVIEW,
                  VisitReconciliationStatus.REQUIRES_MANAGER_APPROVAL,
                  VisitReconciliationStatus.REJECTED_FOR_PAY,
                ],
              },
            },
          ],
        },
        select: {
          id: true,
          visitRef: true,
          scheduledVisitId: true,
          serviceUserId: true,
          plannedStartDateTime: true,
          plannedEndDateTime: true,
          actualStartDateTime: true,
          actualEndDateTime: true,
          approvedPayStart: true,
          approvedPayEnd: true,
          payableAmount: true,
          payableMinutes: true,
          status: true,
          includedInPayrollRunId: true,
          includedInPayrollRun: {
            select: {
              id: true,
              periodLabel: true,
              periodStart: true,
              periodEnd: true,
              status: true,
            },
          },
        },
        orderBy: { plannedStartDateTime: 'desc' },
        take: plannedDateFilter ? 500 : 100,
      }),
    ]);

    const visitIdSet = new Set(visitRows.map((r) => r.id));
    const ukByReconId = new Map<
      string,
      { runId: string; runLabel: string; runStatus: string; runEmployeeId: string }
    >();
    for (const line of ukInputsForEmployee) {
      if (!line.sourceVisitReconciliationId || !visitIdSet.has(line.sourceVisitReconciliationId)) {
        continue;
      }
      ukByReconId.set(line.sourceVisitReconciliationId, {
        runId: line.runId,
        runLabel: line.run.label,
        runStatus: line.run.status,
        runEmployeeId: line.runEmployeeId,
      });
    }

    const ukRunEmployeeIds = [
      ...new Set([...ukByReconId.values()].map((v) => v.runEmployeeId)),
    ];
    const paidUkRunEmployeeIds = new Set<string>();
    if (ukRunEmployeeIds.length) {
      const paidLines = await this.prisma.employeePayoutLine.findMany({
        where: {
          employeeId,
          ukPayrollRunEmployeeId: { in: ukRunEmployeeIds },
          status: 'PAID',
          batch: { status: 'PAID' },
        },
        select: { ukPayrollRunEmployeeId: true },
      });
      for (const line of paidLines) {
        if (line.ukPayrollRunEmployeeId) {
          paidUkRunEmployeeIds.add(line.ukPayrollRunEmployeeId);
        }
      }
    }

    const salaryWhere: Prisma.VisitReconciliationWhereInput = {
      ...visitDateWhere,
      OR: [
        { includedInPayrollRunId: { not: null } },
        { status: { in: PAYROLL_ELIGIBLE_RECON } },
        { status: VisitReconciliationStatus.LOCKED },
        {
          status: { in: PRICED_PENDING_RECON },
          payableAmount: { not: null },
        },
      ],
    };
    const [salaryAmountAgg, salaryVisitCount] = await Promise.all([
      this.prisma.visitReconciliation.aggregate({
        where: salaryWhere,
        _sum: { payableAmount: true },
      }),
      this.prisma.visitReconciliation.count({ where: salaryWhere }),
    ]);
    const salaryAmount = Number(salaryAmountAgg._sum.payableAmount ?? 0);

    const totalEarned = Number(paidAggregate._sum.amount ?? 0);
    const remainingAmount = Number(remainingAmountAgg._sum.payableAmount ?? 0);

    const serviceUserIds = [...new Set(visitRows.map((r) => r.serviceUserId))];
    const serviceUsers = serviceUserIds.length
      ? await this.prisma.serviceUser.findMany({
          where: { id: { in: serviceUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            preferredName: true,
            serviceUserNumber: true,
          },
        })
      : [];
    const suMap = new Map(
      serviceUsers.map((su) => {
        const name =
          su.preferredName?.trim() ||
          `${su.firstName} ${su.lastName}`.trim() ||
          'Unknown';
        const label = su.serviceUserNumber ? `${name} (${su.serviceUserNumber})` : name;
        return [su.id, label] as const;
      }),
    );

    const formatHm = (d: Date | null | undefined) => {
      if (!d) return null;
      return formatHmInTimeZone(d, timeZone);
    };

    const visits = visitRows.map((row) => {
      const inVisitPayRun = Boolean(row.includedInPayrollRunId);
      const rejected = row.status === VisitReconciliationStatus.REJECTED_FOR_PAY;
      const uk = ukByReconId.get(row.id);
      const bankPaid = Boolean(uk && paidUkRunEmployeeIds.has(uk.runEmployeeId));
      const inUkPayroll = Boolean(uk);
      const remaining =
        !inVisitPayRun &&
        !inUkPayroll &&
        !rejected &&
        isEarningsRemainingStatus(row.status, row.payableAmount);
      const paymentState = bankPaid
        ? 'BANK_PAID'
        : inVisitPayRun
          ? 'PAID'
          : inUkPayroll
            ? 'IN_UK_PAYROLL'
            : remaining
              ? 'REMAINING'
              : rejected
                ? 'REJECTED'
                : 'PENDING';
      const hours =
        row.payableMinutes != null
          ? formatMinutesAsHours(row.payableMinutes)
          : null;

      return {
        id: row.id,
        visitRef: row.visitRef,
        serviceUserName: suMap.get(row.serviceUserId) ?? 'Unknown',
        plannedStart: row.plannedStartDateTime.toISOString(),
        plannedEnd: row.plannedEndDateTime?.toISOString() ?? null,
        plannedTime:
          row.plannedEndDateTime
            ? `${formatHm(row.plannedStartDateTime)}–${formatHm(row.plannedEndDateTime)}`
            : formatHm(row.plannedStartDateTime),
        actualStart: row.actualStartDateTime?.toISOString() ?? null,
        actualEnd: row.actualEndDateTime?.toISOString() ?? null,
        actualTime:
          row.actualStartDateTime && row.actualEndDateTime
            ? `${formatHm(row.actualStartDateTime)}–${formatHm(row.actualEndDateTime)}`
            : row.actualStartDateTime
              ? formatHm(row.actualStartDateTime)
              : null,
        approvedPayStart: row.approvedPayStart?.toISOString() ?? null,
        approvedPayEnd: row.approvedPayEnd?.toISOString() ?? null,
        approvedPayTime:
          row.approvedPayStart && row.approvedPayEnd
            ? `${formatHm(row.approvedPayStart)}–${formatHm(row.approvedPayEnd)}`
            : row.approvedPayStart
              ? formatHm(row.approvedPayStart)
              : null,
        payableAmount: formatMoney(Number(row.payableAmount ?? 0)),
        payableAmountValue: Math.round(Number(row.payableAmount ?? 0) * 100) / 100,
        payableMinutes: row.payableMinutes,
        payableHours: hours,
        status: row.status,
        paymentState,
        paid: inVisitPayRun || bankPaid,
        countsTowardSalary: inVisitPayRun || remaining || inUkPayroll,
        payrollRunId: row.includedInPayrollRun?.id ?? uk?.runId ?? null,
        payrollPeriod: uk?.runLabel ?? row.includedInPayrollRun?.periodLabel ?? null,
        payrollRunStatus: uk?.runStatus ?? row.includedInPayrollRun?.status ?? null,
        ukPayrollRunId: uk?.runId ?? null,
        ukPayrollRunLabel: uk?.runLabel ?? null,
      };
    });

    const salaryMonths = salaryMonthsForEarningsQuery(query.dateFrom, query.dateTo);
    const deductions = await this.prisma.employeeSalaryDeduction.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        ...(salaryMonths ? { salaryMonth: { in: salaryMonths } } : {}),
      },
      orderBy: [{ salaryMonth: 'desc' }, { createdAt: 'desc' }],
    });

    let fineTotal = 0;
    let penaltyTotal = 0;
    const mappedDeductions = deductions.map((d) => {
      const amount = Number(d.amount);
      if (d.type === SalaryDeductionType.FINE) fineTotal += amount;
      else penaltyTotal += amount;
      return {
        id: d.id,
        type: d.type,
        amount: formatMoney(amount),
        amountValue: Math.round(amount * 100) / 100,
        reason: d.reason,
        notes: d.notes,
        salaryMonth: d.salaryMonth,
        createdAt: d.createdAt.toISOString(),
      };
    });
    fineTotal = Math.round(fineTotal * 100) / 100;
    penaltyTotal = Math.round(penaltyTotal * 100) / 100;
    const deductionsTotal = Math.round((fineTotal + penaltyTotal) * 100) / 100;
    const visitSalary = Math.round(salaryAmount * 100) / 100;
    const netSalary = Math.round((visitSalary - deductionsTotal) * 100) / 100;

    const {
      ukNetByEmployee,
      paidOutByEmployee,
      committedByEmployee,
      hasEligibleUkRun,
    } = await this.employeePayouts.ukNetAndPaidOutForDateRange(
      query.dateFrom,
      query.dateTo,
    );
    const ukNetPay = Math.round((ukNetByEmployee.get(employeeId) ?? 0) * 100) / 100;
    const paidOutAmount = Math.round((paidOutByEmployee.get(employeeId) ?? 0) * 100) / 100;
    const committed = Math.round((committedByEmployee.get(employeeId) ?? 0) * 100) / 100;
    const outstandingPayoutAmount = hasEligibleUkRun
      ? Math.round(Math.max(0, ukNetPay - committed) * 100) / 100
      : 0;

    return {
      data: {
        employeeId,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        organisationTimezone: timeZone,
        currency: 'GBP',
        /** Gross monthly salary from accepted visits (before fines/penalties). */
        salaryAmount: formatMoney(visitSalary),
        salaryAmountValue: visitSalary,
        salaryVisitCount,
        /** Net = visit salary − fines − penalties. */
        netSalaryAmount: formatMoney(netSalary),
        netSalaryAmountValue: netSalary,
        fineTotal: formatMoney(fineTotal),
        fineTotalValue: fineTotal,
        penaltyTotal: formatMoney(penaltyTotal),
        penaltyTotalValue: penaltyTotal,
        deductionsTotal: formatMoney(deductionsTotal),
        deductionsTotalValue: deductionsTotal,
        deductions: mappedDeductions,
        totalEarned: formatMoney(totalEarned),
        totalEarnedAmount: Math.round(totalEarned * 100) / 100,
        paidVisitCount: paidVisitGroups.length,
        remainingVisitCount,
        remainingAmount: formatMoney(remainingAmount),
        remainingAmountValue: Math.round(remainingAmount * 100) / 100,
        pendingReviewCount: pendingCount,
        ukNetPayAmount: formatMoney(ukNetPay),
        ukNetPayAmountValue: ukNetPay,
        hasEligibleUkRun,
        /** Bank payout of UK net (PAID batches). */
        paidOutAmount: formatMoney(paidOutAmount),
        paidOutAmountValue: paidOutAmount,
        outstandingPayoutAmount: formatMoney(outstandingPayoutAmount),
        outstandingPayoutAmountValue: outstandingPayoutAmount,
        visits,
      },
    };
  }

  async listEmployeeSalaryDeductions(employeeId: string, salaryMonth?: string) {
    await this.ensureEmployee(employeeId);
    const rows = await this.prisma.employeeSalaryDeduction.findMany({
      where: {
        employeeId,
        deletedAt: null,
        isActive: true,
        ...(salaryMonth ? { salaryMonth } : {}),
      },
      orderBy: [{ salaryMonth: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      data: rows.map((d) => ({
        id: d.id,
        type: d.type,
        amount: formatMoney(Number(d.amount)),
        amountValue: Math.round(Number(d.amount) * 100) / 100,
        reason: d.reason,
        notes: d.notes,
        salaryMonth: d.salaryMonth,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  async createEmployeeSalaryDeduction(
    userId: string,
    employeeId: string,
    dto: CreateEmployeeSalaryDeductionDto,
  ) {
    await this.ensureEmployee(employeeId);
    const amount = Math.round(Number(dto.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Deduction amount must be greater than zero');
    }
    const created = await this.prisma.employeeSalaryDeduction.create({
      data: {
        employeeId,
        type: dto.type as SalaryDeductionType,
        amount,
        reason: dto.reason.trim(),
        notes: dto.notes?.trim() || null,
        salaryMonth: dto.salaryMonth,
        createdById: userId,
        updatedById: userId,
      },
    });
    return {
      data: {
        id: created.id,
        type: created.type,
        amount: formatMoney(Number(created.amount)),
        amountValue: Math.round(Number(created.amount) * 100) / 100,
        reason: created.reason,
        notes: created.notes,
        salaryMonth: created.salaryMonth,
        createdAt: created.createdAt.toISOString(),
      },
    };
  }

  async deleteEmployeeSalaryDeduction(userId: string, employeeId: string, deductionId: string) {
    await this.ensureEmployee(employeeId);
    const row = await this.prisma.employeeSalaryDeduction.findFirst({
      where: { id: deductionId, employeeId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Salary deduction not found');
    await this.prisma.employeeSalaryDeduction.update({
      where: { id: row.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: userId,
      },
    });
    return { data: { id: row.id, deleted: true } };
  }

  /**
   * Test/ops helper: wipe this employee’s earnings display to £0.
   * - Deletes payout lines (Bank paid → £0)
   * - Clears fines/penalties
   * - Zeros payable amounts on visits not yet in a locked visit-pay run (Ready → £0)
   * - Removes them from UK payroll runs and retotals those runs (UK net / Outstanding → £0)
   * Does not delete locked/exported visit-pay run history lines.
   */
  async resetEmployeeEarnings(userId: string, employeeId: string) {
    await this.ensureEmployee(employeeId);

    const payout = await this.employeePayouts.deleteLinesForEmployee(employeeId);

    const deductions = await this.prisma.employeeSalaryDeduction.updateMany({
      where: { employeeId, deletedAt: null, isActive: true },
      data: {
        deletedAt: new Date(),
        isActive: false,
        updatedById: userId,
      },
    });

    const readyVisits = await this.prisma.visitReconciliation.updateMany({
      where: {
        employeeId,
        includedInPayrollRunId: null,
        payableAmount: { not: null },
      },
      data: {
        payableAmount: 0,
        updatedAt: new Date(),
      },
    });

    const ukRunEmployees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: { employeeId },
      select: {
        id: true,
        runId: true,
        netPay: true,
        totalGross: true,
        incomeTax: true,
        employeeNi: true,
        employerNi: true,
        expenseTotal: true,
      },
    });

    const affectedRunIds = [...new Set(ukRunEmployees.map((e) => e.runId))];

    if (ukRunEmployees.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.ukPayrollInputLine.deleteMany({ where: { employeeId } });
        await tx.ukPayrollRunEmployee.deleteMany({ where: { employeeId } });

        for (const runId of affectedRunIds) {
          const remaining = await tx.ukPayrollRunEmployee.findMany({
            where: { runId },
            select: {
              totalGross: true,
              expenseTotal: true,
              incomeTax: true,
              employeeNi: true,
              employerNi: true,
              netPay: true,
            },
          });

          const sum = (pick: (r: (typeof remaining)[number]) => unknown) =>
            Math.round(
              remaining.reduce((s, r) => s + Number(pick(r) ?? 0), 0) * 100,
            ) / 100;

          await tx.ukPayrollRun.update({
            where: { id: runId },
            data: {
              employeeCount: remaining.length,
              totalGross: sum((r) => r.totalGross),
              totalExpenses: sum((r) => r.expenseTotal),
              totalIncomeTax: sum((r) => r.incomeTax),
              totalEmployeeNi: sum((r) => r.employeeNi),
              totalEmployerNi: sum((r) => r.employerNi),
              totalNetPay: sum((r) => r.netPay),
              updatedById: userId,
            },
          });
        }
      });
    }

    return {
      data: {
        deletedPayoutLines: payout.deletedLines,
        deletedPayoutBatches: payout.deletedBatches,
        updatedPayoutBatches: payout.updatedBatches,
        clearedDeductions: deductions.count,
        zeroedReadyVisits: readyVisits.count,
        removedUkRunEmployees: ukRunEmployees.length,
        updatedUkRuns: affectedRunIds.length,
      },
    };
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private mapRow(row: {
    id: string;
    periodLabel: string;
    periodStart: Date;
    periodEnd: Date;
    status: PayrollRunStatus;
    carerCount: number;
    visitLineCount: number;
    grossPay: Prisma.Decimal;
    nmwTopUp: Prisma.Decimal;
    exceptionCount: number;
  }): PayrollRunRow {
    return {
      id: row.id,
      period: row.periodLabel,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      status: row.status,
      carers: row.carerCount,
      visitLines: row.visitLineCount,
      grossPay: formatMoney(Number(row.grossPay)),
      nmwTopUp: formatMoney(Number(row.nmwTopUp)),
      exceptions: row.exceptionCount,
    };
  }
}
