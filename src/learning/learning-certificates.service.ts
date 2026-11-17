import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LearningCertificateStatus, LearningCourseStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import {
  IssueManualCertificateDto,
  LearningCertificateQueryDto,
  RevokeCertificateDto,
  VerifyCertificateDto,
} from './dto/learning.dto';
import { LearningSettingsService } from './learning-settings.service';
import { buildCertificatePdf, type CertificatePdfData } from './learning-certificate-pdf.util';
import { signedCertificatePdfUrl } from './learning-file.util';
import { CAREFLOW_LOGO_PNG } from './learning-certificate-logo';
import { readFile } from 'fs/promises';
import { safeUploadPath } from '../common/utils/upload-path.util';

const DELIVERY_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  FACE_TO_FACE: 'Face to face',
  VIRTUAL: 'Virtual (live online)',
  WORKPLACE: 'Workplace assessment',
  BLENDED: 'Blended',
};

type CertificateRow = Prisma.LearningCertificateGetPayload<{
  include: {
    course: { select: { title: true; code: true; cpdMinutes: true } };
    courseVersion: { select: { titleSnapshot: true; cpdMinutes: true } };
  };
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
      course?: {
        title: string;
        code: string;
        cpdMinutes?: number | null;
      } | null;
      courseVersion?: {
        titleSnapshot: string;
        cpdMinutes: number | null;
      } | null;
    },
    extras?: { employeeName?: string | null },
  ) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      employeeName: extras?.employeeName ?? null,
      assignmentId: row.assignmentId,
      courseId: row.courseId,
      // Title and CPD as they were on the version the learner completed.
      courseTitle:
        row.courseVersion?.titleSnapshot ?? row.course?.title ?? null,
      courseCode: row.course?.code ?? null,
      cpdMinutes: row.courseVersion
        ? row.courseVersion.cpdMinutes
        : (row.course?.cpdMinutes ?? null),
      courseVersionId: row.courseVersionId,
      certificateNumber: row.certificateNumber,
      issuedAt: row.issuedAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      verificationCode: row.verificationCode,
      status: row.status,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revocationReason: row.revocationReason,
      issuedById: row.issuedById ?? null,
      issueNotes: row.issueNotes ?? null,
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

    const now = new Date();
    const statusWhere: Prisma.LearningCertificateWhereInput =
      query.status === 'ACTIVE'
        ? { status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }
        : query.status === 'EXPIRED'
          ? { OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lt: now } }] }
          : {};
    const where: Prisma.LearningCertificateWhereInput = {
      ...(query.status ? { AND: [statusWhere] } : {}),
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
        include: {
          course: { select: { title: true, code: true, cpdMinutes: true } },
          courseVersion: { select: { titleSnapshot: true, cpdMinutes: true } },
        },
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
      include: {
        course: { select: { title: true, code: true, cpdMinutes: true } },
        courseVersion: { select: { titleSnapshot: true, cpdMinutes: true } },
      },
    });
    if (!row) throw new NotFoundException('Certificate not found');
    const names = await this.resolveEmployeeNames([row.employeeId]);
    return this.map(row, { employeeName: names.get(row.employeeId) ?? null });
  }

  /** Signed link to the certificate PDF. employeeId set = the carer may only open their own. */
  async pdfLink(id: string, employeeId?: string) {
    const row = await this.prisma.learningCertificate.findUnique({
      where: { id },
      select: { id: true, employeeId: true },
    });
    if (!row || (employeeId && row.employeeId !== employeeId)) {
      throw new NotFoundException('Certificate not found');
    }
    return { url: signedCertificatePdfUrl(row.id) };
  }

  /** The certificate as a PDF (17 Nov 2026, first design — to be finalised). */
  async pdf(id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const data = await this.pdfData(id);
    const safe = (v: string) => v.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      buffer: await buildCertificatePdf(data),
      fileName: `Certificate-${safe(data.carerName)}-${safe(data.courseCode ?? data.courseTitle)}.pdf`,
    };
  }

  private async pdfData(id: string): Promise<CertificatePdfData> {
    const row = await this.prisma.learningCertificate.findUnique({
      where: { id },
      include: {
        course: { select: { title: true, code: true, cpdMinutes: true, deliveryMethod: true } },
        courseVersion: { select: { titleSnapshot: true, cpdMinutes: true } },
        assignment: {
          select: {
            completedAt: true,
            reviews: {
              where: { kind: { in: ['OUTCOME_PASSED', 'OUTCOME_PASSED_AFTER_QUIZ'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { kind: true, createdById: true },
            },
            assessmentAttempts: {
              where: { result: 'PASSED', assessment: { sectionId: null } },
              select: { percentage: true },
            },
            sessionAttendees: {
              where: { attendanceStatus: 'ATTENDED' },
              select: { trainingEvent: { select: { trainerName: true } } },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Certificate not found');
    const [names, profile] = await Promise.all([
      this.resolveEmployeeNames([row.employeeId]),
      this.prisma.companyProfile.findFirst({
        select: { displayName: true, companyName: true, displayLogoUrl: true, companyLogoUrl: true },
      }),
    ]);
    const outcome = row.assignment?.reviews[0] ?? null;
    const signerId = outcome?.createdById ?? row.issuedById ?? null;
    const signer = signerId
      ? await this.prisma.user.findFirst({ where: { id: signerId }, select: { firstName: true, lastName: true } })
      : null;
    const signerName = signer ? [signer.firstName, signer.lastName].filter(Boolean).join(' ').trim() : null;
    const best = (row.assignment?.assessmentAttempts ?? [])
      .map((a) => (a.percentage == null ? null : Math.round(Number(a.percentage))))
      .filter((x): x is number => x != null)
      .sort((a, b) => b - a)[0];
    const quizPart = best != null ? `passed the final assessment with ${best}%` : null;
    const resultLine = outcome
      ? `Assessed as competent${signerName ? ` by ${signerName}` : ''}${
          outcome.kind === 'OUTCOME_PASSED_AFTER_QUIZ' && quizPart ? ` and ${quizPart}` : ''
        }.`
      : quizPart
        ? `${quizPart.charAt(0).toUpperCase()}${quizPart.slice(1)}.`
        : 'Completed all required learning.';
    const trainer = row.assignment?.sessionAttendees.find((s) => s.trainingEvent?.trainerName)?.trainingEvent
      ?.trainerName;
    return {
      organisationName: profile?.displayName?.trim() || profile?.companyName?.trim() || 'Care provider',
      // Organisation's own logo when uploaded, otherwise the Careflow app logo (user, 17 Nov 2026).
      logo:
        (await this.companyLogo(profile?.displayLogoUrl || profile?.companyLogoUrl || null)) ??
        CAREFLOW_LOGO_PNG,
      carerName: names.get(row.employeeId) ?? 'Carer',
      courseTitle: row.courseVersion?.titleSnapshot || row.course.title,
      courseCode: row.course.code ?? null,
      deliveryLabel: row.course.deliveryMethod ? (DELIVERY_LABEL[row.course.deliveryMethod] ?? null) : null,
      completedAt: row.assignment?.completedAt ?? row.issuedAt,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      cpdMinutes: row.courseVersion?.cpdMinutes ?? row.course.cpdMinutes ?? null,
      resultLine,
      trainerName: trainer ?? null,
      signedByName: signerName,
      signedByRole: outcome ? 'Assessed by' : 'Issued by',
      certificateNumber: row.certificateNumber,
      verificationCode: row.verificationCode,
      status: row.status,
      revocationReason: row.revocationReason ?? null,
    };
  }

  /** Company logo from the uploads folder (PNG or JPEG only; same rule as policy exports). */
  private async companyLogo(stored: string | null): Promise<Buffer | null> {
    const path = safeUploadPath(stored);
    if (!path) return null;
    try {
      const data = await readFile(path);
      const png = data.length > 8 && data.readUInt32BE(0) === 0x89504e47;
      const jpg = data.length > 2 && data[0] === 0xff && data[1] === 0xd8;
      return png || jpg ? data : null;
    } catch {
      return null;
    }
  }

  async issueForAssignment(assignmentId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const assignment = await db.learningAssignment.findUnique({
      where: { id: assignmentId },
      include: { course: true, progress: { include: { courseVersion: true } } },
    });
    if (!assignment?.employeeId || !assignment.progress) {
      throw new NotFoundException('Assignment not found');
    }
    // Certificate rules come from the learner's version (frozen at publish).
    const version = assignment.progress.courseVersion;
    const certificateEnabled = version
      ? version.certificateEnabled
      : assignment.course.certificateEnabled;
    if (!certificateEnabled) return null;

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
      (version
        ? version.certificateValidityDays
        : assignment.course.certificateValidityDays) ??
      settings.defaultCertificateValidityDays;
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

  /**
   * Manually issue a certificate for an employee + course without requiring LMS completion.
   * Uses the course's current/published version and optional expiry override.
   */
  async issueManual(
    userId: string,
    dto: IssueManualCertificateDto,
    meta?: RequestAuditMeta,
  ) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      include: { personalDetail: { select: { firstName: true, lastName: true } } },
    });
    if (!employee || employee.deletedAt) {
      throw new NotFoundException('Employee not found');
    }

    const course = await this.prisma.learningCourse.findUnique({
      where: { id: dto.courseId },
    });
    if (!course || course.deletedAt) {
      throw new NotFoundException('Course not found');
    }
    if (
      course.status !== LearningCourseStatus.PUBLISHED &&
      course.status !== LearningCourseStatus.ARCHIVED &&
      course.status !== LearningCourseStatus.WITHDRAWN
    ) {
      throw new BadRequestException('Certificate can only be issued for a published or archived course');
    }

    let courseVersionId = course.currentVersionId;
    if (!courseVersionId) {
      const version = await this.prisma.learningCourseVersion.findFirst({
        where: {
          courseId: course.id,
          status: { in: [LearningCourseStatus.PUBLISHED, LearningCourseStatus.ARCHIVED] },
        },
        orderBy: { versionNumber: 'desc' },
      });
      courseVersionId = version?.id ?? null;
    }
    if (!courseVersionId) {
      throw new BadRequestException('Course has no published version to attach to the certificate');
    }

    const existingActive = await this.prisma.learningCertificate.findFirst({
      where: {
        employeeId: dto.employeeId,
        courseId: dto.courseId,
        status: LearningCertificateStatus.ACTIVE,
      },
    });
    if (existingActive) {
      throw new BadRequestException(
        'This employee already has an active certificate for this course. Revoke it first if you need to re-issue.',
      );
    }

    const settings = await this.settings.getOrCreate();
    let expiresAt: Date | null = null;
    if (dto.expiresAt?.trim()) {
      expiresAt = new Date(dto.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new BadRequestException('Invalid expiresAt date');
      }
    } else {
      const validityDays =
        course.certificateValidityDays ?? settings.defaultCertificateValidityDays;
      expiresAt = validityDays ? new Date(Date.now() + validityDays * 86_400_000) : null;
    }

    const employeeName =
      [employee.personalDetail?.firstName, employee.personalDetail?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || employee.id;

    const row = await this.prisma.learningCertificate.create({
      data: {
        employeeId: dto.employeeId,
        assignmentId: null,
        courseId: dto.courseId,
        courseVersionId,
        certificateNumber: this.generateCertificateNumber(),
        verificationCode: randomUUID(),
        expiresAt,
        status: LearningCertificateStatus.ACTIVE,
        issuedById: userId,
        issueNotes: dto.issueNotes?.trim() || null,
      },
      include: {
        course: { select: { title: true, code: true, cpdMinutes: true } },
        courseVersion: { select: { titleSnapshot: true, cpdMinutes: true } },
      },
    });

    const mapped = this.map(row, { employeeName });
    await this.audit.logAudit({
      userId,
      module: AuditModule.LEARNING,
      action: 'learning_certificate_issued_manual',
      recordType: 'LearningCertificate',
      recordId: row.id,
      newValues: mapped,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return mapped;
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
      include: {
        course: { select: { title: true, code: true, cpdMinutes: true } },
        courseVersion: { select: { titleSnapshot: true, cpdMinutes: true } },
      },
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
      include: {
        course: { select: { title: true, code: true, cpdMinutes: true } },
        courseVersion: { select: { titleSnapshot: true, cpdMinutes: true } },
      },
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
