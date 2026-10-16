import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { assertDifferentUser } from '../billing/financial-controls.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import type { PensionAeEventDto, ProposeDeductionAdjustmentDto, ReviewDeductionAdjustmentDto } from './dto/payroll.dto';
import { dateToIsoDate } from './payroll-mapper.util';
import { parsePayrollDateOnly } from './payroll-period.util';

/**
 * Loan / pension completion (IMPLEMENTED BUT UNVERIFIED):
 * - maker/checker corrections of student loan, postgraduate loan and pension amounts already in a
 *   CLOSED run (the closed run is never rewritten; the approved difference is applied in the next
 *   run of the same tax year by the UK run's tax and NI step);
 * - automatic enrolment duty records (postponement, statutory notices, opt-in / joining requests,
 *   opt-out with refunds proposed for approval, ceasing membership, re-enrolment date);
 * - a provider-independent pension contribution export and reconciliation for one run.
 */
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
const addMonths = (d: Date, months: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));

type Kind = 'STUDENT_LOAN' | 'POSTGRADUATE_LOAN' | 'PENSION_EMPLOYEE' | 'PENSION_EMPLOYER';

function mapAdjustment(a: {
  id: string;
  employeeId: string;
  taxYearId: string;
  kind: string;
  sourceRunId: string;
  originalAmount: Prisma.Decimal;
  correctedAmount: Prisma.Decimal;
  amount: Prisma.Decimal;
  reason: string;
  evidenceRef: string;
  origin: string;
  status: string;
  proposedById: string;
  proposedAt: Date;
  reviewedById: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  appliedRunId: string | null;
  appliedAt: Date | null;
}) {
  return {
    id: a.id,
    employeeId: a.employeeId,
    taxYearId: a.taxYearId,
    kind: a.kind,
    sourceRunId: a.sourceRunId,
    originalAmount: num(a.originalAmount),
    correctedAmount: num(a.correctedAmount),
    amount: num(a.amount),
    reason: a.reason,
    evidenceRef: a.evidenceRef,
    origin: a.origin,
    status: a.status,
    proposedById: a.proposedById,
    proposedAt: a.proposedAt.toISOString(),
    reviewedById: a.reviewedById,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    reviewNote: a.reviewNote,
    appliedRunId: a.appliedRunId,
    appliedAt: a.appliedAt?.toISOString() ?? null,
  };
}

function mapAe(row: Record<string, unknown> | null) {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? (k.endsWith('At') ? v.toISOString() : dateToIsoDate(v)) : v;
  return out;
}

