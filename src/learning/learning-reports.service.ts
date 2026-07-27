import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { LearningReportQueryDto } from './dto/learning.dto';

@Injectable()
export class LearningReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async assignments(query: LearningReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      employeeId: { not: null },
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.from || query.to
        ? {
            assignedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.learningAssignment.findMany({
        where,
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningAssignment.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async completions(query: LearningReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      courseCompletionStatus: 'COMPLETED' as const,
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.learningEmployeeProgress.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningEmployeeProgress.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async compliance(query: LearningReportQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.learningComplianceSnapshot.findMany({
        where,
        orderBy: { lastCalculatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningComplianceSnapshot.count({ where }),
    ]);
    return { data: rows, meta: buildPaginationMeta({ page, limit, total }) };
  }

  async exportAssignmentsCsv(userId: string, query: LearningReportQueryDto, meta?: RequestAuditMeta) {
    const result = await this.assignments({ ...query, page: 1, limit: 10_000 });
    const header = 'id,employeeId,courseId,status,assignedAt,dueAt,completedAt';
    const lines = result.data.map(
      (r) =>
        `${r.id},${r.employeeId},${r.courseId},${r.status},${r.assignedAt.toISOString()},${r.dueAt?.toISOString() ?? ''},${r.completedAt?.toISOString() ?? ''}`,
    );
    const csv = [header, ...lines].join('\n');

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: AuditAction.CSV_EXPORTED,
      recordType: 'LearningAssignment',
      description: 'Learning assignments report export',
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { csv, rowCount: result.data.length };
  }
}
