import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import { assertServiceUserAccessible } from './medical-access.util';
import type { UpdateUsualParameterDto, UpsertUsualParameterDto } from './dto/medical.dto';

function mapUsual(row: {
  id: string;
  serviceUserId: string;
  observationTypeId: string;
  enabled: boolean;
  usualNumericValue: { toString(): string } | null;
  usualTextValue: string | null;
  usualPayload: Prisma.JsonValue | null;
  lowerBand: { toString(): string } | null;
  upperBand: { toString(): string } | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
  observationType?: { id: string; code: string; name: string };
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    observationTypeId: row.observationTypeId,
    enabled: row.enabled,
    usualNumericValue:
      row.usualNumericValue != null ? Number(row.usualNumericValue.toString()) : null,
    usualTextValue: row.usualTextValue,
    usualPayload: row.usualPayload,
    lowerBand: row.lowerBand != null ? Number(row.lowerBand.toString()) : null,
    upperBand: row.upperBand != null ? Number(row.upperBand.toString()) : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    observationType: row.observationType
      ? {
          id: row.observationType.id,
          code: row.observationType.code,
          name: row.observationType.name,
        }
      : undefined,
  };
}

function assertBands(lower?: number | null, upper?: number | null) {
  if (lower != null && upper != null && lower > upper) {
    throw new BadRequestException('lowerBand must be less than or equal to upperBand');
  }
}

