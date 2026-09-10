import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import type { RequestUser } from '../common/decorators/current-user.decorator';
import { OrgScopeService } from '../common/org-scope/org-scope.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  SERVICE_USER_MONITORING_CONFIG_KEYS,
  isMedicalAlertAnswerKey,
  type ServiceUserMonitoringConfigKey,
} from './medical-clinical.constants';
import { assertServiceUserAccessible } from './medical-access.util';
import type { UpsertMonitoringConfigDto } from './dto/medical.dto';

function mapConfig(row: {
  id: string;
  serviceUserId: string;
  configKey: string;
  enabled: boolean;
  numericValue: { toString(): string } | null;
  booleanValue: boolean | null;
  textValue: string | null;
  notes: string;
  observationTypeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    configKey: row.configKey,
    enabled: row.enabled,
    numericValue: row.numericValue != null ? Number(row.numericValue.toString()) : null,
    booleanValue: row.booleanValue,
    textValue: row.textValue,
    notes: row.notes,
    observationTypeId: row.observationTypeId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertKnownKey(configKey: string): asserts configKey is ServiceUserMonitoringConfigKey {
  if (!(Object.values(SERVICE_USER_MONITORING_CONFIG_KEYS) as string[]).includes(configKey)) {
    throw new BadRequestException(`Unknown monitoring config key: ${configKey}`);
  }
}

function assertValidMonitoringValue(dto: UpsertMonitoringConfigDto) {
  assertKnownKey(dto.configKey);
  if (dto.configKey === SERVICE_USER_MONITORING_CONFIG_KEYS.WEIGHT_CHANGE_THRESHOLD_KG) {
    if (dto.numericValue == null || !(dto.numericValue > 0)) {
      throw new BadRequestException('WEIGHT_CHANGE_THRESHOLD_KG requires a positive numericValue');
    }
  }
  if (dto.configKey === SERVICE_USER_MONITORING_CONFIG_KEYS.FLUID_TARGET_REQUIRED) {
    if (typeof dto.booleanValue !== 'boolean') {
      throw new BadRequestException('FLUID_TARGET_REQUIRED requires a booleanValue');
    }
  }
  if (isMedicalAlertAnswerKey(dto.configKey)) {
    if (dto.textValue !== 'YES' && dto.textValue !== 'NO') {
      throw new BadRequestException(`${dto.configKey} requires textValue YES or NO`);
    }
  }
}

@Injectable()
export class MonitoringConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly orgScope: OrgScopeService,
  ) {}

  async list(user: RequestUser, serviceUserId: string) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    const rows = await this.prisma.serviceUserMonitoringConfig.findMany({
      where: { serviceUserId },
      orderBy: { configKey: 'asc' },
    });
    return { data: rows.map(mapConfig) };
  }

  async upsert(
    user: RequestUser,
    serviceUserId: string,
    dto: UpsertMonitoringConfigDto,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    assertValidMonitoringValue(dto);

    if (dto.observationTypeId) {
      const ot = await this.prisma.observationType.findFirst({
        where: { id: dto.observationTypeId, isActive: true },
      });
      if (!ot) throw new BadRequestException('Invalid observation type');
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.serviceUserMonitoringConfig.findUnique({
        where: {
          serviceUserId_configKey: { serviceUserId, configKey: dto.configKey },
        },
      });

      const data: {
        enabled: boolean;
        numericValue: number | null;
        booleanValue: boolean | null;
        textValue: string | null;
        notes: string;
        observationTypeId: string | null;
        updatedById: string;
      } = {
        enabled: dto.enabled ?? true,
        numericValue: null,
        booleanValue: null,
        textValue: dto.textValue !== undefined ? dto.textValue : existing?.textValue ?? null,
        notes: dto.notes !== undefined ? dto.notes.trim() : existing?.notes ?? '',
        observationTypeId:
          dto.observationTypeId !== undefined
            ? dto.observationTypeId
            : existing?.observationTypeId ?? null,
        updatedById: user.id,
      };

      if (dto.configKey === SERVICE_USER_MONITORING_CONFIG_KEYS.WEIGHT_CHANGE_THRESHOLD_KG) {
        data.numericValue = dto.numericValue!;
        data.booleanValue = null;
        data.textValue = null;
      }
      if (dto.configKey === SERVICE_USER_MONITORING_CONFIG_KEYS.FLUID_TARGET_REQUIRED) {
        data.booleanValue = dto.booleanValue!;
        data.numericValue = null;
        data.textValue = null;
      }
      if (isMedicalAlertAnswerKey(dto.configKey)) {
        data.textValue = dto.textValue!;
        data.numericValue = null;
        data.booleanValue = null;
      }

      const saved = existing
        ? await tx.serviceUserMonitoringConfig.update({
            where: { id: existing.id },
            data,
          })
        : await tx.serviceUserMonitoringConfig.create({
            data: {
              serviceUserId,
              configKey: dto.configKey,
              createdById: user.id,
              ...data,
            },
          });

      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_MONITORING_CONFIG_UPDATED,
        recordType: 'ServiceUserMonitoringConfig',
        recordId: saved.id,
        oldValues: existing
          ? auditSnapshot({
              id: existing.id,
              configKey: existing.configKey,
              enabled: existing.enabled,
            })
          : null,
        newValues: auditSnapshot({
          id: saved.id,
          configKey: saved.configKey,
          enabled: saved.enabled,
        }),
        metadata: { serviceUserId, configKey: dto.configKey },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Monitoring configuration saved', data: mapConfig(saved) };
    });
  }

  async deactivate(
    user: RequestUser,
    serviceUserId: string,
    configKey: string,
    meta?: RequestAuditMeta,
  ) {
    await assertServiceUserAccessible(this.prisma, this.orgScope, user, serviceUserId);
    assertKnownKey(configKey);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.serviceUserMonitoringConfig.findUnique({
        where: {
          serviceUserId_configKey: { serviceUserId, configKey },
        },
      });
      if (!existing) throw new NotFoundException('Monitoring configuration not found');

      const saved = await tx.serviceUserMonitoringConfig.update({
        where: { id: existing.id },
        data: { enabled: false, updatedById: user.id },
      });

      await this.audit.logAudit({
        tx,
        userId: user.id,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_MONITORING_CONFIG_UPDATED,
        recordType: 'ServiceUserMonitoringConfig',
        recordId: saved.id,
        oldValues: auditSnapshot({ id: existing.id, enabled: existing.enabled }),
        newValues: auditSnapshot({ id: saved.id, enabled: saved.enabled }),
        metadata: { serviceUserId, configKey, deactivated: true },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Monitoring configuration deactivated', data: mapConfig(saved) };
    });
  }
}
