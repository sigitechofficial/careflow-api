import { Injectable, NotFoundException } from '@nestjs/common';
import { LearningCertificateStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  LearningCertificateQueryDto,
  RevokeCertificateDto,
  VerifyCertificateDto,
} from './dto/learning.dto';
import { LearningSettingsService } from './learning-settings.service';

type CertificateRow = Prisma.LearningCertificateGetPayload<{
  include: { course: { select: { title: true; code: true; cpdMinutes: true } } };
}>;

@Injectable()
export class LearningCertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly settings: LearningSettingsService,
  ) {}

  private map(
    row: Prisma.LearningCertificateGetPayload<object> & {
      course?: { title: string; code: string; cpdMinutes?: number | null } | null;
    },
    extras?: { employeeName?: string | null },
  ) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeName: extras?.employeeName ?? null,
      assignmentId: row.assignmentId,
      courseId: row.courseId,
      courseTitle: row.course?.title ?? null,
      courseCode: row.course?.code ?? null,
      cpdMinutes: row.course?.cpdMinutes ?? null,
      courseVersionId: row.courseVersionId,
      certificateNumber: row.certificateNumber,
      issuedAt: row.issuedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      verificationCode: row.verificationCode,
      status: row.status,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revocationReason: row.revocationReason,
    };
  }

  private generateCertificateNumber(): string {
    const year = new Date().getUTCFullYear();
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `LC-${year}-${suffix}`;
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

  private async enrich(rows: CertificateRow[]) {
    const names = await this.resolveEmployeeNames([...new Set(rows.map((r) => r.employeeId))]);
    return rows.map((r) => this.map(r, { employeeName: names.get(r.employeeId) ?? null }));
  }

  async list(query: LearningCertificateQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const search = query.search?.trim();

    let employeeIdsFromSearch: string[] | undefined;
    if (search) {
      const matches = await this.prisma.employee.findMany({
        where: {
          OR: [
            { personalDetail: { firstName: { contains: search, mode: 'insensitive' } } },
            { personalDetail: { lastName: { contains: search, mode: 'insensitive' } } },
          ],
        },
        select: { id: true },
        take: 200,
      });
      employeeIdsFromSearch = matches.map((e) => e.id);
    }

    const where: Prisma.LearningCertificateWhereInput = {
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(search
        ? {
            OR: [
              { certificateNumber: { contains: search, mode: 'insensitive' } },
              { course: { title: { contains: search, mode: 'insensitive' } } },
              { course: { code: { contains: search, mode: 'insensitive' } } },
              ...(employeeIdsFromSearch?.length
                ? [{ employeeId: { in: employeeIdsFromSearch } }]
                : []),
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.learningCertificate.findMany({
        where,
        include: { course: { select: { title: true, code: true, cpdMinutes: true } } },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.learningCertificate.count({ where }),
    ]);

    return {
      data: await this.enrich(rows),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.learningCertificate.findUnique({
      where: { id },
      include: { course: { select: { title: true, code: true, cpdMinutes: true } } },
    });
    if (!row) throw new NotFoundException('Certificate not found');
    const names = await this.resolveEmployeeNames([row.employeeId]);
    return this.map(row, { employeeName: names.get(row.employeeId) ?? null });
  }

  async issueForAssignment(assignmentId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const assignment = await db.learningAssignment.findUnique({
      where: { id: assignmentId },
      include: { course: true, progress: true },
    });
    if (!assignment?.employeeId || !assignment.progress) {
      throw new NotFoundException('Assignment not found');
    }
    if (!assignment.course.certificateEnabled) return null;

    const progress = assignment.progress;

    const existing = await db.learningCertificate.findFirst({
      where: {
        assignmentId,
        status: { in: [LearningCertificateStatus.ACTIVE, LearningCertificateStatus.EXPIRED] },
      },
    });
    if (existing) return existing;

    const settings = await this.settings.getOrCreate();
    const validityDays =
      assignment.course.certificateValidityDays ?? settings.defaultCertificateValidityDays;
    const expiresAt = validityDays
      ? new Date(Date.now() + validityDays * 86_400_000)
      : null;

    const create = async (client: Prisma.TransactionClient) =>
      client.learningCertificate.create({
        data: {
          employeeId: assignment.employeeId!,
          assignmentId,
          courseId: assignment.courseId,
          courseVersionId: progress.courseVersionId,
          certificateNumber: this.generateCertificateNumber(),
          verificationCode: randomUUID(),
          expiresAt,
          status: LearningCertificateStatus.ACTIVE,
        },
      });

    if (tx) return create(tx);
    return this.prisma.$transaction(create);
  }

  async revoke(id: string, userId: string, dto: RevokeCertificateDto, meta?: RequestAuditMeta) {
    const existing = await this.getById(id);
    const row = await this.prisma.learningCertificate.update({
      where: { id },
      data: {
        status: LearningCertificateStatus.REVOKED,
        revokedAt: new Date(),
        revokedById: userId,
        revocationReason: dto.revocationReason,
      },
      include: { course: { select: { title: true, code: true, cpdMinutes: true } } },
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_certificate_revoked',
      recordType: 'LearningCertificate',
      recordId: id,
      oldValues: existing,
      newValues: this.map(row, { employeeName: existing.employeeName }),
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return this.map(row, { employeeName: existing.employeeName });
  }

  async verify(dto: VerifyCertificateDto) {
    const row = await this.prisma.learningCertificate.findUnique({
      where: { verificationCode: dto.verificationCode },
      include: { course: { select: { title: true, code: true, cpdMinutes: true } } },
    });
    if (!row) throw new NotFoundException('Certificate not found');
    const names = await this.resolveEmployeeNames([row.employeeId]);
    return {
      valid: row.status === LearningCertificateStatus.ACTIVE,
      certificate: this.map(row, { employeeName: names.get(row.employeeId) ?? null }),
      courseTitle: row.course.title,
      courseCode: row.course.code,
    };
  }
}
