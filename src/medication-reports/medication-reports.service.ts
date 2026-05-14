import { BadRequestException, Injectable } from '@nestjs/common';
import { MedicationAdministrationStatus, Prisma } from '@prisma/client';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { MedicationReportQueryDto } from './dto/medication-report-query.dto';
import { MedicationEventReportTypeFilter } from '../medication-administration/dto/medication-administration-query.dto';

const LATE_MINUTES = Number(process.env.MEDICATION_LATE_THRESHOLD_MINUTES ?? 30);

@Injectable()
export class MedicationReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private assertRange(q: MedicationReportQueryDto) {
    const from = new Date(q.dateFrom);
    const to = new Date(q.dateTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('Invalid date range');
    }
    return { from, to };
  }

  private async logReport(userId: string, meta: RequestAuditMeta, name: string, filters: unknown) {
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.MEDICATION,
      recordType: 'MedicationReport',
      accessType: DataAccessType.VIEW,
      ...meta,
      metadata: { report: name, filters },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.MEDICATION,
      action: AuditAction.MEDICATION_REPORT_GENERATED,
      recordType: 'MedicationReport',
      metadata: { report: name, filters },
      ...meta,
    });
  }

  private assertServiceUserScope(q: MedicationReportQueryDto) {
    if (!q.allServiceUsers && !q.serviceUserId) {
      throw new BadRequestException('serviceUserId is required unless allServiceUsers is true');
    }
  }

  private applyReportType(where: Prisma.MedicationAdministrationEventWhereInput, q: MedicationReportQueryDto) {
    if (q.reportType === MedicationEventReportTypeFilter.GIVEN) {
      where.status = MedicationAdministrationStatus.GIVEN;
    } else if (q.reportType === MedicationEventReportTypeFilter.NOT_GIVEN) {
      where.status = { in: [MedicationAdministrationStatus.NOT_GIVEN, MedicationAdministrationStatus.REFUSED] };
    } else if (q.reportType === MedicationEventReportTypeFilter.MISSED) {
      where.status = MedicationAdministrationStatus.MISSED;
    }
  }

  private baseEventWhere(q: MedicationReportQueryDto): Prisma.MedicationAdministrationEventWhereInput {
    const { from, to } = this.assertRange(q);
    this.assertServiceUserScope(q);
    const where: Prisma.MedicationAdministrationEventWhereInput = {
      deletedAt: null,
      isActive: true,
      actualDateTime: { gte: from, lte: to },
    };
    if (!q.allServiceUsers && q.serviceUserId) {
      where.serviceUserId = q.serviceUserId;
    }
    if (q.employeeId) where.administeredById = q.employeeId;
    if (q.medicationId) where.serviceUserMedicationId = q.medicationId;
    if (q.medicationCategoryId) {
      where.medication = { categoryId: q.medicationCategoryId };
    }
    this.applyReportType(where, q);
    return where;
  }

  async administered(userId: string, q: MedicationReportQueryDto, meta: RequestAuditMeta) {
    await this.logReport(userId, meta, 'administered', q);
    const q2 = { ...q, reportType: undefined };
    const where = this.baseEventWhere(q2 as MedicationReportQueryDto);
    where.status = MedicationAdministrationStatus.GIVEN;
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.medicationAdministrationEvent.findMany({
        where,
        include: {
          medication: { include: { category: true } },
          administeredBy: { include: { personalDetail: true } },
          serviceUser: { select: { id: true, firstName: true, lastName: true, serviceUserNumber: true } },
        },
        orderBy: { actualDateTime: q.sortOrder === 'asc' ? 'asc' : 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.medicationAdministrationEvent.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async stockLevels(userId: string, q: MedicationReportQueryDto, meta: RequestAuditMeta) {
    await this.logReport(userId, meta, 'stock_levels', q);
    this.assertServiceUserScope(q);
    const { from, to } = this.assertRange(q);
    const where: Prisma.MedicationStockRecordWhereInput = {
      deletedAt: null,
      isActive: true,
      movementDate: { gte: from, lte: to },
    };
    if (!q.allServiceUsers && q.serviceUserId) {
      where.medication = { serviceUserId: q.serviceUserId };
    }
    if (q.medicationId) where.serviceUserMedicationId = q.medicationId;
    const rows = await this.prisma.medicationStockRecord.findMany({
      where,
      include: { medication: true, recordedBy: { include: { personalDetail: true } } },
      orderBy: { movementDate: 'desc' },
      take: q.limit ?? 200,
    });
    return { data: rows, meta: { total: rows.length } };
  }

  async lateAdministrations(userId: string, q: MedicationReportQueryDto, meta: RequestAuditMeta) {
    await this.logReport(userId, meta, 'late_administrations', q);
    const { from, to } = this.assertRange(q);
    this.assertServiceUserScope(q);

    const where: Prisma.MedicationAdministrationEventWhereInput = {
      deletedAt: null,
      isActive: true,
      status: MedicationAdministrationStatus.GIVEN,
      scheduledDateTime: { not: null },
      actualDateTime: { gte: from, lte: to },
    };
    if (!q.allServiceUsers && q.serviceUserId) where.serviceUserId = q.serviceUserId;
    if (q.employeeId) where.administeredById = q.employeeId;
    if (q.medicationId) where.serviceUserMedicationId = q.medicationId;

    const candidates = await this.prisma.medicationAdministrationEvent.findMany({
      where,
      include: {
        medication: true,
        administeredBy: { include: { personalDetail: true } },
        serviceUser: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { actualDateTime: 'desc' },
      take: 2_000,
    });

    const thresholdMs = LATE_MINUTES * 60_000;
    const lateRows = candidates
      .map((e) => {
        const sched = e.scheduledDateTime!.getTime();
        const act = e.actualDateTime!.getTime();
        const delayMinutes = Math.round((act - sched) / 60_000);
        return { ...e, delayMinutes, isLate: act - sched > thresholdMs };
      })
      .filter((e) => e.isLate);

    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const skip = (page - 1) * limit;
    const slice = lateRows.slice(skip, skip + limit);

    return {
      data: slice,
      meta: {
        ...buildPaginationMeta({ page, limit, total: lateRows.length }),
        lateThresholdMinutes: LATE_MINUTES,
      },
    };
  }

  async auditReport(userId: string, q: MedicationReportQueryDto, meta: RequestAuditMeta) {
    await this.logReport(userId, meta, 'audit', q);
    this.assertServiceUserScope(q);
    const { from, to } = this.assertRange(q);
    const actions: string[] = [
      AuditAction.MEDICATION_CREATED,
      AuditAction.MEDICATION_UPDATED,
      AuditAction.MEDICATION_DELETED,
      AuditAction.MEDICATION_STATUS_CHANGED,
      AuditAction.MEDICATION_ADMINISTERED,
      AuditAction.MEDICATION_NOT_GIVEN,
      AuditAction.MEDICATION_REFUSED,
      AuditAction.MEDICATION_MISSED,
      AuditAction.MEDICATION_HELD,
      AuditAction.MEDICATION_CHART_VIEWED,
      AuditAction.MEDICATION_REPORT_GENERATED,
    ];
    const logs = await this.prisma.auditLog.findMany({
      where: {
        module: AuditModule.MEDICATION,
        createdAt: { gte: from, lte: to },
        action: { in: actions },
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit ?? 200,
    });

    const eventWhere: Prisma.MedicationAdministrationEventWhereInput = {
      deletedAt: null,
      createdAt: { gte: from, lte: to },
    };
    if (!q.allServiceUsers && q.serviceUserId) eventWhere.serviceUserId = q.serviceUserId;

    const events = await this.prisma.medicationAdministrationEvent.findMany({
      where: eventWhere,
      include: {
        medication: true,
        administeredBy: { include: { personalDetail: true } },
        serviceUser: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit ?? 200,
    });

    return {
      data: {
        auditLogs: logs,
        administrationEvents: events,
      },
      meta: { auditLogCount: logs.length, eventCount: events.length },
    };
  }
}
