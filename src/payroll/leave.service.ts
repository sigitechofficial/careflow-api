import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { assertDifferentUser } from '../billing/financial-controls.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeaveTermsDto, RecordLeaveEntryDto } from './dto/leave.dto';
import {
  LeaveTerms,
  carryOverAllowed,
  entitlementHours,
  leaveBalance,
  leaveYearFor,
  normalRemuneration,
  rolledUpAllowedFor,
} from './leave.util';
import { weekStartKey } from './salary.util';

const PAY_APPROVED = ['APPROVED_FOR_PAY', 'APPROVED_FOR_BOTH', 'LOCKED'] as const;
/** Pay for work that is part of a normal week's remuneration. */
const REMUNERATION_LINE_TYPES = ['VISIT_PAY', 'TRAVEL_TIME', 'WAITING_TIME'] as const;

const num = (v: Prisma.Decimal | null) => (v == null ? null : Number(v));
const dateOnly = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Q35: holiday entitlement and holiday pay, from terms recorded for each employee and approved by
 * a second person. An employee with no terms in force has nothing worked out: the method used for
 * one employee is never applied to another by default.
 *
 * This is the foundation only. It works out entitlement, balance and the holiday pay rate; it does
 * not yet book leave from the rota or pay holiday automatically.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async requireEmployee(employeeId: string) {
    const row = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('Employee not found');
  }

  private toTerms(row: Prisma.EmployeeLeaveTermsGetPayload<object>): LeaveTerms {
    return {
      workerCategory: row.workerCategory,
      leaveYearStartMonth: row.leaveYearStartMonth,
      leaveYearStartDay: row.leaveYearStartDay,
      weeklyHours: num(row.weeklyHours),
      contractualExtraHours: num(row.contractualExtraHours),
      payMethod: row.payMethod,
      carryOverMaxHours: num(row.carryOverMaxHours),
    };
  }

  /** The approved terms in force on a day: the latest that had started by then. */
  private async termsInForce(employeeId: string, on: Date) {
    return this.prisma.employeeLeaveTerms.findFirst({
      where: {
        employeeId,
        status: { in: ['ACTIVE', 'SUPERSEDED'] },
        effectiveFrom: { lte: on },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }],
    });
  }

  async listTerms(employeeId: string) {
    await this.requireEmployee(employeeId);
    const rows = await this.prisma.employeeLeaveTerms.findMany({ where: { employeeId }, orderBy: { effectiveFrom: 'desc' } });
    return {
      message: 'Leave terms',
      data: rows.map((r) => ({
        id: r.id,
        ...this.toTerms(r),
        effectiveFrom: isoDay(r.effectiveFrom),
        effectiveTo: r.effectiveTo ? isoDay(r.effectiveTo) : null,
        status: r.status,
        note: r.note,
        createdById: r.createdById,
        approvedById: r.approvedById,
        approvedAt: r.approvedAt?.toISOString() ?? null,
      })),
    };
  }

  async createTerms(userId: string, employeeId: string, dto: CreateLeaveTermsDto, meta?: RequestAuditMeta) {
    await this.requireEmployee(employeeId);
    if (dto.workerCategory === 'REGULAR_HOURS' && !((dto.weeklyHours ?? 0) > 0)) {
      throw new BadRequestException('Enter the hours of a normal working week: statutory leave is 5.6 of those weeks.');
    }
    if (dto.payMethod === 'ROLLED_UP_12_07' && !rolledUpAllowedFor(dto.workerCategory)) {
      throw new BadRequestException(
        'Rolled-up holiday pay can only be used for a worker with irregular hours or who works part of the year. A regular-hours worker is paid when the leave is taken.',
      );
    }
    const row = await this.prisma.employeeLeaveTerms.create({
      data: {
        employeeId,
        workerCategory: dto.workerCategory,
        leaveYearStartMonth: dto.leaveYearStartMonth,
        leaveYearStartDay: dto.leaveYearStartDay ?? 1,
        weeklyHours: dto.workerCategory === 'REGULAR_HOURS' ? dto.weeklyHours : (dto.weeklyHours ?? null),
        contractualExtraHours: dto.contractualExtraHours ?? null,
        payMethod: dto.payMethod,
        carryOverMaxHours: dto.carryOverMaxHours ?? null,
        effectiveFrom: dateOnly(dto.effectiveFrom),
        note: dto.note?.trim() || null,
        createdById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_LEAVE_TERMS_CREATED,
      recordType: 'EmployeeLeaveTerms',
      recordId: row.id,
      newValues: { ...this.toTerms(row), effectiveFrom: isoDay(row.effectiveFrom) },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Leave terms saved. They apply once a second person approves them.', data: { id: row.id, status: row.status } };
  }

  async approveTerms(userId: string, termsId: string, meta?: RequestAuditMeta) {
    const existing = await this.prisma.employeeLeaveTerms.findUnique({ where: { id: termsId } });
    if (!existing) throw new NotFoundException('Leave terms not found');
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only terms that are not yet in effect can be approved.');
    assertDifferentUser(existing.createdById, userId, 'Leave terms are approved by a different person from the one who entered them.');
    await this.prisma.$transaction(async (tx) => {
      const approved = await tx.employeeLeaveTerms.updateMany({
        where: { id: termsId, status: 'DRAFT' },
        data: { status: 'ACTIVE', approvedById: userId, approvedAt: new Date() },
      });
      if (approved.count !== 1) throw new ConflictException('These terms were changed by someone else. Reload and check.');
      // Terms that started on or before these are replaced from this start date; they stay as history.
      await tx.employeeLeaveTerms.updateMany({
        where: { employeeId: existing.employeeId, status: 'ACTIVE', id: { not: termsId }, effectiveFrom: { lte: existing.effectiveFrom } },
        data: { status: 'SUPERSEDED', effectiveTo: new Date(existing.effectiveFrom.getTime() - 86_400_000) },
      });
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_LEAVE_TERMS_APPROVED,
      recordType: 'EmployeeLeaveTerms',
      recordId: termsId,
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'ACTIVE' },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Leave terms approved. They apply from their start date.', data: { id: termsId, status: 'ACTIVE' } };
  }

  async recordEntry(userId: string, employeeId: string, dto: RecordLeaveEntryDto, meta?: RequestAuditMeta) {
    await this.requireEmployee(employeeId);
    if ((dto.entryType === 'TAKEN' || dto.entryType === 'LEAVER_PAYMENT') && !(dto.hours > 0)) {
      throw new BadRequestException('Leave taken, or paid on leaving, is a positive number of hours.');
    }
    if (dto.hours === 0) throw new BadRequestException('Enter the hours.');
    const row = await this.prisma.employeeLeaveEntry.create({
      data: {
        employeeId,
        entryType: dto.entryType,
        entitlementType: dto.entitlementType ?? 'STATUTORY',
        hours: dto.hours,
        date: dateOnly(dto.date),
        note: dto.note.trim(),
        createdById: userId,
      },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_LEAVE_ENTRY_RECORDED,
      recordType: 'EmployeeLeaveEntry',
      recordId: row.id,
      description: dto.note.trim(),
      newValues: { entryType: row.entryType, entitlementType: row.entitlementType, hours: dto.hours, date: isoDay(row.date) },
      metadata: { employeeId },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { message: 'Leave entry recorded.', data: { id: row.id } };
  }

  /** Hours worked in each pay period of a span: the worker's payroll periods, or calendar months. */
  private async hoursByPayPeriod(employeeId: string, from: Date, to: Date) {
    const end = new Date(to.getTime() + 86_400_000);
    const [visits, profile] = await Promise.all([
      this.prisma.visitReconciliation.findMany({
        where: {
          employeeId,
          status: { in: [...PAY_APPROVED] },
          approvedPayStart: { gte: from, lt: end },
          payableMinutes: { gt: 0 },
        },
        select: { approvedPayStart: true, payableMinutes: true },
      }),
      this.prisma.employeePayrollProfile.findFirst({ where: { employeeId, deletedAt: null }, select: { scheduleId: true } }),
    ]);
    const periods = profile?.scheduleId
      ? await this.prisma.payrollPeriod.findMany({
          where: { scheduleId: profile.scheduleId, deletedAt: null, periodStart: { lte: to }, periodEnd: { gte: from } },
          select: { periodStart: true, periodEnd: true },
        })
      : [];
    const totals = new Map<string, number>();
    for (const visit of visits) {
      const day = isoDay(visit.approvedPayStart!);
      const period = periods.find((p) => isoDay(p.periodStart) <= day && day <= isoDay(p.periodEnd));
      const key = period ? isoDay(period.periodStart) : `${day.slice(0, 7)}-01`;
      totals.set(key, (totals.get(key) ?? 0) + (visit.payableMinutes ?? 0) / 60);
    }
    return {
      hours: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, hours]) => hours),
      basis: periods.length ? 'the periods of the payroll schedule' : 'calendar months (no payroll schedule periods found)',
    };
  }

  /** Pay and hours of each week from locked pay runs: the material of the 52-week average. */
  private async weeksOfPay(employeeId: string, before: Date) {
    const from = new Date(before.getTime() - 105 * 7 * 86_400_000);
    const lines = await this.prisma.payrollRunLine.findMany({
      where: {
        employeeId,
        lineType: { in: [...REMUNERATION_LINE_TYPES] as never },
        exceptionMessage: null,
        payrollRun: { status: { in: ['LOCKED', 'EXPORTED'] } },
        visitReconciliation: { approvedPayStart: { gte: from, lt: before } },
      },
      select: { amount: true, minutes: true, visitReconciliation: { select: { approvedPayStart: true } } },
    });
    const weeks = new Map<string, { pay: number; hours: number }>();
    for (const line of lines) {
      const key = weekStartKey(line.visitReconciliation!.approvedPayStart!);
      const week = weeks.get(key) ?? { pay: 0, hours: 0 };
      week.pay += Number(line.amount);
      week.hours += (line.minutes ?? 0) / 60;
      weeks.set(key, week);
    }
    return [...weeks.entries()].map(([weekKey, w]) => ({ weekKey, pay: w.pay, hours: w.hours }));
  }

  /**
   * Entitlement, what has been used, the balance and the holiday pay rate on a day. `leavingDate`
   * gives the position of a leaver: what was earned up to that day against what was taken.
   */
  async summary(employeeId: string, asOfIso?: string, leavingDateIso?: string) {
    await this.requireEmployee(employeeId);
    const asOf = dateOnly(leavingDateIso ?? asOfIso ?? new Date().toISOString());
    const termsRow = await this.termsInForce(employeeId, asOf);
    if (!termsRow) {
      return {
        message: 'No leave terms',
        data: {
          employeeId,
          asOf: isoDay(asOf),
          terms: null,
          note: 'No approved leave terms are in force for this employee on that day. Nothing is worked out: a holiday method is not assumed.',
        },
      };
    }
    const terms = this.toTerms(termsRow);
    const leaveYear = leaveYearFor(asOf, terms.leaveYearStartMonth, terms.leaveYearStartDay);
    const [employment, entries, worked] = await Promise.all([
      this.prisma.employeeEmployment.findFirst({ where: { employeeId }, select: { startDate: true, endDate: true } }),
      this.prisma.employeeLeaveEntry.findMany({ where: { employeeId, date: { gte: leaveYear.start, lte: leaveYear.end } } }),
      this.hoursByPayPeriod(employeeId, leaveYear.start, asOf < leaveYear.end ? asOf : leaveYear.end),
    ]);
    const dates = {
      startDate: employment?.startDate ?? null,
      endDate: leavingDateIso ? asOf : (employment?.endDate ?? null),
    };
    const earned = entitlementHours({ terms, leaveYear, employment: dates, hoursByPayPeriod: worked.hours, upTo: asOf });
    const fullYear = entitlementHours({ terms, leaveYear, employment: dates, hoursByPayPeriod: worked.hours });
    const movements = entries.map((e) => ({ entryType: e.entryType, entitlementType: e.entitlementType, hours: Number(e.hours) }));
    const statutory = leaveBalance(earned.statutoryHours, movements, 'STATUTORY');
    const contractual = leaveBalance(earned.contractualHours, movements, 'CONTRACTUAL');

    const rolledUp = terms.payMethod === 'ROLLED_UP_12_07';
    const reference = rolledUp ? null : normalRemuneration(await this.weeksOfPay(employeeId, asOf), weekStartKey(asOf));
    const hourly = reference?.averageHourlyPay ?? null;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      message: 'Leave position',
      data: {
        employeeId,
        asOf: isoDay(asOf),
        terms: { id: termsRow.id, ...terms, effectiveFrom: isoDay(termsRow.effectiveFrom) },
        leaveYear: { start: isoDay(leaveYear.start), end: isoDay(leaveYear.end) },
        // Earned up to the day, with the whole-year figure beside it for a regular-hours worker.
        statutory: { ...statutory, fullYearEntitlement: fullYear.statutoryHours, basis: earned.basis },
        contractual: { ...contractual, fullYearEntitlement: fullYear.contractualHours },
        accrualPeriods: worked.basis,
        holidayPay: rolledUp
          ? {
              method: terms.payMethod,
              averageHourlyPay: null,
              weeksUsed: null,
              note: 'Rolled-up holiday pay: paid with each pay run at 12.07% of pay for hours worked, so nothing further is paid when leave is taken.',
            }
          : {
              method: terms.payMethod,
              averageHourlyPay: hourly,
              averageWeeklyPay: reference?.averageWeeklyPay ?? null,
              weeksUsed: reference?.weeksUsed ?? 0,
              note:
                hourly == null
                  ? 'No paid weeks in the last 104 weeks: the rate cannot be worked out from pay history.'
                  : reference?.complete
                    ? 'Average of the last 52 paid weeks.'
                    : `Average of the ${reference?.weeksUsed} paid week(s) there are; fewer than 52.`,
            },
        carryOverAllowed: carryOverAllowed(statutory.balance + contractual.balance, terms.carryOverMaxHours),
        leaver: leavingDateIso
          ? {
              leavingDate: isoDay(asOf),
              untakenHours: round2(statutory.balance + contractual.balance),
              // Shown, never paid or recovered automatically.
              paymentInLieu:
                hourly != null && statutory.balance + contractual.balance > 0
                  ? round2((statutory.balance + contractual.balance) * hourly)
                  : null,
              takenMoreThanEarned: statutory.balance + contractual.balance < 0,
            }
          : null,
      },
    };
  }
}
