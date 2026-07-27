import { Injectable, NotFoundException } from '@nestjs/common';
import { LearningAssignmentStatus, LearningProgressStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { deriveComplianceStatus } from './learning-compliance.util';
import { LearningComplianceQueryDto } from './dto/learning.dto';
import { LearningSettingsService } from './learning-settings.service';

@Injectable()
export class LearningComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: LearningSettingsService,
    private readonly audit: AuditLogsService,
  ) {}

  private mapSnapshot(
    row: {
      id: string;
      employeeId: string;
      courseId: string;
      complianceStatus: string;
      assignmentId: string | null;
      dueAt: Date | null;
      expiresAt: Date | null;
      isExempt: boolean;
      statusReason: string | null;
      lastCalculatedAt: Date;
      course?: { title: string; code: string } | null;
    },
    extras?: { employeeName?: string | null; courseTitle?: string | null; courseCode?: string | null },
  ) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      courseId: row.courseId,
      employeeName: extras?.employeeName ?? null,
      courseTitle: extras?.courseTitle ?? row.course?.title ?? null,
      courseCode: extras?.courseCode ?? row.course?.code ?? null,
      complianceStatus: row.complianceStatus,
      assignmentId: row.assignmentId,
      dueAt: row.dueAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      isExempt: row.isExempt,
      statusReason: row.statusReason,
      lastCalculatedAt: row.lastCalculatedAt.toISOString(),
    };
  }

  private async resolveEmployeeNames(employeeIds: string[]) {
    if (employeeIds.length === 0) return new Map<string, string>();
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      include: { personalDetail: { select: { firstName: true, lastName: true } } },
    });
    return new Map(
      employees.map((e) => [
        e.id,
        [e.personalDetail?.firstName, e.personalDetail?.lastName].filter(Boolean).join(' ').trim() ||
          e.id,
      ]),
    );
  }

  private async buildWhere(query: LearningComplianceQueryDto): Promise<Prisma.LearningComplianceSnapshotWhereInput> {
    const where: Prisma.LearningComplianceSnapshotWhereInput = {
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
    };

    const search = query.search?.trim();
    if (!search) return where;

    const matchingEmployees = await this.prisma.employee.findMany({
      where: {
        OR: [
          { personalDetail: { firstName: { contains: search, mode: 'insensitive' } } },
          { personalDetail: { lastName: { contains: search, mode: 'insensitive' } } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    const employeeIds = matchingEmployees.map((e) => e.id);

    where.OR = [
      { course: { title: { contains: search, mode: 'insensitive' } } },
      { course: { code: { contains: search, mode: 'insensitive' } } },
      ...(employeeIds.length ? [{ employeeId: { in: employeeIds } }] : []),
    ];

    return where;
  }

  private async enrichSnapshots(
    rows: Array<{
      id: string;
      employeeId: string;
      courseId: string;
      complianceStatus: string;
      assignmentId: string | null;
      dueAt: Date | null;
      expiresAt: Date | null;
      isExempt: boolean;
      statusReason: string | null;
      lastCalculatedAt: Date;
      course?: { title: string; code: string } | null;
    }>,
  ) {
    const employeeNameById = await this.resolveEmployeeNames([
      ...new Set(rows.map((r) => r.employeeId)),
    ]);
    return rows.map((r) =>
      this.mapSnapshot(r, {
        employeeName: employeeNameById.get(r.employeeId) ?? null,
        courseTitle: r.course?.title ?? null,
        courseCode: r.course?.code ?? null,
      }),
    );
  }

  async recalculateForAssignment(assignmentId: string) {
    const assignment = await this.prisma.learningAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        progress: true,
        course: true,
        certificates: {
          where: { status: 'ACTIVE' },
          orderBy: { issuedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!assignment?.employeeId) return null;

    const settings = await this.settings.getOrCreate();
    const progressComplete =
      assignment.progress?.courseCompletionStatus === LearningProgressStatus.COMPLETED;

    const complianceStatus = deriveComplianceStatus({
      assignmentStatus: assignment.status,
      progressComplete,
      dueAt: assignment.dueAt,
      expiresAt: assignment.certificates[0]?.expiresAt ?? null,
      isExempt: assignment.status === LearningAssignmentStatus.EXEMPT,
      expiryWarningDays: settings.defaultExpiryWarningDays,
    });

    return this.prisma.learningComplianceSnapshot.upsert({
      where: {
        employeeId_courseId: {
          employeeId: assignment.employeeId,
          courseId: assignment.courseId,
        },
      },
      create: {
        employeeId: assignment.employeeId,
        courseId: assignment.courseId,
        assignmentId: assignment.id,
        courseVersionId: assignment.courseVersionId,
        certificateId: assignment.certificates[0]?.id,
        dueAt: assignment.dueAt,
        expiresAt: assignment.certificates[0]?.expiresAt,
        complianceStatus,
        isExempt: assignment.status === LearningAssignmentStatus.EXEMPT,
      },
      update: {
        assignmentId: assignment.id,
        courseVersionId: assignment.courseVersionId,
        certificateId: assignment.certificates[0]?.id,
        dueAt: assignment.dueAt,
        expiresAt: assignment.certificates[0]?.expiresAt,
        complianceStatus,
        isExempt: assignment.status === LearningAssignmentStatus.EXEMPT,
        lastCalculatedAt: new Date(),
      },
    });
  }

  async matrix(query: LearningComplianceQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = await this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.learningComplianceSnapshot.findMany({
        where,
        include: { course: { select: { title: true, code: true } } },
        orderBy: { lastCalculatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningComplianceSnapshot.count({ where }),
    ]);

    return {
      data: await this.enrichSnapshots(rows),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async employees(query: LearningComplianceQueryDto) {
    return this.matrix(query);
  }

  async courses(query: LearningComplianceQueryDto) {
    return this.matrix(query);
  }

  async exportCsv(userId: string, query: LearningComplianceQueryDto, meta?: RequestAuditMeta) {
    const where = await this.buildWhere(query);
    const rows = await this.prisma.learningComplianceSnapshot.findMany({
      where,
      include: { course: { select: { title: true, code: true } } },
      orderBy: { lastCalculatedAt: 'desc' },
    });
    const enriched = await this.enrichSnapshots(rows);

    const header =
      'employeeName,employeeId,courseTitle,courseCode,courseId,complianceStatus,dueAt,expiresAt,isExempt';
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = enriched.map((r) =>
      [
        escape(r.employeeName ?? ''),
        r.employeeId,
        escape(r.courseTitle ?? ''),
        escape(r.courseCode ?? ''),
        r.courseId,
        r.complianceStatus,
        r.dueAt ?? '',
        r.expiresAt ?? '',
        String(r.isExempt),
      ].join(','),
    );
    const csv = [header, ...lines].join('\n');

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: AuditAction.CSV_EXPORTED,
      recordType: 'LearningComplianceSnapshot',
      description: 'Learning compliance matrix export',
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { csv, rowCount: rows.length };
  }

  async getEmployeeCompliance(employeeId: string) {
    const rows = await this.prisma.learningComplianceSnapshot.findMany({
      where: { employeeId },
      include: { course: { select: { title: true, code: true } } },
      orderBy: { lastCalculatedAt: 'desc' },
    });
    if (rows.length === 0) throw new NotFoundException('No compliance records for employee');
    return this.enrichSnapshots(rows);
  }
}
