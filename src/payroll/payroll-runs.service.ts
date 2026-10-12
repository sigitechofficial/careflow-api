import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  allowFinancialResetInTransaction,
  assertDifferentUser,
  assertFinancialResetEnvironment,
} from '../billing/financial-controls.util';
import { isClaimConflict } from '../billing/payroll-claim.util';
import { CreateUkPayrollRunDto, EnrolUkPayrollRunDto } from './dto/payroll.dto';
import { employeeIdsForLocation } from '../billing/billing-location-scope.util';
import { dateToIsoDate, mapEmployerSettings, mapPeriod, mapSchedule, mapTaxYear } from './payroll-mapper.util';
import {
  accumulateGrossLine,
  emptyGrossBucket,
  finalizeGrossBucket,
  isExpenseLineType,
  prorateAnnualSalary,
  round2,
  salaryMonthKeysForPeriod,
  toDecimal,
} from './payroll-gross.util';
import { ensureEnglandStatutoryRateSet } from './payroll-statutory-rates.seed';
import {
  calculatePeriodStatutory,
  taxYearPeriodNumber,
  type PayFrequencyCode,
  type StatutoryRateSnapshot,
} from './payroll-statutory.util';
import {
  assessRtiIdentityCompleteness,
} from './payroll-rti-identity.util';
import {
  mapYtdLedger,
  postRunEmployeesToYtd,
  reverseRunEmployeesFromYtd,
} from './payroll-ytd.util';
import { buildCareFpsPayload } from './payroll-fps.util';
import { buildFpsPreviewExcelBuffer } from './payroll-fps-excel.util';
import { isPayrollHoursNormallyWorked } from './payroll-hours-normally-worked.util';
import { buildPayslipPdf } from './payroll-payslip-pdf.util';
import {
  buildCarePayslipData,
  buildPayslipPeriodCaption,
  payFrequencyLabel,
  payslipPdfFilename,
  resolvePayslipBankPayment,
} from './payroll-payslip.util';
import { PAYROLL_EMPLOYER_SETTINGS_ID } from './payroll-settings.service';

const OPEN_RUN_STATUSES = [
  'DRAFT',
  'EMPLOYEES_ENROLLED',
  'GROSS_CALCULATED',
  'STATUTORY_CALCULATED',
] as const;

function decimalNum(v: Prisma.Decimal | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === 'number' ? v : Number(v);
}

