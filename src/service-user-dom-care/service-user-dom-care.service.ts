import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { PatchServiceUserDomCareDto } from './dto/patch-service-user-dom-care.dto';
import {
  LIVE_FUNDING_LINE_WHERE,
  totalAuthorisedWeeklyHours,
} from '../service-user-funding/authorised-hours.util';
import {
  currentServiceUserWeeklyHours,
  sameWeeklyHours,
  SERVICE_USER_HOURS_NEED_APPROVAL_MESSAGE,
  syncServiceUserWeeklyHours,
} from './service-user-weekly-hours-sync.util';

const DOC_SEGMENTS = ['service-users', 'dom-care', 'contracts'] as const;
const GENDER_PREF_QUESTION_NEEDLE = 'gender preference';
const ACCOMMODATION_QUESTION_NEEDLE = 'living accommodation';

type CarerBrief = { id: string; firstName: string; lastName: string };

function mapEmployeeToCarer(employee: {
  id: string;
  personalDetail: { firstName: string; lastName: string } | null;
}): CarerBrief {
  const p = employee.personalDetail;
  return {
    id: employee.id,
    firstName: p?.firstName ?? '',
    lastName: p?.lastName ?? '',
  };
}

function mapDomPayload(
  serviceUserId: string,
  row: {
    accessInstruction: string;
    accessRisks: string;
    doorCode: string | null;
    careInstructions: string;
    weeklyContractedHours: string | null;
    contractDocumentUrl: string | null;
    numberOfCarers: number;
    staffGenderPreference: string | null;
    accommodationType: unknown;
    preferredCarerLinks: Array<{ employee: { id: string; personalDetail: { firstName: string; lastName: string } | null } }>;
    blockedCarerLinks: Array<{ employee: { id: string; personalDetail: { firstName: string; lastName: string } | null } }>;
  },
) {
  return {
    serviceUserId,
    accessInstruction: row.accessInstruction,
    accessRisks: row.accessRisks,
    doorCode: row.doorCode,
    careInstructions: row.careInstructions,
    weeklyContractedHours: row.weeklyContractedHours,
    contractDocumentUrl: row.contractDocumentUrl,
    numberOfCarers: row.numberOfCarers,
    staffGenderPreference: row.staffGenderPreference,
    accommodationType: Array.isArray(row.accommodationType) ? row.accommodationType as string[] : null,
    preferredCarers: row.preferredCarerLinks.map((l) => mapEmployeeToCarer(l.employee)),
    blockedCarers: row.blockedCarerLinks.map((l) => mapEmployeeToCarer(l.employee)),
  };
}

function defaultPayload(serviceUserId: string) {
  return {
    serviceUserId,
    accessInstruction: '',
    accessRisks: '',
    doorCode: null as string | null,
    careInstructions: '',
    weeklyContractedHours: null as string | null,
    contractDocumentUrl: null as string | null,
    numberOfCarers: 1,
    staffGenderPreference: null as string | null,
    accommodationType: null as string[] | null,
    preferredCarers: [] as CarerBrief[],
    blockedCarers: [] as CarerBrief[],
  };
}

@Injectable()
export class ServiceUserDomCareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  filePublicUrl(fileName: string): string {
    return `/uploads/${DOC_SEGMENTS.join('/')}/${fileName}`;
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  /**
   * Read staff gender preference from the IA answer table (fallback when DOM Care field is null).
   */
  private async readGenderPreferenceFromIa(serviceUserId: string): Promise<string | null> {
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!submission) return null;

    const answer = await this.prisma.initialAssessmentAnswer.findFirst({
      where: {
        submissionId: submission.id,
        question: {
          questionText: { contains: GENDER_PREF_QUESTION_NEEDLE, mode: 'insensitive' },
          deletedAt: null,
        },
      },
      select: { selectedOptions: true },
    });
    if (!answer?.selectedOptions) return null;

