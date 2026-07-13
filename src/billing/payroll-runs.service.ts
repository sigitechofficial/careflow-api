import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PayrollRunLineType,
  PayrollRunStatus,
  Prisma,
  VisitReconciliationStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBillingRunDto } from './dto/billing-runs.dto';
import {
  endOfBillingDate,
  formatMoney,
  formatPeriodLabel,
  parseBillingDateOnly,
} from './billing-run.util';
import {
  calculateMileageAmount,
  calculateTravelTimeAmount,
  formatMinutesAsHours,
  formatTimeRange,
} from './visit-reconciliation.util';
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

const MUTABLE_STATUSES: PayrollRunStatus[] = [
  PayrollRunStatus.DRAFT,
  PayrollRunStatus.EXCEPTION_FOUND,
  PayrollRunStatus.READY_FOR_REVIEW,
];

const PAYROLL_ELIGIBLE_RECON: VisitReconciliationStatus[] = [
  VisitReconciliationStatus.APPROVED_FOR_PAY,
  VisitReconciliationStatus.APPROVED_FOR_BOTH,
];

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
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.payrollRun.findMany({
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    return { data: rows.map((r) => this.mapRow(r)) };
  }

  async getSummary() {
    const drafts = await this.prisma.payrollRun.count({
      where: {
        status: {
          in: [
            PayrollRunStatus.DRAFT,
            PayrollRunStatus.CALCULATING,
            PayrollRunStatus.EXCEPTION_FOUND,
            PayrollRunStatus.READY_FOR_REVIEW,
          ],
        },
      },
    });
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

    const lineData: Prisma.PayrollRunLineCreateManyInput[] = [];
    let exceptionCount = 0;
    const employeeIds = new Set<string>();

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

      // Mileage / travel time supplements from pay card rates × approved journey values.
      if (recon.payCardId && recon.employeeId && !issues.length) {
        const payRules = await this.prisma.payCardRule.findMany({
          where: { payCardId: recon.payCardId },
        });
        const visitDate = recon.plannedStartDateTime;
        const miles = recon.travelMiles != null ? Number(recon.travelMiles) : 0;
        const travelMins = recon.travelMinutes ?? 0;

        const mileage = calculateMileageAmount(payRules, visitDate, miles);
        if (mileage) {
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.MILEAGE,
            description: `Mileage — ${recon.visitRef} (${miles.toFixed(2)} mi)`,
            minutes: null,
            unitAmount: mileage.unitRate,
            amount: mileage.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        }

        const travel = calculateTravelTimeAmount(payRules, visitDate, travelMins);
        if (travel) {
          lineData.push({
            payrollRunId: id,
            visitReconciliationId: recon.id,
            employeeId: recon.employeeId,
            lineType: PayrollRunLineType.TRAVEL_TIME,
            description: `Travel time — ${recon.visitRef} (${travelMins} min)`,
            minutes: travelMins,
            unitAmount: travel.unitRate,
            amount: travel.amount,
            payCardId: recon.payCardId,
            visitRef: recon.visitRef,
            exceptionMessage: null,
          });
        }
      }
    }

    const grossPay = lineData.reduce((sum, l) => sum + Number(l.amount), 0);

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollRunLine.deleteMany({ where: { payrollRunId: id } });
      if (lineData.length) {
        await tx.payrollRunLine.createMany({ data: lineData });
      }
      await tx.payrollRun.update({
        where: { id },
        data: {
          status:
            exceptionCount > 0
              ? PayrollRunStatus.EXCEPTION_FOUND
              : lineData.length
                ? PayrollRunStatus.READY_FOR_REVIEW
                : PayrollRunStatus.DRAFT,
          carerCount: employeeIds.size,
          visitLineCount: lineData.filter((l) => l.lineType === PayrollRunLineType.VISIT_PAY).length,
          grossPay,
          nmwTopUp: 0,
          exceptionCount,
        },
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