function mapRun(row: {
  id: string;
  periodId: string;
  taxYearId: string;
  scheduleId: string;
  runNumber: number;
  label: string;
  status: string;
  employeeCount: number;
  totalGross?: Prisma.Decimal | number;
  totalExpenses?: Prisma.Decimal | number;
  grossCalculatedAt?: Date | null;
  totalIncomeTax?: Prisma.Decimal | number;
  totalEmployeeNi?: Prisma.Decimal | number;
  totalEmployerNi?: Prisma.Decimal | number;
  totalNetPay?: Prisma.Decimal | number;
  statutoryCalculatedAt?: Date | null;
  statutoryBasis?: string | null;
  currency: string;
  notes: string | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    periodId: row.periodId,
    taxYearId: row.taxYearId,
    scheduleId: row.scheduleId,
    runNumber: row.runNumber,
    label: row.label,
    status: row.status,
    employeeCount: row.employeeCount,
    totalGross: decimalNum(row.totalGross),
    totalExpenses: decimalNum(row.totalExpenses),
    grossCalculatedAt: row.grossCalculatedAt?.toISOString() ?? null,
    totalIncomeTax: decimalNum(row.totalIncomeTax),
    totalEmployeeNi: decimalNum(row.totalEmployeeNi),
    totalEmployerNi: decimalNum(row.totalEmployerNi),
    totalNetPay: decimalNum(row.totalNetPay),
    statutoryCalculatedAt: row.statutoryCalculatedAt?.toISOString() ?? null,
    statutoryBasis: row.statutoryBasis ?? null,
    currency: row.currency,
    notes: row.notes,
    closedAt: row.closedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rateSetToSnapshot(row: {
  personalAllowanceAnnual: Prisma.Decimal | number;
  basicRateBandAnnual: Prisma.Decimal | number;
  higherRateThresholdAnnual: Prisma.Decimal | number;
  additionalRateThresholdAnnual: Prisma.Decimal | number;
  basicRatePercent: Prisma.Decimal | number;
  higherRatePercent: Prisma.Decimal | number;
  additionalRatePercent: Prisma.Decimal | number;
  niLelWeekly: Prisma.Decimal | number;
  niPtWeekly: Prisma.Decimal | number;
  niStWeekly: Prisma.Decimal | number;
  niUelWeekly: Prisma.Decimal | number;
  niLelMonthly: Prisma.Decimal | number;
  niPtMonthly: Prisma.Decimal | number;
  niStMonthly: Prisma.Decimal | number;
  niUelMonthly: Prisma.Decimal | number;
  niEmployeeRateMainPercent: Prisma.Decimal | number;
  niEmployeeRateUpperPercent: Prisma.Decimal | number;
  niEmployerRatePercent: Prisma.Decimal | number;
}): StatutoryRateSnapshot {
  return {
    personalAllowanceAnnual: decimalNum(row.personalAllowanceAnnual),
    basicRateBandAnnual: decimalNum(row.basicRateBandAnnual),
    higherRateThresholdAnnual: decimalNum(row.higherRateThresholdAnnual),
    additionalRateThresholdAnnual: decimalNum(row.additionalRateThresholdAnnual),
    basicRatePercent: decimalNum(row.basicRatePercent),
    higherRatePercent: decimalNum(row.higherRatePercent),
    additionalRatePercent: decimalNum(row.additionalRatePercent),
    niLelWeekly: decimalNum(row.niLelWeekly),
    niPtWeekly: decimalNum(row.niPtWeekly),
    niStWeekly: decimalNum(row.niStWeekly),
    niUelWeekly: decimalNum(row.niUelWeekly),
    niLelMonthly: decimalNum(row.niLelMonthly),
    niPtMonthly: decimalNum(row.niPtMonthly),
    niStMonthly: decimalNum(row.niStMonthly),
    niUelMonthly: decimalNum(row.niUelMonthly),
    niEmployeeRateMainPercent: decimalNum(row.niEmployeeRateMainPercent),
    niEmployeeRateUpperPercent: decimalNum(row.niEmployeeRateUpperPercent),
    niEmployerRatePercent: decimalNum(row.niEmployerRatePercent),
  };
}

type DraftInputLine = {
  id: string;
  runId: string;
  runEmployeeId: string;
  employeeId: string;
  sourceType: 'BILLING_PAYROLL_LINE' | 'VISIT_RECONCILIATION' | 'PAY_AGREEMENT_SALARY' | 'SALARY_DEDUCTION';
  sourcePayrollRunId: string | null;
  sourcePayrollRunLineId: string | null;
  sourceVisitReconciliationId: string | null;
  sourceSalaryDeductionId: string | null;
  lineType: string;
  description: string;
  minutes: number | null;
  amount: number;
  isExpense: boolean;
  isProvisional: boolean;
  /** Claim on the earning (see UkPayrollInputLine.claimKey); null for provisional visits. */
  claimKey: string | null;
  /** A reimbursement whose tax treatment nobody has verified (TR-13). Not stored on the line. */
  notVerified?: boolean;
};

/** Times gross collection reselects when another run claims some of the same earnings mid-flight. */
const GROSS_CLAIM_RETRIES = 3;

@Injectable()
export class PayrollRunsService {
  private readonly logger = new Logger(PayrollRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(locationId?: string) {
    const where: Prisma.UkPayrollRunWhereInput = { deletedAt: null };
    if (locationId) {
      const empIds = await employeeIdsForLocation(this.prisma, locationId);
      where.OR = [
        { employees: { none: {} } },
        ...(empIds.length
          ? [{ employees: { some: { employeeId: { in: empIds } } } }]
          : []),
      ];
    }

    const rows = await this.prisma.ukPayrollRun.findMany({
      where,
      include: {
        period: true,
        schedule: true,
        taxYear: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      message: 'UK payroll runs',
      data: rows.map((r) => ({
        ...mapRun(r),
        period: mapPeriod(r.period),
        schedule: mapSchedule(r.schedule),
        taxYear: mapTaxYear(r.taxYear),
      })),
    };
  }

  /**
   * Index of downloadable payslips from CLOSED runs (statutory calculated employees).
   */
  async listPayslips(locationId?: string) {
    const locationEmpIds = locationId
      ? await employeeIdsForLocation(this.prisma, locationId)
      : undefined;
    if (locationId && locationEmpIds && !locationEmpIds.length) {
      return { message: 'UK payroll payslips', data: [] };
    }

    const runEmployees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: {
        statutoryCalculatedAt: { not: null },
        ...(locationEmpIds ? { employeeId: { in: locationEmpIds } } : {}),
        run: { status: 'CLOSED', deletedAt: null },
      },
      include: {
        run: {
          include: {
            period: true,
            schedule: true,
            taxYear: true,
          },
        },
      },
      orderBy: [{ run: { period: { paymentDate: 'desc' } } }, { enrolledAt: 'asc' }],
    });

    const employeeIds = [...new Set(runEmployees.map((e) => e.employeeId))];
    const runEmployeeIds = runEmployees.map((e) => e.id);
    const [people, payoutLines] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds }, deletedAt: null },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
              employment: { select: { payrollNumber: true } },
            },
          })
        : Promise.resolve([]),
      runEmployeeIds.length
        ? this.prisma.employeePayoutLine.findMany({
            where: { ukPayrollRunEmployeeId: { in: runEmployeeIds } },
            select: {
              ukPayrollRunEmployeeId: true,
              status: true,
              createdAt: true,
              batch: { select: { status: true, paidAt: true } },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ]);
    const peopleById = new Map(people.map((p) => [p.id, p]));
    const payoutByRunEmployeeId = new Map<
      string,
      { lineStatus: string; batchStatus: string; paidAt: string | null }
    >();
    for (const line of payoutLines) {
      if (payoutByRunEmployeeId.has(line.ukPayrollRunEmployeeId)) continue;
      payoutByRunEmployeeId.set(line.ukPayrollRunEmployeeId, {
        lineStatus: line.status,
        batchStatus: line.batch.status,
        paidAt: line.batch.paidAt?.toISOString() ?? null,
      });
    }

    return {
      message: 'UK payroll payslips',
      data: runEmployees.map((e) => {
        const person = peopleById.get(e.employeeId);
        const first = person?.personalDetail?.firstName ?? '';
        const last = person?.personalDetail?.lastName ?? '';
        const bank = resolvePayslipBankPayment(
          payoutByRunEmployeeId.get(e.id) ?? null,
        );
        return {
          runEmployeeId: e.id,
          ukPayrollRunId: e.runId,
          employeeId: e.employeeId,
          displayName: `${first} ${last}`.trim() || e.employeeId,
          payrollNumber: person?.employment?.payrollNumber ?? null,
          runLabel: e.run.label,
          periodLabel: e.run.period.label,
          periodStart: dateToIsoDate(e.run.period.periodStart),
          periodEnd: dateToIsoDate(e.run.period.periodEnd),
          paymentDate: dateToIsoDate(e.run.period.paymentDate),
          taxYearCode: e.run.taxYear.code,
          scheduleName: e.run.schedule.name,
          frequency: e.run.schedule.frequency,
          frequencyLabel: payFrequencyLabel(e.run.schedule.frequency),
          periodCaption: buildPayslipPeriodCaption({
            frequency: e.run.schedule.frequency,
            periodLabel: e.run.period.label,
            periodStart: dateToIsoDate(e.run.period.periodStart) ?? '',
            periodEnd: dateToIsoDate(e.run.period.periodEnd) ?? '',
          }),
          totalGross: decimalNum(e.totalGross),
          incomeTax: decimalNum(e.incomeTax),
          employeeNi: decimalNum(e.employeeNi),
          netPay: decimalNum(e.netPay),
          taxCodeApplied: e.taxCodeApplied,
          niCategoryApplied: e.niCategoryApplied,
          bankStatus: bank.bankStatus,
          bankStatusLabel: bank.bankStatusLabel,
          bankPaidAt: bank.paidAt,
        };
      }),
    };
  }

  /** Resolve payslip PDF via run-employee id (CLOSED run only). */
  async exportPayslipByRunEmployeeId(
    runEmployeeId: string,
    userId?: string,
    meta?: RequestAuditMeta,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const runEmployee = await this.prisma.ukPayrollRunEmployee.findFirst({
      where: { id: runEmployeeId },
      select: { id: true, runId: true },
    });
    if (!runEmployee) {
      throw new NotFoundException('Payslip employee row not found');
    }
    return this.exportEmployeePayslip(runEmployee.runId, runEmployee.id, userId, meta);
  }

  /**
   * Test/ops: hard-delete all UK payroll runs and dependent rows.
   * Also removes employee payout batches that reference those runs (FK Restrict).
   * Reopens pay periods (IN_RUN / CLOSED → OPEN) so they can be selected again.
   * Clears the year-to-date (YTD) ledgers and per-run contributions — since every
   * run is being wiped, cumulative PAYE totals must reset to zero, otherwise
   * employee Gross/Tax/NI YTD would stay inflated behind runs that no longer exist.
   * Leaves tax years, schedules, and employee payroll profiles intact.
   */
  async deleteAll(userId: string, meta?: RequestAuditMeta) {
    // Test reset only: refused in production and unless the server opts in (SI-06).
    assertFinancialResetEnvironment();
    const counts = await this.prisma.$transaction(async (tx) => {
      await allowFinancialResetInTransaction(tx);
      // Visits these runs settled as provisional inputs are payable again once the runs are gone.
      await tx.visitReconciliation.updateMany({
        where: { paidByUkPayrollRunId: { not: null } },
        data: { paidByUkPayrollRunId: null, lockedAt: null },
      });
      // Payout batches FK → UkPayrollRun (Restrict)
      const payoutLines = await tx.employeePayoutLine.deleteMany({});
      const payoutBatches = await tx.employeePayoutBatch.deleteMany({});
      const inputLines = await tx.ukPayrollInputLine.deleteMany({});
      const runEmployees = await tx.ukPayrollRunEmployee.deleteMany({});
      const runs = await tx.ukPayrollRun.deleteMany({});
      // Clear both the per-run YTD contributions and the accumulated ledgers so
      // cumulative PAYE starts fresh (deleting ledgers alone would cascade the
      // contributions, but removing them explicitly gives an accurate count).
      const ytdContributions = await tx.employeePayrollYtdContribution.deleteMany({});
      const ytdLedgers = await tx.employeePayrollYtdLedger.deleteMany({});
      const periodsReopened = await tx.payrollPeriod.updateMany({
        where: {
          deletedAt: null,
          status: { in: ['IN_RUN', 'CLOSED'] },
        },
        data: {
          status: 'OPEN',
          updatedById: userId,
        },
      });
      return {
        payoutLines: payoutLines.count,
        payoutBatches: payoutBatches.count,
        inputLines: inputLines.count,
        runEmployees: runEmployees.count,
        runs: runs.count,
        ytdContributions: ytdContributions.count,
        ytdLedgers: ytdLedgers.count,
        periodsReopened: periodsReopened.count,
      };
    });

    this.logger.warn(
      `Deleted all UK payroll runs: ${counts.runs} run(s), ${counts.payoutBatches} payout batch(es), ` +
        `${counts.ytdLedgers} YTD ledger(s) reset, ${counts.periodsReopened} period(s) reopened`,
    );

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_RUNS_DELETED,
      recordType: 'UkPayrollRun',
      recordId: 'all',
      newValues: counts,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: 'All UK payroll runs deleted',
      data: counts,
    };
  }

  async getById(id: string, locationId?: string) {
    const row = await this.requireRun(id);
    const locationEmpIds = locationId
      ? await employeeIdsForLocation(this.prisma, locationId)
      : undefined;
    if (locationId && locationEmpIds && !locationEmpIds.length) {
      return {
        message: 'UK payroll run',
        data: {
          ...mapRun(row),
          period: mapPeriod(row.period),
          schedule: mapSchedule(row.schedule),
          taxYear: mapTaxYear(row.taxYear),
          employees: [],
        },
      };
    }

    const employees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: {
        runId: id,
        ...(locationEmpIds ? { employeeId: { in: locationEmpIds } } : {}),
      },
      orderBy: { enrolledAt: 'asc' },
    });
    const employeeIds = employees.map((e) => e.employeeId);
    const [people, inputLines] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds }, deletedAt: null },
            select: {
              id: true,
              personalDetail: { select: { firstName: true, lastName: true } },
              employment: { select: { payrollNumber: true } },
            },
          })
        : Promise.resolve([]),
      this.prisma.ukPayrollInputLine.findMany({
        where: { runId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const peopleById = new Map(people.map((p) => [p.id, p]));
    const linesByEmployee = new Map<string, typeof inputLines>();
    for (const line of inputLines) {
      const list = linesByEmployee.get(line.runEmployeeId) ?? [];
      list.push(line);
      linesByEmployee.set(line.runEmployeeId, list);
    }

    const ytdRows = employeeIds.length
      ? await this.prisma.employeePayrollYtdLedger.findMany({
          where: {
            taxYearId: row.taxYearId,
            employeeId: { in: employeeIds },
          },
        })
      : [];
    const ytdByEmployee = new Map(ytdRows.map((y) => [y.employeeId, mapYtdLedger(y)]));

    return {
      message: 'UK payroll run',
      data: {
        ...mapRun(row),
        period: mapPeriod(row.period),
        schedule: mapSchedule(row.schedule),
        taxYear: mapTaxYear(row.taxYear),
        employees: employees.map((e) => {
          const person = peopleById.get(e.employeeId);
          const first = person?.personalDetail?.firstName ?? '';
          const last = person?.personalDetail?.lastName ?? '';
          const lines = linesByEmployee.get(e.id) ?? [];
          return {
            id: e.id,
            employeeId: e.employeeId,
            payAgreementId: e.payAgreementId,
            enrolledAt: e.enrolledAt.toISOString(),
            notes: e.notes,
            displayName: `${first} ${last}`.trim() || e.employeeId,
            payrollNumber: person?.employment?.payrollNumber ?? null,
            visitPay: decimalNum(e.visitPay),
            salaryPay: decimalNum(e.salaryPay),
            travelPay: decimalNum(e.travelPay),
            nmwTopUp: decimalNum(e.nmwTopUp),
            otherPay: decimalNum(e.otherPay),
            expenseTotal: decimalNum(e.expenseTotal),
            reimbursementPayable: decimalNum(e.reimbursementPayable),
            expenseNotVerified: decimalNum(e.expenseNotVerified),
            totalPayable: round2(decimalNum(e.netPay) + decimalNum(e.reimbursementPayable)),
            deductionTotal: decimalNum(e.deductionTotal),
            totalGross: decimalNum(e.totalGross),
            inputLineCount: e.inputLineCount,
            hasProvisionalInputs: e.hasProvisionalInputs,
            grossCalculatedAt: e.grossCalculatedAt?.toISOString() ?? null,
            taxablePay: decimalNum(e.taxablePay),
            incomeTax: decimalNum(e.incomeTax),
            employeeNi: decimalNum(e.employeeNi),
            employerNi: decimalNum(e.employerNi),
            netPay: decimalNum(e.netPay),
            taxCodeApplied: e.taxCodeApplied,
            niCategoryApplied: e.niCategoryApplied,
            statutoryExplanation: e.statutoryExplanation,
            statutoryCalculatedAt: e.statutoryCalculatedAt?.toISOString() ?? null,
            ytd: ytdByEmployee.get(e.employeeId) ?? null,
            inputLines: lines.map((l) => ({
              id: l.id,
              sourceType: l.sourceType,
              lineType: l.lineType,
              description: l.description,
              minutes: l.minutes,
              amount: decimalNum(l.amount),
              isExpense: l.isExpense,
              isProvisional: l.isProvisional,
              sourcePayrollRunId: l.sourcePayrollRunId,
              sourcePayrollRunLineId: l.sourcePayrollRunLineId,
              sourceVisitReconciliationId: l.sourceVisitReconciliationId,
            })),
          };
        }),
        phaseNote:
          'Cumulative PAYE by default using YTD ledgers (T06/T07). Week 1/Month 1 when the employee flag is set (or BR/D0/D1). Closing posts YTD. Closed runs can preview FPS and dry-run / TEST-submit GovTalk (T16). Live HMRC send is T18.',
      },
    };
  }

  /**
   * Build a Care-owned FPS preview JSON from a CLOSED run (GovTalk submit is T16).
   */
  async buildFpsPreview(runId: string) {
    const row = await this.requireRun(runId);
    if (row.status !== 'CLOSED') {
      throw new BadRequestException(
        'FPS preview is only available for CLOSED runs. Close the run after statutory calculation first.',
      );
    }

    const employees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: { runId },
      orderBy: { enrolledAt: 'asc' },
    });
    const employeeIds = employees.map((e) => e.employeeId);

    const [employerRow, people, profiles, ytdRows] = await Promise.all([
      this.prisma.payrollEmployerSettings.findUnique({
        where: { id: PAYROLL_EMPLOYER_SETTINGS_ID },
      }),
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: { id: { in: employeeIds }, deletedAt: null },
            select: {
              id: true,
              personalDetail: {
                select: {
                  firstName: true,
                  lastName: true,
                  dateOfBirth: true,
                  addressLine1: true,
                  addressLine2: true,
                  town: true,
                  county: true,
                  country: true,
                  postcode: true,
                  gender: { select: { name: true } },
                },
              },
              employment: {
                select: {
                  payrollNumber: true,
                  nationalInsuranceNo: true,
                  startDate: true,
                  endDate: true,
                  contractedWeeklyHours: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? this.prisma.employeePayrollProfile.findMany({
            where: { employeeId: { in: employeeIds }, deletedAt: null },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? this.prisma.employeePayrollYtdLedger.findMany({
            where: {
              taxYearId: row.taxYearId,
              employeeId: { in: employeeIds },
            },
          })
        : Promise.resolve([]),
    ]);

    if (!employerRow) {
      throw new BadRequestException(
        'Employer PAYE settings not found. Configure them under Payroll → Employer PAYE.',
      );
    }

    const employer = mapEmployerSettings(employerRow);
    const profileByEmployee = new Map(profiles.map((p) => [p.employeeId, p]));
    const ytdByEmployee = new Map(ytdRows.map((y) => [y.employeeId, mapYtdLedger(y)]));
    const period = mapPeriod(row.period);
    const schedule = mapSchedule(row.schedule);
    const taxYear = mapTaxYear(row.taxYear);

    const payload = buildCareFpsPayload({
      run: {
        id: row.id,
        status: row.status,
        totalGross: decimalNum(row.totalGross),
        totalIncomeTax: decimalNum(row.totalIncomeTax),
        totalEmployeeNi: decimalNum(row.totalEmployeeNi),
        totalEmployerNi: decimalNum(row.totalEmployerNi),
        totalNetPay: decimalNum(row.totalNetPay),
        taxYearCode: taxYear.code,
        periodSequence: period.sequence,
        periodStart: period.periodStart!,
        periodEnd: period.periodEnd!,
        paymentDate: period.paymentDate!,
        payFrequency: schedule.frequency,
      },
      employer: {
        hmrcOfficeNumber: employer.hmrcOfficeNumber,
        employerPayeReference: employer.employerPayeReference,
        accountsOfficeReference: employer.accountsOfficeReference,
        employerTradingName: employer.employerTradingName,
        fullPayeReference: employer.fullPayeReference,
        isComplete: employer.isComplete,
      },
      identities: people.map((p) => ({
        employeeId: p.id,
        firstName: p.personalDetail?.firstName ?? null,
        lastName: p.personalDetail?.lastName ?? null,
        dateOfBirth: p.personalDetail?.dateOfBirth ?? null,
        genderName: p.personalDetail?.gender?.name ?? null,
        addressLine1: p.personalDetail?.addressLine1 ?? null,
        addressLine2: p.personalDetail?.addressLine2 ?? null,
        town: p.personalDetail?.town ?? null,
        county: p.personalDetail?.county ?? null,
        country: p.personalDetail?.country ?? null,
        postcode: p.personalDetail?.postcode ?? null,
        nationalInsuranceNo: p.employment?.nationalInsuranceNo ?? null,
        payrollNumber: p.employment?.payrollNumber ?? null,
        startDate: p.employment?.startDate ?? null,
        endDate: p.employment?.endDate ?? null,
        contractedWeeklyHours: p.employment?.contractedWeeklyHours ?? null,
      })),
      employees: employees.map((e) => {
        const profile = profileByEmployee.get(e.employeeId);
        const ytd = ytdByEmployee.get(e.employeeId) ?? null;
        return {
          employeeId: e.employeeId,
          totalGross: decimalNum(e.totalGross),
          taxablePay: decimalNum(e.taxablePay),
          incomeTax: decimalNum(e.incomeTax),
          employeeNi: decimalNum(e.employeeNi),
          employerNi: decimalNum(e.employerNi),
          netPay: decimalNum(e.netPay),
          taxCodeApplied: e.taxCodeApplied,
          niCategoryApplied: e.niCategoryApplied,
          week1Month1: profile?.taxCodeWeek1Month1 ?? false,
          starterDeclaration: profile?.starterDeclaration ?? null,
          hoursNormallyWorked: isPayrollHoursNormallyWorked(profile?.hoursNormallyWorked)
            ? profile.hoursNormallyWorked
            : null,
          p45Received: Boolean(profile?.p45Received),
          ytd: ytd
            ? {
                grossPayYtd: ytd.grossPayYtd,
                taxablePayYtd: ytd.taxablePayYtd,
                incomeTaxYtd: ytd.incomeTaxYtd,
                employeeNiYtd: ytd.employeeNiYtd,
                employerNiYtd: ytd.employerNiYtd,
                netPayYtd: ytd.netPayYtd,
              }
            : null,
        };
      }),
      gatewayCredentialsReady: employer.gatewayCredentialsReady,
    });

    return {
      message: 'FPS preview payload (Care schema — not submitted to HMRC)',
      data: payload,
    };
  }

  /** Human-readable FPS workbook for HMRC gateway (companion to GovTalk XML). */
  async exportFpsExcel(runId: string): Promise<{ buffer: Buffer; filename: string }> {
    const preview = await this.buildFpsPreview(runId);
    const buffer = await buildFpsPreviewExcelBuffer(preview.data);
    return {
      buffer,
      filename: `care-fps-${runId.slice(0, 8)}.xlsx`,
    };
  }

  /**
   * ERA 1996 s.8 itemised pay statement PDF for one CLOSED-run employee.
   */
  async exportEmployeePayslip(
    runId: string,
    runEmployeeId: string,
    userId?: string,
    meta?: RequestAuditMeta,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.requireRun(runId);
    if (row.status !== 'CLOSED') {
      throw new BadRequestException(
        'Payslips are only available for CLOSED runs. Close the run after statutory calculation first.',
      );
    }

    const runEmployee = await this.prisma.ukPayrollRunEmployee.findFirst({
      where: { id: runEmployeeId, runId },
    });
    if (!runEmployee) {
      throw new NotFoundException('Employee not found on this UK payroll run');
    }
    if (!runEmployee.statutoryCalculatedAt) {
      throw new BadRequestException(
        'Statutory tax & NI have not been calculated for this employee. Recalculate statutory before downloading a payslip.',
      );
    }

    const [employerRow, person, ytd, inputLines, payoutLine] = await Promise.all([
      this.prisma.payrollEmployerSettings.findUnique({
        where: { id: PAYROLL_EMPLOYER_SETTINGS_ID },
      }),
      this.prisma.employee.findFirst({
        where: { id: runEmployee.employeeId, deletedAt: null },
        select: {
          id: true,
          personalDetail: { select: { firstName: true, lastName: true } },
          employment: {
            select: { payrollNumber: true, nationalInsuranceNo: true },
          },
        },
      }),
      this.prisma.employeePayrollYtdLedger.findUnique({
        where: {
          employeeId_taxYearId: {
            employeeId: runEmployee.employeeId,
            taxYearId: row.taxYearId,
          },
        },
      }),
      this.prisma.ukPayrollInputLine.findMany({
        where: { runEmployeeId: runEmployee.id, isExpense: false },
        select: { minutes: true },
      }),
      this.prisma.employeePayoutLine.findFirst({
        where: { ukPayrollRunEmployeeId: runEmployee.id },
        select: {
          status: true,
          batch: { select: { status: true, paidAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    if (!person) {
      throw new NotFoundException('Employee record not found');
    }

    const employer = employerRow
      ? mapEmployerSettings(employerRow)
      : {
          employerTradingName: null as string | null,
          fullPayeReference: null as string | null,
          accountsOfficeReference: null as string | null,
        };

    const first = person.personalDetail?.firstName ?? '';
    const last = person.personalDetail?.lastName ?? '';
    const displayName = `${first} ${last}`.trim() || runEmployee.employeeId;
    const paidMinutes = inputLines.reduce((sum, line) => sum + (line.minutes ?? 0), 0);

    const payslip = buildCarePayslipData({
      run: { id: row.id, status: row.status },
      runEmployee: {
        id: runEmployee.id,
        employeeId: runEmployee.employeeId,
        visitPay: decimalNum(runEmployee.visitPay),
        salaryPay: decimalNum(runEmployee.salaryPay),
        travelPay: decimalNum(runEmployee.travelPay),
        nmwTopUp: decimalNum(runEmployee.nmwTopUp),
        otherPay: decimalNum(runEmployee.otherPay),
        expenseTotal: decimalNum(runEmployee.expenseTotal),
        reimbursementPayable: decimalNum(runEmployee.reimbursementPayable),
        expenseNotVerified: decimalNum(runEmployee.expenseNotVerified),
        deductionTotal: decimalNum(runEmployee.deductionTotal),
        totalGross: decimalNum(runEmployee.totalGross),
        taxablePay: decimalNum(runEmployee.taxablePay),
        incomeTax: decimalNum(runEmployee.incomeTax),
        employeeNi: decimalNum(runEmployee.employeeNi),
        employerNi: decimalNum(runEmployee.employerNi),
        netPay: decimalNum(runEmployee.netPay),
        taxCodeApplied: runEmployee.taxCodeApplied,
        niCategoryApplied: runEmployee.niCategoryApplied,
      },
      employee: {
        displayName,
        payrollNumber: person.employment?.payrollNumber ?? null,
        nationalInsuranceNo: person.employment?.nationalInsuranceNo ?? null,
      },
      employer: {
        employerTradingName: employer.employerTradingName,
        fullPayeReference: employer.fullPayeReference,
        accountsOfficeReference: employer.accountsOfficeReference,
      },
      period: {
        taxYearCode: row.taxYear.code,
        taxYearLabel: row.taxYear.label,
        scheduleName: row.schedule.name,
        frequency: row.schedule.frequency,
        periodLabel: row.period.label,
        periodStart: dateToIsoDate(row.period.periodStart)!,
        periodEnd: dateToIsoDate(row.period.periodEnd)!,
        paymentDate: dateToIsoDate(row.period.paymentDate)!,
      },
      paidMinutes,
      ytd: ytd ? mapYtdLedger(ytd) : null,
      bankPayment: payoutLine
        ? {
            lineStatus: payoutLine.status,
            batchStatus: payoutLine.batch.status,
            paidAt: payoutLine.batch.paidAt?.toISOString() ?? null,
          }
        : null,
    });

    const buffer = await buildPayslipPdf(payslip);
    const filename = payslipPdfFilename(payslip);

    if (userId) {
      await this.audit.logAudit({
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_PAYSLIP_DOWNLOADED,
        recordType: 'UkPayrollRunEmployee',
        recordId: runEmployee.id,
        newValues: {
          ukPayrollRunId: row.id,
          employeeId: runEmployee.employeeId,
          paymentDate: payslip.period.paymentDate,
          netPay: payslip.totals.netPay,
          filename,
        },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    }

    return { buffer, filename };
  }

  async create(userId: string, dto: CreateUkPayrollRunDto, meta?: RequestAuditMeta) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: dto.periodId, deletedAt: null },
      include: { schedule: true, taxYear: true },
    });
    if (!period) throw new NotFoundException('Pay period not found');
    if (period.status === 'CLOSED') {
      throw new BadRequestException('Cannot create a run for a closed period');
    }

    const openConflict = await this.prisma.ukPayrollRun.findFirst({
      where: {
        periodId: period.id,
        deletedAt: null,
        status: { in: [...OPEN_RUN_STATUSES] },
      },
    });
    if (openConflict) {
      throw new ConflictException('An open UK payroll run already exists for this period');
    }

    const last = await this.prisma.ukPayrollRun.findFirst({
      where: { scheduleId: period.scheduleId, periodId: period.id },
      orderBy: { runNumber: 'desc' },
    });
    const runNumber = (last?.runNumber ?? 0) + 1;
    const label = `${period.schedule.name} · ${period.label} · Run ${runNumber}`;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ukPayrollRun.create({
        data: {
          periodId: period.id,
          taxYearId: period.taxYearId,
          scheduleId: period.scheduleId,
          runNumber,
          label,
          notes: dto.notes?.trim() || null,
          createdById: userId,
          updatedById: userId,
        },
      });
      await tx.payrollPeriod.update({
        where: { id: period.id },
        data: { status: 'IN_RUN', updatedById: userId },
      });
      return created;
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_RUN_CREATED,
      recordType: 'UkPayrollRun',
      recordId: row.id,
      newValues: mapRun(row),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'UK payroll run created', data: mapRun(row) };
  }

  async enrol(
    userId: string,
    runId: string,
    dto: EnrolUkPayrollRunDto,
    meta?: RequestAuditMeta,
  ) {
    const run = await this.requireRun(runId);
    if (!OPEN_RUN_STATUSES.includes(run.status as (typeof OPEN_RUN_STATUSES)[number])) {
      throw new BadRequestException('Only open runs can accept enrolments');
    }

    const explicitIds = (dto.employeeIds?.filter(Boolean) ?? []).length > 0;
    let employeeIds = dto.employeeIds?.filter(Boolean) ?? [];
    if (!explicitIds) {
      const ready = await this.prisma.employeePayrollProfile.findMany({
        where: {
          deletedAt: null,
          status: 'READY',
          OR: [{ scheduleId: run.scheduleId }, { scheduleId: null }],
        },
        select: { employeeId: true },
      });
      employeeIds = ready.map((r) => r.employeeId);
    }

    if (employeeIds.length === 0) {
      throw new BadRequestException('No employees to enrol');
    }

    const validEmployees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, deletedAt: null },
      select: {
        id: true,
        personalDetail: {
          select: {
            firstName: true,
            lastName: true,
            dateOfBirth: true,
            addressLine1: true,
            town: true,
            postcode: true,
            gender: { select: { name: true } },
          },
        },
        employment: {
          select: {
            payrollNumber: true,
            nationalInsuranceNo: true,
          },
        },
      },
    });
    const validIds = new Set(validEmployees.map((e) => e.id));
    const missing = employeeIds.filter((id) => !validIds.has(id));
    // Auto-enrol skips soft-deleted / missing employees (orphan READY profiles).
    // Explicit IDs still fail so callers know which IDs were invalid.
    if (missing.length && explicitIds) {
      throw new BadRequestException(`Unknown employee IDs: ${missing.slice(0, 5).join(', ')}`);
    }
    employeeIds = employeeIds.filter((id) => validIds.has(id));
    if (employeeIds.length === 0) {
      throw new BadRequestException('No employees to enrol');
    }

    const profilesForEnrol = await this.prisma.employeePayrollProfile.findMany({
      where: { employeeId: { in: employeeIds }, deletedAt: null },
      select: { employeeId: true, taxCode: true, niCategory: true, status: true },
    });
    const profileByEmployee = new Map(profilesForEnrol.map((p) => [p.employeeId, p]));
    const rtiBlocked: string[] = [];
    for (const emp of validEmployees) {
      const profile = profileByEmployee.get(emp.id);
      const assessment = assessRtiIdentityCompleteness({
        firstName: emp.personalDetail?.firstName,
        lastName: emp.personalDetail?.lastName,
        dateOfBirth: emp.personalDetail?.dateOfBirth,
        genderName: emp.personalDetail?.gender?.name,
        addressLine1: emp.personalDetail?.addressLine1,
        town: emp.personalDetail?.town,
        postcode: emp.personalDetail?.postcode,
        nationalInsuranceNo: emp.employment?.nationalInsuranceNo,
        payrollNumber: emp.employment?.payrollNumber,
        taxCode: profile?.taxCode,
        niCategory: profile?.niCategory,
      });
      if (!assessment.isComplete) {
        const name =
          `${emp.personalDetail?.firstName ?? ''} ${emp.personalDetail?.lastName ?? ''}`.trim() ||
          emp.id;
        rtiBlocked.push(`${name}: ${assessment.issues[0] ?? 'incomplete identity'}`);
      }
    }
    if (rtiBlocked.length) {
      throw new BadRequestException(
        [
          'Cannot enrol until HMRC identity fields are complete for every selected employee:',
          ...rtiBlocked.slice(0, 8).map((line) => `- ${line}`),
          ...(rtiBlocked.length > 8 ? [`- …and ${rtiBlocked.length - 8} more`] : []),
        ].join('\n'),
      );
    }

    const periodEnd = dateToIsoDate(run.period.periodEnd)!;
    const agreements = await this.prisma.employeePayAgreement.findMany({
      where: {
        employeeId: { in: employeeIds },
        deletedAt: null,
        status: 'ACTIVE',
        effectiveFrom: { lte: run.period.periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.period.periodStart } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    const agreementByEmployee = new Map<string, string>();
    for (const a of agreements) {
      if (!agreementByEmployee.has(a.employeeId)) {
        agreementByEmployee.set(a.employeeId, a.id);
      }
    }

    const existing = await this.prisma.ukPayrollRunEmployee.findMany({
      where: { runId, employeeId: { in: employeeIds } },
      select: { employeeId: true },
    });
    const already = new Set(existing.map((e) => e.employeeId));
    const toCreate = employeeIds.filter((id) => !already.has(id));

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        await tx.ukPayrollRunEmployee.createMany({
          data: toCreate.map((employeeId) => ({
            runId,
            employeeId,
            payAgreementId: agreementByEmployee.get(employeeId) ?? null,
            createdById: userId,
          })),
        });
      }
      const count = await tx.ukPayrollRunEmployee.count({ where: { runId } });
      await tx.ukPayrollRun.update({
        where: { id: runId },
        data: {
          employeeCount: count,
          status: 'EMPLOYEES_ENROLLED',
          updatedById: userId,
        },
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_RUN_EMPLOYEES_ENROLLED,
      recordType: 'UkPayrollRun',
      recordId: runId,
      newValues: {
        enrolled: toCreate.length,
        skippedExisting: already.size,
        periodEnd,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.getById(runId);
  }

  /**
   * Phase 2: snapshot billing / salary / deduction inputs and sum employee gross pay.
   * Does not calculate PAYE, NI, or pensions.
   */
  /**
   * Collect gross inputs for a run. Every input that brings an earning into UK payroll carries a
   * claim key that is unique across all runs, so a visit pay line, a period's salary or a deduction
   * is held by one run only. A cancelled run releases its claims (see `cancel`), which is what lets
   * a replacement run collect the same earnings. When another run takes a claim while this one is
   * collecting, the database refuses the write and the collection is repeated without it.
   */
  async calculateGross(userId: string, runId: string, meta?: RequestAuditMeta) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.collectGross(userId, runId, meta);
      } catch (err) {
        if (!isClaimConflict(err)) throw err;
        if (attempt >= GROSS_CLAIM_RETRIES) {
          throw new ConflictException(
            'Another UK payroll run is collecting the same earnings right now. Try again in a moment.',
          );
        }
      }
    }
  }

  private async collectGross(userId: string, runId: string, meta?: RequestAuditMeta) {
    const run = await this.requireRun(runId);
    if (run.status === 'CLOSED') {
      throw new BadRequestException(
        'Reactivate this closed run before recalculating gross (YTD was posted on close)',
      );
    }
    if (!OPEN_RUN_STATUSES.includes(run.status as (typeof OPEN_RUN_STATUSES)[number])) {
      throw new BadRequestException('Gross can only be calculated on an open run');
    }
    if (run.status === 'CANCELLED') {
      throw new BadRequestException('Cannot calculate gross on a cancelled run');
    }

    const runEmployees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: { runId },
    });
    if (runEmployees.length === 0) {
      throw new BadRequestException('Enrol employees before calculating gross');
    }

    const employeeIds = runEmployees.map((e) => e.employeeId);
    const periodStart = run.period.periodStart;
    const periodEnd = run.period.periodEnd;
    // periodEnd is a @db.Date (midnight of the last day), so an inclusive `lte: periodEnd`
    // wrongly drops any visit timed later that day. Use an exclusive next-day upper bound so
    // the whole last calendar day of the period is covered.
    const periodEndExclusive = new Date(periodEnd);
    periodEndExclusive.setUTCDate(periodEndExclusive.getUTCDate() + 1);
    const runEmployeeByEmployeeId = new Map(runEmployees.map((e) => [e.employeeId, e]));

    const lockedLines = await this.prisma.payrollRunLine.findMany({
      where: {
        employeeId: { in: employeeIds },
        payrollRun: {
          status: { in: ['LOCKED', 'EXPORTED'] },
          periodStart: { lte: periodEnd },
          periodEnd: { gte: periodStart },
        },
      },
      include: { payrollRun: { select: { id: true, periodLabel: true } } },
    });

    // Earnings another live run holds. A cancelled run has released its claims, so its lines do
    // not count: that is how a replacement run recovers them (R-08).
    const salaryClaim = (employeeId: string) => `SALARY:${employeeId}:${run.periodId}`;
    const deductionClaim = (deductionId: string) => `DEDUCTION:${deductionId}:${run.periodId}`;
    const heldClaims = new Set(
      (
        await this.prisma.ukPayrollInputLine.findMany({
          where: {
            runId: { not: runId },
            OR: [
              { claimKey: { in: lockedLines.map((l) => `LINE:${l.id}`) } },
              { claimKey: { in: employeeIds.map(salaryClaim) } },
              { claimKey: { startsWith: 'DEDUCTION:', endsWith: `:${run.periodId}` } },
            ],
          },
          select: { claimKey: true },
        })
      ).map((r) => r.claimKey as string),
    );
    const usedElsewhere = new Set(
      lockedLines.filter((l) => heldClaims.has(`LINE:${l.id}`)).map((l) => l.id),
    );

    // Visits a closed UK run already paid as provisional inputs: their visit pay must not come in
    // again through a visit pay run line (PR-05). Travel / mileage lines of such a visit still count.
    const lockedLineReconIds = [
      ...new Set(lockedLines.map((l) => l.visitReconciliationId).filter((v): v is string => !!v)),
    ];
    const paidProvisionally = new Set(
      (
        await this.prisma.visitReconciliation.findMany({
          where: { id: { in: lockedLineReconIds }, paidByUkPayrollRunId: { not: null } },
          select: { id: true },
        })
      ).map((r) => r.id),
    );

    const coveredReconIds = new Set<string>();
    const draftLines: DraftInputLine[] = [];

    for (const line of lockedLines) {
      if (!line.employeeId) continue;
      if (usedElsewhere.has(line.id)) continue;
      if (
        line.lineType === 'VISIT_PAY' &&
        line.visitReconciliationId &&
        paidProvisionally.has(line.visitReconciliationId)
      ) {
        continue;
      }
      const runEmployee = runEmployeeByEmployeeId.get(line.employeeId);
      if (!runEmployee) continue;
      if (line.visitReconciliationId) coveredReconIds.add(line.visitReconciliationId);
      // TR-13: a reimbursement is not wages. The part within HMRC's approved amount stays outside
      // taxable pay; any part above it comes in as taxable pay on a line of its own, so it is
      // taxed by the same calculation as everything else and is never added to wages twice.
      const isExpense = isExpenseLineType(line.lineType);
      const taxable = isExpense ? decimalNum(line.taxableAmount ?? 0) : 0;
      const isMileage = line.lineType === 'MILEAGE' || line.lineType === 'PASSENGER_MILEAGE';
      const base = {
        runId,
        runEmployeeId: runEmployee.id,
        employeeId: line.employeeId,
        sourceType: 'BILLING_PAYROLL_LINE' as const,
        sourcePayrollRunId: line.payrollRunId,
        sourcePayrollRunLineId: line.id,
        sourceVisitReconciliationId: line.visitReconciliationId,
        sourceSalaryDeductionId: null,
        minutes: line.minutes,
        isProvisional: false,
      };
      const reimbursed = round2(decimalNum(line.amount) - taxable);
      if (!isExpense || reimbursed !== 0 || taxable === 0) {
        draftLines.push({
          ...base,
          id: randomUUID(),
          lineType: line.lineType,
          description: line.description,
          amount: isExpense ? reimbursed : decimalNum(line.amount),
          isExpense,
          claimKey: `LINE:${line.id}`,
          notVerified: isMileage && line.taxTreatment !== 'TAX_FREE' && line.taxTreatment !== 'PART_TAXABLE',
        });
      }
      if (taxable > 0) {
        draftLines.push({
          ...base,
          id: randomUUID(),
          lineType: 'MILEAGE_TAXABLE',
          description: `${line.description} — above the HMRC approved amount (taxable)`,
          minutes: null,
          amount: taxable,
          isExpense: false,
          claimKey: `LINE:${line.id}:TAXABLE`,
        });
      }
    }

    const approvedRecons = await this.prisma.visitReconciliation.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: { in: ['APPROVED_FOR_PAY', 'APPROVED_FOR_BOTH'] },
        approvedPayStart: { gte: periodStart, lt: periodEndExclusive },
        // Not yet settled by a visit pay run or by another closed UK run.
        includedInPayrollRunId: null,
        paidByUkPayrollRunId: null,
      },
    });

    for (const recon of approvedRecons) {
      if (!recon.employeeId) continue;
      if (coveredReconIds.has(recon.id)) continue;
      if (recon.includedInPayrollRunId) continue;
      const runEmployee = runEmployeeByEmployeeId.get(recon.employeeId);
      if (!runEmployee) continue;
      const amount = decimalNum(recon.payableAmount);
      if (amount === 0 && !recon.payableMinutes) continue;
      draftLines.push({
        id: randomUUID(),
        runId,
        runEmployeeId: runEmployee.id,
        employeeId: recon.employeeId,
        sourceType: 'VISIT_RECONCILIATION',
        sourcePayrollRunId: null,
        sourcePayrollRunLineId: null,
        sourceVisitReconciliationId: recon.id,
        sourceSalaryDeductionId: null,
        lineType: 'VISIT_PAY',
        description: `Approved visit pay (provisional — not locked in billing)${
          recon.visitRef ? ` · ${recon.visitRef}` : ''
        }`,
        minutes: recon.payableMinutes,
        amount,
        isExpense: false,
        isProvisional: true,
        // Claimed on the visit itself when the run closes (paidByUkPayrollRunId).
        claimKey: null,
      });
    }

    const agreements = await this.prisma.employeePayAgreement.findMany({
      where: {
        id: { in: runEmployees.map((e) => e.payAgreementId).filter(Boolean) as string[] },
        deletedAt: null,
      },
    });
    const agreementById = new Map(agreements.map((a) => [a.id, a]));

    for (const runEmployee of runEmployees) {
      if (!runEmployee.payAgreementId) continue;
      const agreement = agreementById.get(runEmployee.payAgreementId);
      if (!agreement) continue;
      if (agreement.basis !== 'SALARIED' && agreement.basis !== 'HYBRID') continue;
      const annual = decimalNum(agreement.annualSalary);
      if (annual <= 0) continue;
      const amount = prorateAnnualSalary(annual, periodStart, periodEnd);
      if (amount <= 0) continue;
      // A period's salary belongs to one run; a supplementary run in the same period pays extras only.
      if (heldClaims.has(salaryClaim(runEmployee.employeeId))) continue;
      draftLines.push({
        id: randomUUID(),
        runId,
        runEmployeeId: runEmployee.id,
        employeeId: runEmployee.employeeId,
        sourceType: 'PAY_AGREEMENT_SALARY',
        sourcePayrollRunId: null,
        sourcePayrollRunLineId: null,
        sourceVisitReconciliationId: null,
        sourceSalaryDeductionId: null,
        lineType: 'SALARY',
        description: `Prorated salary (${dateToIsoDate(periodStart)} – ${dateToIsoDate(periodEnd)})`,
        minutes: null,
        amount,
        isExpense: false,
        isProvisional: false,
        claimKey: salaryClaim(runEmployee.employeeId),
      });
    }

    const salaryMonths = salaryMonthKeysForPeriod(periodStart, periodEnd);
    const deductions = await this.prisma.employeeSalaryDeduction.findMany({
      where: {
        employeeId: { in: employeeIds },
        deletedAt: null,
        isActive: true,
        salaryMonth: { in: salaryMonths },
      },
    });
    for (const ded of deductions) {
      const runEmployee = runEmployeeByEmployeeId.get(ded.employeeId);
      if (!runEmployee) continue;
      const amount = decimalNum(ded.amount);
      if (amount <= 0) continue;
      if (heldClaims.has(deductionClaim(ded.id))) continue;
      draftLines.push({
        id: randomUUID(),
        runId,
        runEmployeeId: runEmployee.id,
        employeeId: ded.employeeId,
        sourceType: 'SALARY_DEDUCTION',
        sourcePayrollRunId: null,
        sourcePayrollRunLineId: null,
        sourceVisitReconciliationId: null,
        sourceSalaryDeductionId: ded.id,
        lineType: 'SALARY_DEDUCTION',
        description: `${ded.type}: ${ded.reason}`,
        minutes: null,
        amount: -amount,
        isExpense: false,
        isProvisional: false,
        claimKey: deductionClaim(ded.id),
      });
    }

    const hasPayInput = draftLines.some((l) => l.amount > 0);
    if (!hasPayInput) {
      const from = dateToIsoDate(periodStart);
      const to = dateToIsoDate(periodEnd);
      throw new BadRequestException(
        `No visit-pay or salary inputs found for this UK period (${from} – ${to}). ` +
          `Monthly periods run from the start to the end of each calendar month. ` +
          `Use the period that covers the visit’s pay date, or ensure the visit is approved for pay with a payable amount.`,
      );
    }

    const now = new Date();
    const buckets = new Map<string, ReturnType<typeof emptyGrossBucket>>();
    const provisionalFlags = new Map<string, boolean>();
    const lineCounts = new Map<string, number>();

    for (const re of runEmployees) {
      buckets.set(re.id, emptyGrossBucket());
      provisionalFlags.set(re.id, false);
      lineCounts.set(re.id, 0);
    }

    const notVerified = new Map<string, number>();
    for (const line of draftLines) {
      const bucket = buckets.get(line.runEmployeeId)!;
      if (line.notVerified) {
        notVerified.set(line.runEmployeeId, round2((notVerified.get(line.runEmployeeId) ?? 0) + line.amount));
      }
      accumulateGrossLine(bucket, line);
      lineCounts.set(line.runEmployeeId, (lineCounts.get(line.runEmployeeId) ?? 0) + 1);
      if (line.isProvisional) provisionalFlags.set(line.runEmployeeId, true);
    }
    for (const [id, bucket] of buckets) {
      finalizeGrossBucket(bucket);
      buckets.set(id, bucket);
    }

    let runTotalGross = 0;
    let runTotalExpenses = 0;
    for (const bucket of buckets.values()) {
      runTotalGross += bucket.totalGross;
      runTotalExpenses += bucket.expenseTotal;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.ukPayrollInputLine.deleteMany({ where: { runId } });
      if (draftLines.length) {
        await tx.ukPayrollInputLine.createMany({
          data: draftLines.map((l) => ({
            id: l.id,
            runId: l.runId,
            runEmployeeId: l.runEmployeeId,
            employeeId: l.employeeId,
            sourceType: l.sourceType,
            sourcePayrollRunId: l.sourcePayrollRunId,
            sourcePayrollRunLineId: l.sourcePayrollRunLineId,
            sourceVisitReconciliationId: l.sourceVisitReconciliationId,
            sourceSalaryDeductionId: l.sourceSalaryDeductionId,
            lineType: l.lineType,
            description: l.description,
            minutes: l.minutes,
            amount: toDecimal(l.amount),
            isExpense: l.isExpense,
            isProvisional: l.isProvisional,
            claimKey: l.claimKey,
          })),
        });
      }

      for (const re of runEmployees) {
        const bucket = buckets.get(re.id)!;
        await tx.ukPayrollRunEmployee.update({
          where: { id: re.id },
          data: {
            visitPay: toDecimal(bucket.visitPay),
            salaryPay: toDecimal(bucket.salaryPay),
            travelPay: toDecimal(bucket.travelPay),
            nmwTopUp: toDecimal(bucket.nmwTopUp),
            otherPay: toDecimal(bucket.otherPay),
            expenseTotal: toDecimal(bucket.expenseTotal),
            // TR-13: reimbursements are owed to the employee with this run's net pay.
            reimbursementPayable: toDecimal(bucket.expenseTotal),
            expenseNotVerified: toDecimal(notVerified.get(re.id) ?? 0),
            deductionTotal: toDecimal(bucket.deductionTotal),
            totalGross: toDecimal(bucket.totalGross),
            inputLineCount: lineCounts.get(re.id) ?? 0,
            hasProvisionalInputs: provisionalFlags.get(re.id) ?? false,
            grossCalculatedAt: now,
            // Gross change invalidates prior statutory results.
            taxablePay: toDecimal(0),
            incomeTax: toDecimal(0),
            employeeNi: toDecimal(0),
            employerNi: toDecimal(0),
            netPay: toDecimal(0),
            taxCodeApplied: null,
            niCategoryApplied: null,
            statutoryExplanation: null,
            statutoryCalculatedAt: null,
          },
        });
      }

      await tx.ukPayrollRun.update({
        where: { id: runId },
        data: {
          status: 'GROSS_CALCULATED',
          totalGross: toDecimal(runTotalGross),
          totalExpenses: toDecimal(runTotalExpenses),
          grossCalculatedAt: now,
          totalIncomeTax: toDecimal(0),
          totalEmployeeNi: toDecimal(0),
          totalEmployerNi: toDecimal(0),
          totalNetPay: toDecimal(0),
          statutoryCalculatedAt: null,
          statutoryBasis: null,
          updatedById: userId,
        },
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_RUN_GROSS_CALCULATED,
      recordType: 'UkPayrollRun',
      recordId: runId,
      newValues: {
        inputLineCount: draftLines.length,
        totalGross: runTotalGross,
        totalExpenses: runTotalExpenses,
        employeeCount: runEmployees.length,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.getById(runId);
  }

  /**
   * PAYE Income Tax + Class 1 NI on Phase 2 totalGross.
   * Default cumulative using YTD ledgers; Week 1 / Month 1 when profile flag (or BR/D0/D1) applies.
   */
  async calculateStatutory(userId: string, runId: string, meta?: RequestAuditMeta) {
    const run = await this.requireRun(runId);
    if (run.status === 'CLOSED') {
      throw new BadRequestException(
        'Reactivate this closed run before recalculating tax/NI (YTD was posted on close)',
      );
    }
    const canCalculate =
      run.status === 'GROSS_CALCULATED' || run.status === 'STATUTORY_CALCULATED';
    if (!canCalculate) {
      throw new BadRequestException(
        'Calculate gross before statutory tax/NI (allowed on gross or statutory runs)',
      );
    }
    if (!run.grossCalculatedAt) {
      throw new BadRequestException('Gross must be calculated before statutory tax/NI');
    }

    const runEmployees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: { runId },
    });
    if (runEmployees.length === 0) {
      throw new BadRequestException('Enrol employees before calculating statutory amounts');
    }

    await ensureEnglandStatutoryRateSet(this.prisma, run.taxYearId);
    const rateRow = await this.prisma.payrollStatutoryRateSet.findFirst({
      where: { taxYearId: run.taxYearId, nation: 'ENG', isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!rateRow) {
      throw new BadRequestException('No active statutory rate set for this tax year');
    }
    const rates = rateSetToSnapshot(rateRow);
    const frequency = run.schedule.frequency as PayFrequencyCode;
    const periodNumber = taxYearPeriodNumber(
      run.taxYear.startDate,
      run.period.periodStart,
      frequency,
    );

    const employeeIds = runEmployees.map((e) => e.employeeId);
    const [profiles, ytdLedgers] = await Promise.all([
      this.prisma.employeePayrollProfile.findMany({
        where: { employeeId: { in: employeeIds }, deletedAt: null },
      }),
      this.prisma.employeePayrollYtdLedger.findMany({
        where: { taxYearId: run.taxYearId, employeeId: { in: employeeIds } },
      }),
    ]);
    const profileByEmployeeId = new Map(profiles.map((p) => [p.employeeId, p]));
    const ytdByEmployeeId = new Map(ytdLedgers.map((y) => [y.employeeId, y]));

    const now = new Date();
    let totalIncomeTax = 0;
    let totalEmployeeNi = 0;
    let totalEmployerNi = 0;
    let totalNetPay = 0;
    let usedCumulative = 0;
    let usedNonCumulative = 0;
    const perEmployee: Array<{
      id: string;
      taxablePay: number;
      incomeTax: number;
      employeeNi: number;
      employerNi: number;
      netPay: number;
      taxCodeApplied: string;
      niCategoryApplied: string;
      statutoryExplanation: string;
    }> = [];

    for (const re of runEmployees) {
      const profile = profileByEmployeeId.get(re.employeeId);
      const ytd = ytdByEmployeeId.get(re.employeeId);
      const result = calculatePeriodStatutory({
        periodGross: decimalNum(re.totalGross),
        taxCode: profile?.taxCode ?? '1257L',
        niCategory: profile?.niCategory ?? 'A',
        frequency,
        rates,
        week1Month1: profile?.taxCodeWeek1Month1 ?? false,
        periodNumber,
        ytdGrossBefore: ytd ? decimalNum(ytd.grossPayYtd) : 0,
        ytdTaxBefore: ytd ? decimalNum(ytd.incomeTaxYtd) : 0,
      });
      if (result.calculationBasis === 'CUMULATIVE') usedCumulative += 1;
      else usedNonCumulative += 1;
      totalIncomeTax += result.incomeTax;
      totalEmployeeNi += result.employeeNi;
      totalEmployerNi += result.employerNi;
      totalNetPay += result.netPay;
      perEmployee.push({
        id: re.id,
        taxablePay: result.taxablePay,
        incomeTax: result.incomeTax,
        employeeNi: result.employeeNi,
        employerNi: result.employerNi,
        netPay: result.netPay,
        taxCodeApplied: result.taxCodeApplied,
        niCategoryApplied: result.niCategoryApplied,
        statutoryExplanation: result.explanation,
      });
    }

    totalIncomeTax = Math.round(totalIncomeTax * 100) / 100;
    totalEmployeeNi = Math.round(totalEmployeeNi * 100) / 100;
    totalEmployerNi = Math.round(totalEmployerNi * 100) / 100;
    totalNetPay = Math.round(totalNetPay * 100) / 100;

    const statutoryBasis =
      usedCumulative > 0 && usedNonCumulative > 0
        ? 'MIXED_CUMULATIVE_AND_W1M1'
        : usedCumulative > 0
          ? 'CUMULATIVE'
          : 'WEEK1_MONTH1_NON_CUMULATIVE';

    await this.prisma.$transaction(async (tx) => {
      for (const row of perEmployee) {
        await tx.ukPayrollRunEmployee.update({
          where: { id: row.id },
          data: {
            taxablePay: toDecimal(row.taxablePay),
            incomeTax: toDecimal(row.incomeTax),
            employeeNi: toDecimal(row.employeeNi),
            employerNi: toDecimal(row.employerNi),
            netPay: toDecimal(row.netPay),
            taxCodeApplied: row.taxCodeApplied,
            niCategoryApplied: row.niCategoryApplied,
            statutoryExplanation: row.statutoryExplanation,
            statutoryCalculatedAt: now,
          },
        });
      }

      await tx.ukPayrollRun.update({
        where: { id: runId },
        data: {
          status: 'STATUTORY_CALCULATED',
          totalIncomeTax: toDecimal(totalIncomeTax),
          totalEmployeeNi: toDecimal(totalEmployeeNi),
          totalEmployerNi: toDecimal(totalEmployerNi),
          totalNetPay: toDecimal(totalNetPay),
          statutoryCalculatedAt: now,
          statutoryBasis,
          updatedById: userId,
        },
      });
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_RUN_STATUTORY_CALCULATED,
      recordType: 'UkPayrollRun',
      recordId: runId,
      newValues: {
        employeeCount: runEmployees.length,
        totalIncomeTax,
        totalEmployeeNi,
        totalEmployerNi,
        totalNetPay,
        statutoryBasis,
        periodNumber,
        rateSetId: rateRow.id,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.getById(runId);
  }

  async close(userId: string, runId: string, meta?: RequestAuditMeta) {
    const run = await this.requireRun(runId);
    if (!OPEN_RUN_STATUSES.includes(run.status as (typeof OPEN_RUN_STATUSES)[number])) {
      throw new BadRequestException('Only open runs can be closed');
    }
    if (run.status !== 'STATUTORY_CALCULATED' || !run.statutoryCalculatedAt) {
      throw new BadRequestException(
        'Calculate tax & NI before closing — close posts year-to-date (YTD) figures',
      );
    }
    if (run.employeeCount < 1) {
      throw new BadRequestException('Enrol at least one employee before closing, or cancel the run');
    }
    assertDifferentUser(
      run.createdById,
      userId,
      'A UK payroll run must be closed by a different user from the one who created it.',
    );

    const runEmployees = await this.prisma.ukPayrollRunEmployee.findMany({
      where: { runId },
    });

    const row = await this.prisma.$transaction(async (tx) => {
      // Closing settles the provisional visit inputs of this run: claim each visit so that no other
      // UK run or visit pay run can pay it again (PR-05). The claim is one conditional update, so two
      // runs closing together cannot both take the same visit.
      const provisional = await tx.ukPayrollInputLine.findMany({
        where: { runId, isProvisional: true, sourceVisitReconciliationId: { not: null } },
        select: { sourceVisitReconciliationId: true, amount: true },
      });
      if (provisional.length) {
        const amountByVisit = new Map(provisional.map((l) => [l.sourceVisitReconciliationId!, l.amount]));
        const visitIds = [...amountByVisit.keys()];
        const visits = await tx.visitReconciliation.findMany({
          where: { id: { in: visitIds } },
          select: { id: true, payableAmount: true },
        });
        const changed = visits.filter(
          (v) => !new Prisma.Decimal(v.payableAmount ?? 0).equals(amountByVisit.get(v.id) ?? 0),
        );
        const claimed = await tx.visitReconciliation.updateMany({
          where: {
            id: { in: visitIds },
            status: { in: ['APPROVED_FOR_PAY', 'APPROVED_FOR_BOTH'] },
            includedInPayrollRunId: null,
            paidByUkPayrollRunId: null,
          },
          data: { paidByUkPayrollRunId: runId, lockedAt: new Date() },
        });
        if (changed.length || claimed.count !== visitIds.length) {
          throw new ConflictException(
            'Some approved visits in this run were changed or paid by another run since gross was calculated. Recalculate gross, then tax & NI, before closing.',
          );
        }
      }

      const ytd = await postRunEmployeesToYtd(tx, {
        runId,
        taxYearId: run.taxYearId,
        userId,
        employees: runEmployees.map((e) => ({
          employeeId: e.employeeId,
          grossPay: decimalNum(e.totalGross) ?? 0,
          taxablePay: decimalNum(e.taxablePay) ?? 0,
          incomeTax: decimalNum(e.incomeTax) ?? 0,
          employeeNi: decimalNum(e.employeeNi) ?? 0,
          employerNi: decimalNum(e.employerNi) ?? 0,
          netPay: decimalNum(e.netPay) ?? 0,
        })),
      });

      // Every earning being closed must still be claimed by this run (a line loses its claim when
      // its run is cancelled; a reactivated run has to collect gross again first).
      const unclaimed = await tx.ukPayrollInputLine.count({
        where: { runId, isProvisional: false, claimKey: null },
      });
      if (unclaimed > 0) {
        throw new ConflictException(
          'Some earnings in this run are no longer held by it. Recalculate gross, then tax & NI, before closing.',
        );
      }
      const closed = await tx.ukPayrollRun.updateMany({
        where: { id: runId, status: 'STATUTORY_CALCULATED' },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: userId,
          updatedById: userId,
        },
      });
      if (closed.count !== 1) {
        throw new ConflictException('This run was changed by someone else. Reload and try again.');
      }
      const updated = await tx.ukPayrollRun.findUniqueOrThrow({ where: { id: runId } });
      const otherOpen = await tx.ukPayrollRun.count({
        where: {
          periodId: run.periodId,
          deletedAt: null,
          status: { in: [...OPEN_RUN_STATUSES] },
          id: { not: runId },
        },
      });
      if (otherOpen === 0) {
        await tx.payrollPeriod.update({
          where: { id: run.periodId },
          data: { status: 'CLOSED', updatedById: userId },
        });
      }
      return { updated, ytd };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_RUN_CLOSED,
      recordType: 'UkPayrollRun',
      recordId: runId,
      oldValues: mapRun(run),
      newValues: {
        ...mapRun(row.updated),
        ytdPosted: row.ytd.posted,
        ytdSkipped: row.ytd.skipped,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: `UK payroll run closed (YTD posted for ${row.ytd.posted} employee(s))`,
      data: mapRun(row.updated),
    };
  }

  /**
   * Cancel a run that has not been closed (R-08).
   *
   * Nothing has been posted for an open run, so cancelling is safe as long as no money or HMRC
   * submission depends on it. Its input lines stay as the snapshot of what the run contained, but
   * their claims are released in the same transaction, so a replacement run can collect those
   * earnings. A closed run is not cancelled: it is reopened (a separate power) or corrected.
   */
  async cancel(userId: string, runId: string, meta?: RequestAuditMeta, reason?: string) {
    const run = await this.requireRun(runId);
    if (run.status === 'CLOSED' || run.status === 'CANCELLED') {
      throw new BadRequestException('Run is already finalised');
    }
    const payout = await this.prisma.employeePayoutBatch.findFirst({
      where: { ukPayrollRunId: runId, status: { in: ['DRAFT', 'APPROVED', 'PAID'] } },
      select: { status: true },
    });
    if (payout) {
      throw new BadRequestException(
        payout.status === 'DRAFT'
          ? 'This run has a draft payout batch. Cancel the payout batch first.'
          : 'This run has an approved or paid payout batch and cannot be cancelled. Correct pay with an adjustment in a later run.',
      );
    }
    const liveSubmission = await this.prisma.payrollHmrcSubmission.findFirst({
      where: {
        ukPayrollRunId: runId,
        environment: 'LIVE',
        mode: 'SUBMIT',
        status: { notIn: ['DRAFT_BUILT', 'PENDING_APPROVAL', 'REJECTED_APPROVAL'] },
      },
      select: { id: true },
    });
    if (liveSubmission) {
      throw new BadRequestException(
        'This run has been submitted to HMRC (live) and cannot be cancelled. Correct pay with an adjustment in a later run.',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      // Conditional on the status read above: a close or second cancel racing this one loses cleanly.
      const changed = await tx.ukPayrollRun.updateMany({
        where: { id: runId, status: run.status },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledById: userId,
          updatedById: userId,
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('This run was changed by someone else. Reload and try again.');
      }
      const released = await tx.ukPayrollInputLine.updateMany({
        where: { runId, claimKey: { not: null } },
        data: { claimKey: null, releasedAt: now },
      });
      const updated = await tx.ukPayrollRun.findUniqueOrThrow({ where: { id: runId } });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.PAYROLL,
        action: AuditAction.PAYROLL_RUN_CANCELLED,
        recordType: 'UkPayrollRun',
        recordId: runId,
        description: reason?.trim() || undefined,
        oldValues: mapRun(run),
        newValues: { ...mapRun(updated), releasedClaims: released.count },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      const otherOpen = await tx.ukPayrollRun.count({
        where: {
          periodId: run.periodId,
          deletedAt: null,
          status: { in: [...OPEN_RUN_STATUSES] },
          id: { not: runId },
        },
      });
      if (otherOpen === 0) {
        await tx.payrollPeriod.update({
          where: { id: run.periodId },
          data: { status: 'OPEN', updatedById: userId },
        });
      }
      return updated;
    });

    return { message: 'UK payroll run cancelled', data: mapRun(row) };
  }

  async reactivate(
    userId: string,
    runId: string,
    meta?: RequestAuditMeta,
    options: { mayReopenClosed?: boolean } = {},
  ) {
    const run = await this.requireRun(runId);
    if (run.status !== 'CLOSED' && run.status !== 'CANCELLED') {
      throw new BadRequestException('Only closed or cancelled runs can be reactivated');
    }
    // Reopening a closed run reverses posted year-to-date figures: a named power, not run editing.
    if (run.status === 'CLOSED' && !options.mayReopenClosed) {
      throw new ForbiddenException(
        'Reopening a closed UK payroll run needs the "payroll.runs.reopen" permission.',
      );
    }

    const openConflict = await this.prisma.ukPayrollRun.findFirst({
      where: {
        periodId: run.periodId,
        deletedAt: null,
        status: { in: [...OPEN_RUN_STATUSES] },
        id: { not: runId },
      },
    });
    if (openConflict) {
      throw new ConflictException(
        'Another open UK payroll run already exists for this period. Close or cancel it first.',
      );
    }

    const wasClosed = run.status === 'CLOSED';
    const nextStatus = wasClosed
      ? this.resolveReactivateStatus(run)
      : run.employeeCount > 0
        ? 'EMPLOYEES_ENROLLED'
        : 'DRAFT';

    if (wasClosed) {
      // A closed run that money or HMRC already depends on stays closed; correct it with a new run.
      const committedPayout = await this.prisma.employeePayoutBatch.findFirst({
        where: { ukPayrollRunId: runId, status: { in: ['APPROVED', 'PAID'] } },
        select: { id: true },
      });
      if (committedPayout) {
        throw new BadRequestException(
          'This run has an approved or paid payout batch and cannot be reopened. Correct pay with an adjustment in a later run.',
        );
      }
      const liveSubmission = await this.prisma.payrollHmrcSubmission.findFirst({
        where: {
          ukPayrollRunId: runId,
          environment: 'LIVE',
          mode: 'SUBMIT',
          status: { notIn: ['DRAFT_BUILT', 'PENDING_APPROVAL', 'REJECTED_APPROVAL'] },
        },
        select: { id: true },
      });
      if (liveSubmission) {
        throw new BadRequestException(
          'This run has been submitted to HMRC (live) and cannot be reopened. Correct pay with an adjustment in a later run.',
        );
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const ytd =
        wasClosed
          ? await reverseRunEmployeesFromYtd(tx, { runId, userId })
          : { reversed: 0 };

      if (wasClosed) {
        // Release the visits this run settled as provisional inputs; the database only accepts this
        // for the run named here (see protect_paid_visit_reconciliation).
        await tx.$executeRaw`SELECT set_config('careflow.reopening_uk_run', ${runId}, true)`;
        await tx.visitReconciliation.updateMany({
          where: { paidByUkPayrollRunId: runId },
          data: { paidByUkPayrollRunId: null, lockedAt: null },
        });
        await tx.$executeRaw`SELECT set_config('careflow.reopening_uk_run', '', true)`;
      }

      const updated = await tx.ukPayrollRun.update({
        where: { id: runId },
        data: {
          status: nextStatus,
          closedAt: null,
          closedById: null,
          cancelledAt: null,
          cancelledById: null,
          updatedById: userId,
          // A cancelled run released its earnings; its old figures are a snapshot, not a basis for
          // closing. It goes back to before gross and has to collect again.
          ...(wasClosed ? {} : { grossCalculatedAt: null, statutoryCalculatedAt: null, statutoryBasis: null }),
        },
      });
      await tx.payrollPeriod.update({
        where: { id: run.periodId },
        data: { status: 'IN_RUN', updatedById: userId },
      });
      return { updated, ytd };
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.PAYROLL,
      action: AuditAction.PAYROLL_RUN_REACTIVATED,
      recordType: 'UkPayrollRun',
      recordId: runId,
      oldValues: mapRun(run),
      newValues: {
        ...mapRun(row.updated),
        ytdReversed: row.ytd.reversed,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      message: wasClosed
        ? `UK payroll run reactivated (YTD reversed for ${row.ytd.reversed} employee(s))`
        : 'UK payroll run reactivated',
      data: mapRun(row.updated),
    };
  }

  private resolveReactivateStatus(run: {
    statutoryCalculatedAt: Date | null;
    grossCalculatedAt: Date | null;
    employeeCount: number;
  }): (typeof OPEN_RUN_STATUSES)[number] {
    if (run.statutoryCalculatedAt) return 'STATUTORY_CALCULATED';
    if (run.grossCalculatedAt) return 'GROSS_CALCULATED';
    if (run.employeeCount > 0) return 'EMPLOYEES_ENROLLED';
    return 'DRAFT';
  }

  private async requireRun(id: string) {
    const row = await this.prisma.ukPayrollRun.findFirst({
      where: { id, deletedAt: null },
      include: { period: true, schedule: true, taxYear: true },
    });
    if (!row) throw new NotFoundException('UK payroll run not found');
    return row;
  }
}
