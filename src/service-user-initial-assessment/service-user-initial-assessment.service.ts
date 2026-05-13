import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { PatchServiceUserInitialAssessmentDto } from './dto/patch-service-user-initial-assessment.dto';

const PIC_SEGMENTS = ['service-users', 'initial-assessment', 'pictures'] as const;

function sanitizeChecklist(raw: unknown): Prisma.InputJsonObject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= 450) break;
    if (!/^[a-z][a-z0-9_]{0,95}$/i.test(k)) continue;
    if (typeof v !== 'boolean') continue;
    out[k] = v;
    n++;
  }
  return out as Prisma.InputJsonObject;
}

function checklistFromDb(value: Prisma.JsonValue): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

function mapRow(serviceUserId: string, row: {
  numberOfCarers: number;
  likesToBeKnownAs: string | null;
  doorCode: string | null;
  accessRisks: string;
  accessInstruction: string;
  reasonForAdmission: string;
  previousMedicalHistory: string;
  careInstructions: string;
  assessmentPictureUrl: string | null;
  checklist: Prisma.JsonValue;
  culturalReligiousNotes: string;
  careCarerNumbersNote: string;
  additionalRisksNotes: string;
  environmentAccessHazardsNotes: string;
  hydrationComment: string;
  nutritionComment: string;
}) {
  return {
    serviceUserId,
    numberOfCarers: row.numberOfCarers,
    likesToBeKnownAs: row.likesToBeKnownAs,
    doorCode: row.doorCode,
    accessRisks: row.accessRisks,
    accessInstruction: row.accessInstruction,
    reasonForAdmission: row.reasonForAdmission,
    previousMedicalHistory: row.previousMedicalHistory,
    careInstructions: row.careInstructions,
    assessmentPictureUrl: row.assessmentPictureUrl,
    checklist: checklistFromDb(row.checklist),
    culturalReligiousNotes: row.culturalReligiousNotes,
    careCarerNumbersNote: row.careCarerNumbersNote,
    additionalRisksNotes: row.additionalRisksNotes,
    environmentAccessHazardsNotes: row.environmentAccessHazardsNotes,
    hydrationComment: row.hydrationComment,
    nutritionComment: row.nutritionComment,
  };
}

function defaultPayload(serviceUserId: string) {
  return mapRow(serviceUserId, {
    numberOfCarers: 1,
    likesToBeKnownAs: null,
    doorCode: null,
    accessRisks: '',
    accessInstruction: '',
    reasonForAdmission: '',
    previousMedicalHistory: '',
    careInstructions: '',
    assessmentPictureUrl: null,
    checklist: {},
    culturalReligiousNotes: '',
    careCarerNumbersNote: '',
    additionalRisksNotes: '',
    environmentAccessHazardsNotes: '',
    hydrationComment: '',
    nutritionComment: '',
  });
}

type IaRow = {
  id: string;
  serviceUserId: string;
  numberOfCarers: number;
  likesToBeKnownAs: string | null;
  doorCode: string | null;
  accessRisks: string;
  accessInstruction: string;
  reasonForAdmission: string;
  previousMedicalHistory: string;
  careInstructions: string;
  assessmentPictureUrl: string | null;
  checklist: Prisma.JsonValue;
  culturalReligiousNotes: string;
  careCarerNumbersNote: string;
  additionalRisksNotes: string;
  environmentAccessHazardsNotes: string;
  hydrationComment: string;
  nutritionComment: string;
};

/** Prisma delegate; cast until `npx prisma generate` includes this model. */
type SuIaClient = {
  serviceUserInitialAssessment: {
    findUnique: (args: unknown) => Promise<IaRow | null>;
    create: (args: unknown) => Promise<IaRow>;
    update: (args: unknown) => Promise<IaRow>;
  };
};

