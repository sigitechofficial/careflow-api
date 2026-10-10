import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OfficeSalaryPeriod, type OfficeSalaryPayment, type OfficeUserSalary } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { OrganisationGeneralSettingsService } from '../organisation-general-settings/organisation-general-settings.service';
import { operationalTodayIso } from '../common/utils/operational-day.util';
import type {
  RecordOfficeSalaryPaymentDto,
  UpsertOfficeSalaryDto,
} from './dto/office-salary.dto';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Monthly equivalent of a salary (annual ÷ 12). */
export function officeSalaryMonthlyAmount(salary: { amount: unknown; period: OfficeSalaryPeriod }): number {
  const amount = Number(salary.amount);
  return round2(salary.period === OfficeSalaryPeriod.ANNUAL ? amount / 12 : amount);
}

/** Show only the last 4 digits of an account number (audit trail / list). */
function maskAccount(account: string | null | undefined): string | null {
  return account ? `••••${account.slice(-4)}` : null;
}

/**
 * Office user salaries — managed separately from carer / UK payroll.
 * Stores the agreed gross salary and a log of monthly payments; no tax / NI calculation.
 */
@Injectable()
export class OfficeSalariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgSettings: OrganisationGeneralSettingsService,
  ) {}

  private async currentMonth(): Promise<string> {
    const timeZone = await this.orgSettings.getOperationalTimezone();
    return operationalTodayIso(new Date(), timeZone).slice(0, 7);
  }

  private serializeSalary(s: OfficeUserSalary) {
    return {
      amount: Number(s.amount),
      period: s.period,
      monthlyAmount: officeSalaryMonthlyAmount(s),
      payDay: s.payDay,
      startDate: s.startDate ? s.startDate.toISOString().slice(0, 10) : null,
      bankAccountName: s.bankAccountName,
      bankSortCode: s.bankSortCode,
      bankAccountNumber: s.bankAccountNumber,
      notes: s.notes,
      isActive: s.isActive,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private serializePayment(p: OfficeSalaryPayment) {
    return {
      id: p.id,
      month: p.month,
      amount: Number(p.amount),
      paidAt: p.paidAt ? p.paidAt.toISOString().slice(0, 10) : null,
      reference: p.reference,
      note: p.note,
      recordedAt: p.createdAt.toISOString(),
    };
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
    });
    if (!user) throw new NotFoundException('Office user not found');
    return user;
  }

  /** Every office user with their salary and this month's payment. */
  async list(month?: string) {
    const m = month ?? (await this.currentMonth());
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isActive: true,
        userRoles: { select: { role: { select: { name: true } } } },
      },
    });
    const ids = users.map((u) => u.id);
    const [salaries, payments] = await Promise.all([
      this.prisma.officeUserSalary.findMany({ where: { userId: { in: ids } } }),
      this.prisma.officeSalaryPayment.findMany({ where: { userId: { in: ids }, month: m } }),
    ]);
    const salaryBy = new Map(salaries.map((s) => [s.userId, s]));
    const paymentBy = new Map(payments.map((p) => [p.userId, p]));

    // Deactivated logins stay listed only while they still have a salary on record.
    const rows = users
      .filter((u) => u.isActive || salaryBy.has(u.id))
      .map((u) => {
        const salary = salaryBy.get(u.id);
        const payment = paymentBy.get(u.id);
        return {
          userId: u.id,
          name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
          email: u.email,
          roles: u.userRoles.map((r) => r.role.name),
          loginActive: u.isActive,
          salary: salary
            ? {
                ...this.serializeSalary(salary),
                // The list shows a masked account number; the full one is in the salary form.
                bankAccountNumber: maskAccount(salary.bankAccountNumber),
              }
            : null,
          payment: payment ? this.serializePayment(payment) : null,
        };
      });

    const expected = rows.filter((r) => r.salary?.isActive);
    return {
      message: 'Office salaries',
      data: {
        month: m,
        rows,
        totals: {
          salariedCount: expected.length,
          monthlyTotal: round2(expected.reduce((sum, r) => sum + (r.salary?.monthlyAmount ?? 0), 0)),
          paidTotal: round2(rows.reduce((sum, r) => sum + (r.payment?.amount ?? 0), 0)),
          unpaidCount: expected.filter((r) => !r.payment).length,
        },
      },
    };
  }

  /** One office user: full salary details (incl. bank) and every payment, newest first. */
  async detail(userId: string) {
    const user = await this.requireUser(userId);
    const [salary, payments] = await Promise.all([
      this.prisma.officeUserSalary.findUnique({ where: { userId } }),
      this.prisma.officeSalaryPayment.findMany({ where: { userId }, orderBy: { month: 'desc' } }),
    ]);
    return {
      message: 'Office salary',
      data: {
        userId,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email,
        email: user.email,
        salary: salary ? this.serializeSalary(salary) : null,
        payments: payments.map((p) => this.serializePayment(p)),
      },
    };
  }

  async upsertSalary(actorId: string, userId: string, dto: UpsertOfficeSalaryDto) {
    await this.requireUser(userId);
    const existing = await this.prisma.officeUserSalary.findUnique({ where: { userId } });
    const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
    const data = {
      amount: dto.amount,
      period: dto.period,
      payDay: dto.payDay ?? null,
      startDate: dto.startDate ? new Date(`${dto.startDate.slice(0, 10)}T00:00:00.000Z`) : null,
      bankAccountName: clean(dto.bankAccountName),
      bankSortCode: clean(dto.bankSortCode)?.replace(/-/g, '').replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3') ?? null,
      bankAccountNumber: clean(dto.bankAccountNumber),
      notes: clean(dto.notes),
      isActive: dto.isActive ?? existing?.isActive ?? true,
      updatedById: actorId,
    };
    const saved = await this.prisma.officeUserSalary.upsert({
      where: { userId },
      create: { userId, ...data, createdById: actorId },
      update: data,
    });
    const snapshot = (s: OfficeUserSalary | null) =>
      s
        ? {
            amount: Number(s.amount),
            period: s.period,
            payDay: s.payDay,
            isActive: s.isActive,
            bankSortCode: s.bankSortCode,
            bankAccountNumber: maskAccount(s.bankAccountNumber),
          }
        : undefined;
    await this.audit.logAudit({
      userId: actorId,
      module: AuditModule.PAYROLL,
      action: AuditAction.OFFICE_SALARY_UPDATED,
      recordType: 'OfficeUserSalary',
      recordId: saved.id,
      description: existing ? 'Office salary updated' : 'Office salary set up',
      oldValues: snapshot(existing),
      newValues: snapshot(saved),
    });
    return { message: 'Salary saved', data: this.serializeSalary(saved) };
  }

  async recordPayment(actorId: string, userId: string, dto: RecordOfficeSalaryPaymentDto) {
    await this.requireUser(userId);
    const salary = await this.prisma.officeUserSalary.findUnique({ where: { userId } });
    if (!salary) throw new BadRequestException('Set up a salary for this office user first');
    const amount = dto.amount ?? officeSalaryMonthlyAmount(salary);
    const data = {
      amount,
      paidAt: dto.paidAt ? new Date(`${dto.paidAt.slice(0, 10)}T00:00:00.000Z`) : null,
      reference: dto.reference?.trim() || null,
      note: dto.note?.trim() || null,
      updatedById: actorId,
    };
    const payment = await this.prisma.officeSalaryPayment.upsert({
      where: { userId_month: { userId, month: dto.month } },
      create: { userId, month: dto.month, ...data, createdById: actorId },
      update: data,
    });
    await this.audit.logAudit({
      userId: actorId,
      module: AuditModule.PAYROLL,
      action: AuditAction.OFFICE_SALARY_PAYMENT_RECORDED,
      recordType: 'OfficeSalaryPayment',
      recordId: payment.id,
      description: `Office salary paid for ${dto.month}`,
      newValues: { userId, month: dto.month, amount, paidAt: data.paidAt, reference: data.reference },
    });
    return { message: 'Payment recorded', data: this.serializePayment(payment) };
  }

  async removePayment(actorId: string, userId: string, month: string) {
    const payment = await this.prisma.officeSalaryPayment.findUnique({
      where: { userId_month: { userId, month } },
    });
    if (!payment) throw new NotFoundException('No payment recorded for that month');
    await this.prisma.officeSalaryPayment.delete({ where: { id: payment.id } });
    await this.audit.logAudit({
      userId: actorId,
      module: AuditModule.PAYROLL,
      action: AuditAction.OFFICE_SALARY_PAYMENT_REMOVED,
      recordType: 'OfficeSalaryPayment',
      recordId: payment.id,
      description: `Office salary payment for ${month} removed`,
      oldValues: this.serializePayment(payment),
    });
    return { message: 'Payment removed', data: { userId, month } };
  }
}
