import { Injectable } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

type ReportAudit = RequestAuditMeta & { userId: string };

@Injectable()
export class EmployeeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async logReportView(slug: string, audit: ReportAudit | undefined, recordCount?: number) {
    if (!audit?.userId) return;
    await this.audit.logAudit({
      userId: audit.userId,
      module: AuditModule.EMPLOYEE_REPORT,
      action: AuditAction.EMPLOYEE_REPORT_VIEWED,
      recordType: 'EmployeeReport',
      recordId: slug,
      metadata: { recordCount },
      ipAddress: audit.ipAddress ?? undefined,
      userAgent: audit.userAgent ?? undefined,
    });
    await this.audit.logDataAccess({
      userId: audit.userId,
      module: AuditModule.EMPLOYEE_REPORT,
      recordType: 'EmployeeReport',
      recordId: slug,
      accessType: DataAccessType.VIEW,
      ipAddress: audit.ipAddress ?? undefined,
      userAgent: audit.userAgent ?? undefined,
      metadata: { recordCount },
    });
  }

  async dashboardSummary(audit?: ReportAudit) {
    const [total, active] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { deletedAt: null } }),
      this.prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
    ]);
    await this.logReportView('dashboard-summary', audit, total);
    return { data: { totalEmployees: total, activeEmployees: active } };
  }

  async staffSummary(audit?: ReportAudit) {
    const [total, active] = await this.prisma.$transaction([
      this.prisma.employee.count({ where: { deletedAt: null } }),
      this.prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
    ]);
    await this.logReportView('staff-summary', audit, total);
    return { data: { totalEmployees: total, activeEmployees: active } };
  }

  async staffAnalysis(audit?: ReportAudit) {
    await this.logReportView('staff-analysis', audit, 0);
    return { data: { message: 'Not implemented yet' } };
  }

  async compliance(audit?: ReportAudit) {
    await this.logReportView('compliance', audit, 0);
    return { data: { message: 'Not implemented yet' } };
  }

  async complianceDetail(audit?: ReportAudit) {
    await this.logReportView('compliance-detail', audit, 0);
    return { data: { message: 'Not implemented yet' } };
  }

  async leaving(audit?: ReportAudit) {
    await this.logReportView('leaving', audit, 0);
    return { data: { message: 'Not implemented yet' } };
  }

  async details(audit?: ReportAudit) {
    await this.logReportView('details', audit, 0);
    return { data: { message: 'Not implemented yet' } };
  }

  async holidays(audit?: ReportAudit) {
    await this.logReportView('holidays', audit, 0);
    return { data: { message: 'Not implemented yet' } };
  }
}