@Injectable()
export class ServiceUserInitialAssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private ia(db: unknown): SuIaClient {
    return db as SuIaClient;
  }

  picturePublicUrl(fileName: string): string {
    return `/uploads/${PIC_SEGMENTS.join('/')}/${fileName}`;
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  async get(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const row = await this.ia(this.prisma).serviceUserInitialAssessment.findUnique({
      where: { serviceUserId },
    });
    if (!row) return { data: defaultPayload(serviceUserId) };
    return { data: mapRow(serviceUserId, row) };
  }

  async patch(
    userId: string,
    serviceUserId: string,
    dto: PatchServiceUserInitialAssessmentDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      let row = await this.ia(tx).serviceUserInitialAssessment.findUnique({ where: { serviceUserId } });

      const doorCode =
        dto.doorCode === undefined
          ? undefined
          : dto.doorCode === null || dto.doorCode === ''
            ? null
            : dto.doorCode.trim();

      const likes =
        dto.likesToBeKnownAs === undefined
          ? undefined
          : dto.likesToBeKnownAs === null || dto.likesToBeKnownAs === ''
            ? null
            : dto.likesToBeKnownAs.trim();

      let checklistForDb: Prisma.InputJsonObject | undefined;
      if (dto.checklistJson !== undefined) {
        const rawStr = dto.checklistJson.trim();
        if (rawStr === '') {
          checklistForDb = {};
        } else {
          try {
            checklistForDb = sanitizeChecklist(JSON.parse(rawStr) as unknown);
          } catch {
            throw new BadRequestException('checklistJson must be valid JSON');
          }
        }
      }

      if (!row) {
        row = await this.ia(tx).serviceUserInitialAssessment.create({
          data: {
            serviceUserId,
            numberOfCarers: dto.numberOfCarers ?? 1,
            likesToBeKnownAs: likes === undefined ? null : likes,
            doorCode: doorCode === undefined ? null : doorCode,
            accessRisks: dto.accessRisks?.trim() ?? '',
            accessInstruction: dto.accessInstruction?.trim() ?? '',
            reasonForAdmission: dto.reasonForAdmission?.trim() ?? '',
            previousMedicalHistory: dto.previousMedicalHistory?.trim() ?? '',
            careInstructions: dto.careInstructions?.trim() ?? '',
            checklist: checklistForDb ?? {},
            culturalReligiousNotes: dto.culturalReligiousNotes?.trim() ?? '',
            careCarerNumbersNote: dto.careCarerNumbersNote?.trim() ?? '',
            additionalRisksNotes: dto.additionalRisksNotes?.trim() ?? '',
            environmentAccessHazardsNotes: dto.environmentAccessHazardsNotes?.trim() ?? '',
            hydrationComment: dto.hydrationComment?.trim() ?? '',
            nutritionComment: dto.nutritionComment?.trim() ?? '',
            createdById: userId,
          },
        });
      } else {
        row = await this.ia(tx).serviceUserInitialAssessment.update({
          where: { id: row.id },
          data: {
            ...(dto.numberOfCarers !== undefined ? { numberOfCarers: dto.numberOfCarers } : {}),
            ...(likes !== undefined ? { likesToBeKnownAs: likes } : {}),
            ...(doorCode !== undefined ? { doorCode } : {}),
            ...(dto.accessRisks !== undefined ? { accessRisks: dto.accessRisks.trim() } : {}),
            ...(dto.accessInstruction !== undefined ? { accessInstruction: dto.accessInstruction.trim() } : {}),
            ...(dto.reasonForAdmission !== undefined ? { reasonForAdmission: dto.reasonForAdmission.trim() } : {}),
            ...(dto.previousMedicalHistory !== undefined
              ? { previousMedicalHistory: dto.previousMedicalHistory.trim() }
              : {}),
            ...(dto.careInstructions !== undefined ? { careInstructions: dto.careInstructions.trim() } : {}),
            ...(checklistForDb !== undefined ? { checklist: checklistForDb } : {}),
            ...(dto.culturalReligiousNotes !== undefined
              ? { culturalReligiousNotes: dto.culturalReligiousNotes.trim() }
              : {}),
            ...(dto.careCarerNumbersNote !== undefined
              ? { careCarerNumbersNote: dto.careCarerNumbersNote.trim() }
              : {}),
            ...(dto.additionalRisksNotes !== undefined
              ? { additionalRisksNotes: dto.additionalRisksNotes.trim() }
              : {}),
            ...(dto.environmentAccessHazardsNotes !== undefined
              ? { environmentAccessHazardsNotes: dto.environmentAccessHazardsNotes.trim() }
              : {}),
            ...(dto.hydrationComment !== undefined ? { hydrationComment: dto.hydrationComment.trim() } : {}),
            ...(dto.nutritionComment !== undefined ? { nutritionComment: dto.nutritionComment.trim() } : {}),
            updatedById: userId,
          },
        });
      }

      const payload = mapRow(serviceUserId, row);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_INITIAL_ASSESSMENT_UPDATED,
        recordType: 'ServiceUserInitialAssessment',
        recordId: row.id,
        newValues: auditSnapshot(payload),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Initial assessment updated', data: payload };
    });
  }

  async uploadPicture(
    userId: string,
    serviceUserId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMime.has(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Allowed: JPEG, PNG, WebP.');
    }
    const url = this.picturePublicUrl(file.filename);
    return this.prisma.$transaction(async (tx) => {
      let row = await this.ia(tx).serviceUserInitialAssessment.findUnique({ where: { serviceUserId } });
      if (!row) {
        row = await this.ia(tx).serviceUserInitialAssessment.create({
          data: {
            serviceUserId,
            assessmentPictureUrl: url,
            numberOfCarers: 1,
            createdById: userId,
          },
        });
      } else {
        row = await this.ia(tx).serviceUserInitialAssessment.update({
          where: { id: row.id },
          data: { assessmentPictureUrl: url, updatedById: userId },
        });
      }
      const payload = mapRow(serviceUserId, row);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_INITIAL_ASSESSMENT_UPDATED,
        recordType: 'ServiceUserInitialAssessment',
        recordId: row.id,
        newValues: auditSnapshot({ assessmentPictureUrl: url }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Assessment picture uploaded', data: payload };
    });
  }
}