@Injectable()
export class PayrollLoanPensionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** The amount a closed run row posted for one kind (its own figure plus any correction applied in it). */
  private postedAmount(
    row: {
      studentLoanPlanApplied: string | null;
      studentLoanDeduction: Prisma.Decimal;
      studentLoanAdjustment: Prisma.Decimal;
      postgraduateLoanApplied: boolean | null;
      postgraduateLoanDeduction: Prisma.Decimal;
      postgraduateLoanAdjustment: Prisma.Decimal;
      pensionApplied: boolean | null;
      pensionEmployeeNet: Prisma.Decimal;
      pensionEmployeeAdjustment: Prisma.Decimal;
      pensionEmployer: Prisma.Decimal;
      pensionEmployerAdjustment: Prisma.Decimal;
    },
    kind: Kind,
  ): number | null {
    if (kind === 'STUDENT_LOAN') {
      return row.studentLoanPlanApplied == null ? null : round2(num(row.studentLoanDeduction) + num(row.studentLoanAdjustment));
    }
    if (kind === 'POSTGRADUATE_LOAN') {
      return row.postgraduateLoanApplied == null ? null : round2(num(row.postgraduateLoanDeduction) + num(row.postgraduateLoanAdjustment));
    }
    if (kind === 'PENSION_EMPLOYEE') {
      return row.pensionApplied == null ? null : round2(num(row.pensionEmployeeNet) + num(row.pensionEmployeeAdjustment));
    }
    return row.pensionApplied == null ? null : round2(num(row.pensionEmployer) + num(row.pensionEmployerAdjustment));
  }

  async listAdjustments(employeeId?: string) {
    const rows = await this.prisma.payrollDeductionAdjustment.findMany({
      where: employeeId ? { employeeId } : {},
      orderBy: { proposedAt: 'desc' },
      take: 500,
    });
    return { data: rows.map(mapAdjustment) };
  }

  /**
   * Propose a correction of an amount in a CLOSED run. Only refunds and reversals are applied by
   * payroll: an under-deduction is not recovered here and is refused as needing HMRC or employer
   * intervention. One live correction per run, employee and kind.
   */
  async proposeAdjustment(userId: string, dto: ProposeDeductionAdjustmentDto, meta?: RequestAuditMeta, origin = 'MANUAL_CORRECTION') {
    const row = await this.prisma.ukPayrollRunEmployee.findFirst({
      where: { runId: dto.sourceRunId, employeeId: dto.employeeId },
      include: { run: { select: { status: true, taxYearId: true, label: true } } },
    });
    if (!row) throw new NotFoundException('The employee is not on that payroll run');
    if (row.run.status !== 'CLOSED') {
      throw new BadRequestException('Only an amount in a CLOSED run is corrected this way; recalculate an open run instead');
    }
    const original = this.postedAmount(row, dto.kind);
    if (original == null) {
      throw new ConflictException('That run was calculated before this figure was recorded: historical detail unavailable, it cannot be corrected here');
    }
    const corrected = round2(dto.correctedAmount);
    if (corrected < 0) throw new BadRequestException('The corrected amount cannot be negative');
    const amount = round2(corrected - original);
    if (amount === 0) throw new BadRequestException('The corrected amount equals the amount in the run: nothing to correct');
    if (amount > 0) {
      throw new ConflictException(
        'An under-deduction is not recovered through payroll here: HMRC or employer intervention is required (for student loans HMRC says not to collect arrears).',
      );
    }
    const activeKey = `${dto.employeeId}|${dto.sourceRunId}|${dto.kind}`;
    const existing = await this.prisma.payrollDeductionAdjustment.findUnique({ where: { activeKey } });
    if (existing) {
      if (num(existing.correctedAmount) === corrected && existing.reason === dto.reason.trim()) {
        return { message: 'This correction was already proposed', duplicate: true, data: mapAdjustment(existing) };
      }
      throw new ConflictException('A correction of this amount in that run is already proposed or approved');
    }
    const saved = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payrollDeductionAdjustment.create({
        data: {
          employeeId: dto.employeeId,
          taxYearId: row.run.taxYearId,
          kind: dto.kind,
          sourceRunId: dto.sourceRunId,
          originalAmount: new Prisma.Decimal(original),
          correctedAmount: new Prisma.Decimal(corrected),
          amount: new Prisma.Decimal(amount),
          reason: dto.reason.trim(),
          evidenceRef: dto.evidenceRef.trim(),
          origin,
          proposedById: userId,
          activeKey,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_DEDUCTION_ADJUSTMENT_PROPOSED,
        recordType: 'PayrollDeductionAdjustment',
        recordId: created.id,
        newValues: mapAdjustment(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return created;
    });
    return { message: 'Correction proposed: a second person must approve it', duplicate: false, data: mapAdjustment(saved) };
  }

  /** Approve or reject a proposed correction (checker, not the proposer). */
  async reviewAdjustment(userId: string, id: string, dto: ReviewDeductionAdjustmentDto, meta?: RequestAuditMeta) {
    const row = await this.prisma.payrollDeductionAdjustment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Correction not found');
    if (row.status !== 'PROPOSED') throw new ConflictException(`This correction is already ${row.status.toLowerCase()}`);
    assertDifferentUser(row.proposedById, userId, 'A correction is approved or rejected by a different person from the one who proposed it');
    const approve = dto.decision === 'APPROVE';
    const saved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollDeductionAdjustment.update({
        where: { id },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          reviewedById: userId,
          reviewedAt: new Date(),
          reviewNote: dto.note?.trim() || null,
          ...(approve ? {} : { activeKey: null }),
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_DEDUCTION_ADJUSTMENT_REVIEWED,
        recordType: 'PayrollDeductionAdjustment',
        recordId: id,
        oldValues: mapAdjustment(row),
        newValues: mapAdjustment(updated),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return {
      message: approve
        ? 'Correction approved: it is applied when tax and NI are next calculated in a run of the same tax year'
        : 'Correction rejected',
      data: mapAdjustment(saved),
    };
  }

  async getPensionAe(employeeId: string) {
    const row = await this.prisma.employeePensionAe.findUnique({ where: { employeeId } });
    return { data: mapAe(row as unknown as Record<string, unknown> | null) };
  }

  /**
   * Record an automatic enrolment event. Postponement: up to three months from the deferral date,
   * with the postponement notice within six weeks of it. Opt-out: valid only from the membership
   * date to one month after the later of that date and the enrolment information; a valid opt-out
   * stops contributions and proposes refunds of the contributions already in closed runs (for a
   * second person to approve). A later request to leave is CEASE_MEMBERSHIP (no refund).
   */
  async recordPensionAeEvent(userId: string, employeeId: string, dto: PensionAeEventDto, meta?: RequestAuditMeta) {
    const profile = await this.prisma.employeePayrollProfile.findFirst({ where: { employeeId, deletedAt: null } });
    if (!profile) throw new NotFoundException('Payroll profile not found');
    const before = await this.prisma.employeePensionAe.findUnique({ where: { employeeId } });
    const date = parsePayrollDateOnly(dto.date);
    const data: Prisma.EmployeePensionAeUncheckedUpdateInput = {};
    let newStatus: string | null = null;
    let refundsFrom: Date | null = null;

    switch (dto.type) {
      case 'POSTPONEMENT': {
        if (!dto.endDate) throw new BadRequestException('A postponement needs its end date');
        const end = parsePayrollDateOnly(dto.endDate);
        if (end <= date || end > addMonths(date, 3)) {
          throw new BadRequestException('A postponement ends after the deferral date and no more than three months after it');
        }
        if (dto.noticeSentOn) {
          const sent = parsePayrollDateOnly(dto.noticeSentOn);
          if (sent > addDays(date, 42)) throw new BadRequestException('The postponement notice must be given within six weeks of the deferral date');
          data.postponementNoticeSentOn = sent;
        }
        data.postponementFrom = date;
        data.postponementEndsOn = end;
        break;
      }
      case 'ENROLMENT_NOTICE_SENT':
        data.enrolmentNoticeSentOn = date;
        break;
      case 'OPT_IN_REQUEST':
        data.optInRequestedOn = date;
        break;
      case 'JOINING_REQUEST':
        data.joiningRequestedOn = date;
        break;
      case 'RE_ENROLMENT_DUE':
        data.reEnrolmentDueOn = date;
        break;
      case 'OPT_OUT': {
        if (profile.pensionStatus !== 'ENROLLED' || !profile.pensionEnrolledFrom) {
          throw new BadRequestException('An opt-out is recorded only for someone enrolled, from their membership date');
        }
        if (!dto.evidenceRef?.trim()) throw new BadRequestException('Record the opt-out notice reference (from the scheme)');
        const member = profile.pensionEnrolledFrom;
        const informed = before?.enrolmentNoticeSentOn && before.enrolmentNoticeSentOn > member ? before.enrolmentNoticeSentOn : member;
        const windowEnd = addMonths(informed, 1);
        if (date < member || date > windowEnd) {
          throw new BadRequestException(
            `This opt-out is outside the opt-out period (${dateToIsoDate(member)} to ${dateToIsoDate(windowEnd)}). Record CEASE_MEMBERSHIP instead: contributions stop and nothing is refunded.`,
          );
        }
        data.optOutReceivedOn = date;
        data.optOutEvidenceRef = dto.evidenceRef.trim();
        newStatus = 'OPTED_OUT';
        refundsFrom = member;
        break;
      }
      case 'CEASE_MEMBERSHIP': {
        if (profile.pensionStatus !== 'ENROLLED') throw new BadRequestException('Only an enrolled member can cease membership');
        data.ceasedOn = date;
        newStatus = 'CEASED';
        break;
      }
      default:
        throw new BadRequestException('Unknown automatic enrolment event');
    }

    // A valid opt-out: refunds of what closed runs took since membership, proposed for approval.
    const refundRows = refundsFrom
      ? await this.prisma.ukPayrollRunEmployee.findMany({
          where: { employeeId, pensionApplied: true, run: { status: 'CLOSED', deletedAt: null } },
          include: { run: { select: { id: true, taxYearId: true, period: { select: { paymentDate: true, periodEnd: true } } } } },
        })
      : [];
    const openRuns = newStatus
      ? await this.prisma.ukPayrollRunEmployee.findMany({
          where: { employeeId, statutoryCalculatedAt: { not: null }, run: { status: 'STATUTORY_CALCULATED', deletedAt: null } },
          select: { runId: true },
        })
      : [];

    const result = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.employeePensionAe.upsert({
        where: { employeeId },
        create: { ...(data as Prisma.EmployeePensionAeUncheckedCreateInput), employeeId },
        update: data,
      });
      if (newStatus) {
        await tx.employeePayrollProfile.update({ where: { id: profile.id }, data: { pensionStatus: newStatus, updatedById: userId } });
        // Open runs calculated with the old status must be recalculated before they can close.
        const stale = [...new Set(openRuns.map((r) => r.runId))];
        if (stale.length) {
          await tx.ukPayrollRun.updateMany({
            where: { id: { in: stale }, status: 'STATUTORY_CALCULATED' },
            data: { status: 'GROSS_CALCULATED', statutoryCalculatedAt: null, statutoryBasis: null, updatedById: userId },
          });
          await tx.ukPayrollRunEmployee.updateMany({ where: { runId: { in: stale }, employeeId }, data: { statutoryCalculatedAt: null } });
        }
      }
      const proposed: string[] = [];
      for (const r of refundRows) {
        if ((r.run.period.paymentDate ?? r.run.period.periodEnd) < refundsFrom!) continue;
        for (const kind of ['PENSION_EMPLOYEE', 'PENSION_EMPLOYER'] as const) {
          const original = this.postedAmount(r, kind);
          if (!original) continue;
          const activeKey = `${employeeId}|${r.runId}|${kind}`;
          if (await tx.payrollDeductionAdjustment.findUnique({ where: { activeKey } })) continue;
          const created = await tx.payrollDeductionAdjustment.create({
            data: {
              employeeId,
              taxYearId: r.run.taxYearId,
              kind,
              sourceRunId: r.runId,
              originalAmount: new Prisma.Decimal(original),
              correctedAmount: new Prisma.Decimal(0),
              amount: new Prisma.Decimal(-original),
              reason: kind === 'PENSION_EMPLOYEE' ? 'Valid pension opt-out: refund of the employee contribution' : 'Valid pension opt-out: employer contribution reversed',
              evidenceRef: dto.evidenceRef!.trim(),
              origin: 'PENSION_OPT_OUT',
              proposedById: userId,
              activeKey,
            },
          });
          proposed.push(created.id);
        }
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_PENSION_AE_EVENT_RECORDED,
        recordType: 'EmployeePensionAe',
        recordId: saved.id,
        oldValues: { record: mapAe(before as unknown as Record<string, unknown> | null), pensionStatus: profile.pensionStatus },
        newValues: { event: dto.type, date: dto.date, record: mapAe(saved as unknown as Record<string, unknown>), pensionStatus: newStatus ?? profile.pensionStatus, refundsProposed: proposed },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      return { saved, proposed };
    });
    return {
      message:
        dto.type === 'OPT_OUT'
          ? `Opt-out recorded: contributions stop; ${result.proposed.length} refund/reversal correction(s) proposed for approval`
          : 'Automatic enrolment event recorded',
      data: mapAe(result.saved as unknown as Record<string, unknown>),
      refundsProposed: result.proposed,
    };
  }

  /**
   * Provider-independent contribution file for one run, from the stored payroll figures, with an
   * internal reconciliation (gross less net equals the relief; totals). No payment and no provider
   * connection.
   */
  async pensionContributions(runId: string) {
    const run = await this.prisma.ukPayrollRun.findUnique({ where: { id: runId }, include: { period: true } });
    if (!run) throw new NotFoundException('Payroll run not found');
    const rows = await this.prisma.ukPayrollRunEmployee.findMany({
      where: {
        runId,
        OR: [{ pensionApplied: true }, { pensionEmployeeAdjustment: { not: 0 } }, { pensionEmployerAdjustment: { not: 0 } }],
      },
      orderBy: { enrolledAt: 'asc' },
    });
    const people = await this.prisma.employee.findMany({
      where: { id: { in: rows.map((r) => r.employeeId) } },
      select: { id: true, employment: { select: { payrollNumber: true } }, personalDetail: { select: { firstName: true, lastName: true } } },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const status = run.status === 'CLOSED' ? 'FINAL' : run.status === 'CANCELLED' ? 'CANCELLED' : 'DRAFT';
    const lines = rows.map((r) => {
      const person = byId.get(r.employeeId);
      const gross = num(r.pensionEmployeeGross);
      const net = num(r.pensionEmployeeNet);
      const relief = num(r.pensionTaxRelief);
      return {
        employeeId: r.employeeId,
        name: `${person?.personalDetail?.firstName ?? ''} ${person?.personalDetail?.lastName ?? ''}`.trim(),
        payrollNumber: person?.employment?.payrollNumber ?? null,
        schemeRef: r.pensionSchemeRefApplied,
        periodStart: dateToIsoDate(run.period.periodStart),
        periodEnd: dateToIsoDate(run.period.periodEnd),
        paymentDate: dateToIsoDate(run.period.paymentDate),
        pensionablePay: num(r.pensionablePay),
        qualifyingEarnings: num(r.pensionQualifyingEarnings),
        employeeGross: gross,
        employeeNet: net,
        providerTaxRelief: relief,
        employer: num(r.pensionEmployer),
        employeeAdjustment: num(r.pensionEmployeeAdjustment),
        employerAdjustment: num(r.pensionEmployerAdjustment),
        status,
        issues: [
          r.pensionSchemeRefApplied ? null : 'scheme reference not recorded on this run',
          Math.abs(round2(gross - net) - relief) > 0.005 ? 'gross less net does not equal the provider relief' : null,
        ].filter(Boolean) as string[],
      };
    });
    const sum = (k: keyof (typeof lines)[number]) => round2(lines.reduce((s, l) => s + (l[k] as number), 0));
    const totals = {
      employees: lines.length,
      qualifyingEarnings: sum('qualifyingEarnings'),
      employeeGross: sum('employeeGross'),
      employeeNet: sum('employeeNet'),
      providerTaxRelief: sum('providerTaxRelief'),
      employer: sum('employer'),
      employeeAdjustment: sum('employeeAdjustment'),
      employerAdjustment: sum('employerAdjustment'),
    };
    const header = ['payrollNumber', 'name', 'schemeRef', 'periodStart', 'periodEnd', 'paymentDate', 'pensionablePay', 'qualifyingEarnings', 'employeeGross', 'employeeNet', 'providerTaxRelief', 'employer', 'employeeAdjustment', 'employerAdjustment', 'status'];
    const cell = (v: unknown) => {
      const t = v == null ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [header.join(','), ...lines.map((l) => header.map((h) => cell((l as Record<string, unknown>)[h])).join(','))].join('\n');
    return {
      message: 'Pension contributions (no payment is made and nothing is sent to a provider)',
      data: {
        runId,
        runLabel: run.label,
        status,
        lines,
        totals,
        reconciled: lines.every((l) => l.issues.length === 0),
        csv,
      },
    };
  }
}