@Injectable()
export class UsualParametersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async list(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const rows = await this.prisma.serviceUserUsualParameter.findMany({
      where: { serviceUserId },
      include: {
        observationType: { select: { id: true, code: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: rows.map(mapUsual) };
  }

  async upsert(
    user: RequestUser,
    serviceUserId: string,
    dto: UpsertUsualParameterDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const ot = await this.prisma.observationType.findFirst({
      where: { id: dto.observationTypeId, isActive: true },
    });
    if (!ot) throw new BadRequestException('Invalid observation type');
    assertBands(dto.lowerBand, dto.upperBand);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.serviceUserUsualParameter.findUnique({
        where: {
          serviceUserId_observationTypeId: {
            serviceUserId,
            observationTypeId: dto.observationTypeId,
          },
        },
      });

      const data = {
        enabled: dto.enabled ?? true,
        usualNumericValue: dto.usualNumericValue ?? null,
        usualTextValue: dto.usualTextValue ?? null,
        usualPayload:
          dto.usualPayload === undefined
            ? existing?.usualPayload ?? Prisma.JsonNull
            : dto.usualPayload === null
              ? Prisma.JsonNull
              : (dto.usualPayload as Prisma.InputJsonValue),
        lowerBand: dto.lowerBand ?? null,
        upperBand: dto.upperBand ?? null,
        notes: dto.notes?.trim() ?? existing?.notes ?? '',
        updatedById: user.id,
      };

      const saved = existing
        ? await tx.serviceUserUsualParameter.update({
            where: { id: existing.id },
            data,
            include: {
              observationType: { select: { id: true, code: true, name: true } },
            },
          })
        : await tx.serviceUserUsualParameter.create({
            data: {
              serviceUserId,
              observationTypeId: dto.observationTypeId,
              createdById: user.id,
              ...data,
            },
            include: {
              observationType: { select: { id: true, code: true, name: true } },
            },
          });

      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_USUAL_PARAMETER_UPSERTED,
        recordType: 'ServiceUserUsualParameter',
        recordId: saved.id,
        oldValues: existing
          ? auditSnapshot({
              id: existing.id,
              observationTypeId: existing.observationTypeId,
              enabled: existing.enabled,
            })
          : null,
        newValues: auditSnapshot({
          id: saved.id,
          observationTypeId: saved.observationTypeId,
          enabled: saved.enabled,
        }),
        metadata: { serviceUserId, observationTypeId: dto.observationTypeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return {
        message: existing ? 'Usual parameter updated' : 'Usual parameter recorded',
        data: mapUsual(saved),
      };
    });
  }

  async update(
    user: RequestUser,
    serviceUserId: string,
    id: string,
    dto: UpdateUsualParameterDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.serviceUserUsualParameter.findFirst({
        where: { id, serviceUserId },
        include: {
          observationType: { select: { id: true, code: true, name: true } },
        },
      });
      if (!before) throw new NotFoundException('Usual parameter not found');

      const nextLower =
        dto.lowerBand !== undefined
          ? dto.lowerBand
          : before.lowerBand != null
            ? Number(before.lowerBand.toString())
            : null;
      const nextUpper =
        dto.upperBand !== undefined
          ? dto.upperBand
          : before.upperBand != null
            ? Number(before.upperBand.toString())
            : null;
      assertBands(nextLower, nextUpper);

      const updated = await tx.serviceUserUsualParameter.update({
        where: { id },
        data: {
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.usualNumericValue !== undefined
            ? { usualNumericValue: dto.usualNumericValue }
            : {}),
          ...(dto.usualTextValue !== undefined ? { usualTextValue: dto.usualTextValue } : {}),
          ...(dto.usualPayload !== undefined
            ? {
                usualPayload:
                  dto.usualPayload === null
                    ? Prisma.JsonNull
                    : (dto.usualPayload as Prisma.InputJsonValue),
              }
            : {}),
          ...(dto.lowerBand !== undefined ? { lowerBand: dto.lowerBand } : {}),
          ...(dto.upperBand !== undefined ? { upperBand: dto.upperBand } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() } : {}),
          updatedById: user.id,
        },
        include: {
          observationType: { select: { id: true, code: true, name: true } },
        },
      });

      const deactivated = dto.enabled === false;
      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: deactivated
          ? AuditAction.SERVICE_USER_USUAL_PARAMETER_DEACTIVATED
          : AuditAction.SERVICE_USER_USUAL_PARAMETER_UPSERTED,
        recordType: 'ServiceUserUsualParameter',
        recordId: id,
        oldValues: auditSnapshot({ id: before.id, enabled: before.enabled }),
        newValues: auditSnapshot({ id: updated.id, enabled: updated.enabled }),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Usual parameter updated', data: mapUsual(updated) };
    });
  }

  /** Create-only path that returns 409 on duplicate (non-upsert). */
  async createStrict(
    user: RequestUser,
    serviceUserId: string,
    dto: UpsertUsualParameterDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const ot = await this.prisma.observationType.findFirst({
      where: { id: dto.observationTypeId, isActive: true },
    });
    if (!ot) throw new BadRequestException('Invalid observation type');
    assertBands(dto.lowerBand, dto.upperBand);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.serviceUserUsualParameter.create({
          data: {
            serviceUserId,
            observationTypeId: dto.observationTypeId,
            enabled: dto.enabled ?? true,
            usualNumericValue: dto.usualNumericValue ?? null,
            usualTextValue: dto.usualTextValue ?? null,
            usualPayload:
              dto.usualPayload == null
                ? Prisma.JsonNull
                : (dto.usualPayload as Prisma.InputJsonValue),
            lowerBand: dto.lowerBand ?? null,
            upperBand: dto.upperBand ?? null,
            notes: dto.notes?.trim() ?? '',
            createdById: user.id,
            updatedById: user.id,
          },
          include: {
            observationType: { select: { id: true, code: true, name: true } },
          },
        });
        await this.audit.logAudit({
          tx,
          userId: user.id,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.SERVICE_USER_USUAL_PARAMETER_UPSERTED,
          recordType: 'ServiceUserUsualParameter',
          recordId: created.id,
          newValues: auditSnapshot({
            id: created.id,
            observationTypeId: created.observationTypeId,
          }),
          metadata: { serviceUserId },
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
        return { message: 'Usual parameter recorded', data: mapUsual(created) };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          'A usual parameter already exists for this observation type',
        );
      }
      throw e;
    }
  }
}