    // selectedOptions is stored as JSON: ["male"], "male", or { value: "male" }
    const opts = answer.selectedOptions;
    if (Array.isArray(opts)) return typeof opts[0] === 'string' ? opts[0] : null;
    if (typeof opts === 'string') return opts;
    if (typeof opts === 'object' && opts !== null && 'value' in opts) {
      return typeof (opts as Record<string, unknown>).value === 'string'
        ? (opts as Record<string, unknown>).value as string
        : null;
    }
    return null;
  }

  /**
   * Sync the gender preference value back to the IA answer table.
   */
  private async syncGenderPreferenceToIa(
    tx: Prisma.TransactionClient,
    serviceUserId: string,
    value: string | null,
  ): Promise<void> {
    const submission = await tx.initialAssessmentSubmission.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!submission) return; // no IA submission yet — nothing to sync

    const question = await tx.initialAssessmentQuestion.findFirst({
      where: {
        questionText: { contains: GENDER_PREF_QUESTION_NEEDLE, mode: 'insensitive' },
        deletedAt: null,
        section: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!question) return;

    const selectedOptions = value ? [value] : [];
    await tx.initialAssessmentAnswer.upsert({
      where: {
        submissionId_questionId: { submissionId: submission.id, questionId: question.id },
      },
      create: {
        submissionId: submission.id,
        questionId: question.id,
        selectedOptions,
      },
      update: { selectedOptions },
    });
  }

  private async readAccommodationTypeFromIa(serviceUserId: string): Promise<string[] | null> {
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!submission) return null;
    const answer = await this.prisma.initialAssessmentAnswer.findFirst({
      where: {
        submissionId: submission.id,
        question: {
          questionText: { contains: ACCOMMODATION_QUESTION_NEEDLE, mode: 'insensitive' },
          deletedAt: null,
        },
      },
      select: { selectedOptions: true },
    });
    if (!answer?.selectedOptions) return null;
    const opts = answer.selectedOptions;
    if (Array.isArray(opts) && opts.length) return opts.filter((v): v is string => typeof v === 'string');
    return null;
  }

  private async syncAccommodationTypeToIa(
    tx: Prisma.TransactionClient,
    serviceUserId: string,
    value: string[] | null,
  ): Promise<void> {
    const submission = await tx.initialAssessmentSubmission.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!submission) return;
    const question = await tx.initialAssessmentQuestion.findFirst({
      where: {
        questionText: { contains: ACCOMMODATION_QUESTION_NEEDLE, mode: 'insensitive' },
        deletedAt: null,
        section: { deletedAt: null },
      },
      select: { id: true },
    });
    if (!question) return;
    const selectedOptions = value?.length ? value : [];
    await tx.initialAssessmentAnswer.upsert({
      where: {
        submissionId_questionId: { submissionId: submission.id, questionId: question.id },
      },
      create: { submissionId: submission.id, questionId: question.id, selectedOptions },
      update: { selectedOptions },
    });
  }

  private async ensureEmployeesExist(tx: Prisma.TransactionClient, employeeIds: string[]) {
    if (!employeeIds.length) return;
    const found = await tx.employee.findMany({
      where: { id: { in: employeeIds }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(employeeIds).size) {
      throw new BadRequestException('One or more selected employees are invalid or inactive');
    }
  }

  private domInclude() {
    return {
      preferredCarerLinks: { include: { employee: { include: { personalDetail: true } } } },
      blockedCarerLinks: { include: { employee: { include: { personalDetail: true } } } },
    } as const;
  }

  /** Weekly hours the funders agreed to pay for, across all live funding lines (Funding tab). */
  private async authorisedHours(serviceUserId: string): Promise<number | null> {
    const lines = await this.prisma.serviceUserFunding.findMany({
      where: { serviceUserId, ...LIVE_FUNDING_LINE_WHERE },
      select: { authorisedWeeklyHours: true },
    });
    return totalAuthorisedWeeklyHours(lines);
  }

  async get(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const row = await this.prisma.serviceUserDomCare.findUnique({
      where: { serviceUserId },
      include: this.domInclude(),
    });
    if (!row) {
      const payload = defaultPayload(serviceUserId);
      payload.staffGenderPreference = await this.readGenderPreferenceFromIa(serviceUserId);
      payload.accommodationType = await this.readAccommodationTypeFromIa(serviceUserId);
      return { data: { ...payload, authorisedWeeklyHours: await this.authorisedHours(serviceUserId) } };
    }
    const payload = mapDomPayload(serviceUserId, row);
    if (!payload.staffGenderPreference) {
      payload.staffGenderPreference = await this.readGenderPreferenceFromIa(serviceUserId);
    }
    if (!payload.accommodationType) {
      payload.accommodationType = await this.readAccommodationTypeFromIa(serviceUserId);
    }
    return { data: { ...payload, authorisedWeeklyHours: await this.authorisedHours(serviceUserId) } };
  }

  /** Active employees with personal details; scoped to DOM care read (no `employees.read` required). */
  async searchEmployeesForDomCare(serviceUserId: string, search?: string, limit = 20) {
    await this.ensureServiceUser(serviceUserId);
    const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const q = search?.trim() ?? '';
    const personalWhere: Prisma.EmployeePersonalDetailWhereInput = { deletedAt: null };
    if (q) {
      personalWhere.OR = [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }
    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      isActive: true,
      personalDetail: { is: personalWhere },
    };
    const rows = await this.prisma.employee.findMany({
      where,
      take,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        personalDetail: { select: { firstName: true, lastName: true } },
      },
    });
    const data = rows
      .filter((r) => r.personalDetail)
      .map((r) => ({
        id: r.id,
        firstName: r.personalDetail!.firstName,
        lastName: r.personalDetail!.lastName,
      }));
    return { data };
  }

  async patch(userId: string, serviceUserId: string, dto: PatchServiceUserDomCareDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      let dom = await tx.serviceUserDomCare.findUnique({
        where: { serviceUserId },
        include: this.domInclude(),
      });

      // Once set, weekly hours change only through a manager-approved request.
      if (
        dto.weeklyContractedHours !== undefined &&
        !sameWeeklyHours(dto.weeklyContractedHours, dom?.weeklyContractedHours)
      ) {
        const current = await currentServiceUserWeeklyHours(tx, serviceUserId);
        if (current != null && !sameWeeklyHours(current, dto.weeklyContractedHours)) {
          throw new BadRequestException(SERVICE_USER_HOURS_NEED_APPROVAL_MESSAGE);
        }
      }

      // Older door code kept on DOM Care. Carers see the key safe code on Home & access (the address), so this
      // is only ever cleared now; it is not copied into the assessment answer, which records what was said then.
      const doorCode =
        dto.doorCode === undefined
          ? undefined
          : dto.doorCode === null || dto.doorCode === ''
            ? null
            : dto.doorCode.trim();

      if (!dom) {
        dom = await tx.serviceUserDomCare.create({
          data: {
            serviceUserId,
            accessInstruction: dto.accessInstruction?.trim() ?? '',
            accessRisks: dto.accessRisks?.trim() ?? '',
            doorCode: doorCode === undefined ? null : doorCode,
            careInstructions: dto.careInstructions?.trim() ?? '',
            weeklyContractedHours:
              dto.weeklyContractedHours === undefined
                ? null
                : dto.weeklyContractedHours === null || dto.weeklyContractedHours === ''
                  ? null
                  : dto.weeklyContractedHours.trim(),
            numberOfCarers: dto.numberOfCarers ?? 1,
            staffGenderPreference:
              dto.staffGenderPreference === undefined
                ? null
                : dto.staffGenderPreference === null || dto.staffGenderPreference === ''
                  ? null
                  : dto.staffGenderPreference.trim(),
            accommodationType:
              dto.accommodationType === undefined
                ? Prisma.JsonNull
                : dto.accommodationType?.length
                  ? dto.accommodationType
                  : Prisma.JsonNull,
            createdById: userId,
          },
          include: this.domInclude(),
        });
      } else {
        dom = await tx.serviceUserDomCare.update({
          where: { id: dom.id },
          data: {
            ...(dto.accessInstruction !== undefined ? { accessInstruction: dto.accessInstruction.trim() } : {}),
            ...(dto.accessRisks !== undefined ? { accessRisks: dto.accessRisks.trim() } : {}),
            ...(doorCode !== undefined ? { doorCode } : {}),
            ...(dto.careInstructions !== undefined ? { careInstructions: dto.careInstructions.trim() } : {}),
            ...(dto.weeklyContractedHours !== undefined
              ? {
                  weeklyContractedHours:
                    dto.weeklyContractedHours === null || dto.weeklyContractedHours === ''
                      ? null
                      : dto.weeklyContractedHours.trim(),
                }
              : {}),
            ...(dto.numberOfCarers !== undefined ? { numberOfCarers: dto.numberOfCarers } : {}),
            ...(dto.staffGenderPreference !== undefined
              ? {
                  staffGenderPreference:
                    dto.staffGenderPreference === null || dto.staffGenderPreference === ''
                      ? null
                      : dto.staffGenderPreference.trim(),
                }
              : {}),
            ...(dto.accommodationType !== undefined
              ? { accommodationType: dto.accommodationType?.length ? dto.accommodationType : Prisma.JsonNull }
              : {}),
            updatedById: userId,
          },
          include: this.domInclude(),
        });
      }

      const nextPref =
        dto.preferredEmployeeIds !== undefined
          ? dto.preferredEmployeeIds
          : dom.preferredCarerLinks.map((l) => l.employeeId);
      const nextBloc =
        dto.blockedEmployeeIds !== undefined ? dto.blockedEmployeeIds : dom.blockedCarerLinks.map((l) => l.employeeId);
      const prefSet = new Set(nextPref);
      for (const b of nextBloc) {
        if (prefSet.has(b)) throw new BadRequestException('An employee cannot appear in both preferred and blocked carers');
      }
      await this.ensureEmployeesExist(tx, [...new Set([...nextPref, ...nextBloc])]);

      if (dto.preferredEmployeeIds !== undefined) {
        await tx.serviceUserDomCarePreferredCarer.deleteMany({ where: { serviceUserDomCareId: dom.id } });
        if (nextPref.length) {
          await tx.serviceUserDomCarePreferredCarer.createMany({
            data: nextPref.map((employeeId) => ({ serviceUserDomCareId: dom.id, employeeId })),
            skipDuplicates: true,
          });
        }
      }
      if (dto.blockedEmployeeIds !== undefined) {
        await tx.serviceUserDomCareBlockedCarer.deleteMany({ where: { serviceUserDomCareId: dom.id } });
        if (nextBloc.length) {
          await tx.serviceUserDomCareBlockedCarer.createMany({
            data: nextBloc.map((employeeId) => ({ serviceUserDomCareId: dom.id, employeeId })),
            skipDuplicates: true,
          });
        }
      }

      if (dto.staffGenderPreference !== undefined) {
        await this.syncGenderPreferenceToIa(tx, serviceUserId, dto.staffGenderPreference ?? null);
      }
      if (dto.accommodationType !== undefined) {
        await this.syncAccommodationTypeToIa(tx, serviceUserId, dto.accommodationType ?? null);
      }
      if (dto.weeklyContractedHours !== undefined) {
        await syncServiceUserWeeklyHours(tx, this.audit, {
          serviceUserId,
          value: dto.weeklyContractedHours,
          userId,
          source: 'dom_care',
          meta,
        });
      }

      const fresh = await tx.serviceUserDomCare.findUniqueOrThrow({
        where: { id: dom.id },
        include: this.domInclude(),
      });
      const payload = mapDomPayload(serviceUserId, fresh);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOM_CARE_UPDATED,
        recordType: 'ServiceUserDomCare',
        recordId: fresh.id,
        newValues: auditSnapshot(payload),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'DOM Care updated', data: { ...payload, authorisedWeeklyHours: await this.authorisedHours(serviceUserId) } };
    });
  }

  async uploadContract(
    userId: string,
    serviceUserId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!allowedMime.has(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Allowed: JPEG, PNG, WebP, PDF.');
    }
    const url = this.filePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      let dom = await tx.serviceUserDomCare.findUnique({ where: { serviceUserId } });
      if (!dom) {
        dom = await tx.serviceUserDomCare.create({
          data: {
            serviceUserId,
            contractDocumentUrl: url,
            numberOfCarers: 1,
            createdById: userId,
          },
        });
      } else {
        dom = await tx.serviceUserDomCare.update({
          where: { id: dom.id },
          data: { contractDocumentUrl: url, updatedById: userId },
        });
      }
      const fresh = await tx.serviceUserDomCare.findUniqueOrThrow({
        where: { id: dom.id },
        include: this.domInclude(),
      });
      const payload = mapDomPayload(serviceUserId, fresh);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOM_CARE_UPDATED,
        recordType: 'ServiceUserDomCare',
        recordId: fresh.id,
        newValues: auditSnapshot({ contractDocumentUrl: url }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Contract document uploaded', data: payload };
    });
  }
}
