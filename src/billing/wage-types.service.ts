import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { SetTravelGapSettingsDto, UpdateWageTypeDto } from './dto/wage-types.dto';
import { assertValidTravelGapSettings, loadTravelGapSettings, type TravelGapSettings } from './travel-gap-settings.store';
import { PAYCARD_SUPPORT, type WageTypeCode } from './wage-types.util';

@Injectable()
export class WageTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  /** Catalogue with how each type is supported today (pay card rule, UK payroll, partial, planned). */
  async list() {
    const rows = await this.prisma.wageType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return {
      data: rows.map((row) => ({
        ...row,
        support: PAYCARD_SUPPORT[row.code as WageTypeCode] ?? { level: 'PLANNED', note: 'Custom wage type.' },
      })),
    };
  }

  /** Only the display name, description and active flag are editable; codes, units and methods are protected. */
  async update(userId: string, code: string, dto: UpdateWageTypeDto, meta?: RequestAuditMeta) {
    const existing = await this.prisma.wageType.findUnique({ where: { code } });
    if (!existing) throw new NotFoundException('Wage type not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.wageType.update({
        where: { code },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          updatedById: userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.WAGE_TYPE_UPDATED,
        recordType: 'WageType',
        recordId: row.id,
        oldValues: { name: existing.name, description: existing.description, isActive: existing.isActive },
        newValues: { name: row.name, description: row.description, isActive: row.isActive },
        metadata: { code },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return row;
    });
    return {
      message: 'Wage type updated',
      data: { ...updated, support: PAYCARD_SUPPORT[updated.code as WageTypeCode] ?? null },
    };
  }

  /** Limits for paying the gap between two visits as waiting or travel time. */
  async getTravelGapSettings() {
    return { data: await loadTravelGapSettings(this.prisma) };
  }

  /**
   * Organisation policy: changing the limits changes carer pay for travel worked out from then on,
   * so it needs a reason and is audited. Visits already approved or paid keep their amounts.
   */
  async setTravelGapSettings(userId: string, dto: SetTravelGapSettingsDto, meta?: RequestAuditMeta) {
    const next: TravelGapSettings = {
      enabled: dto.enabled,
      basis: dto.basis,
      waitingGapMinutes: dto.waitingGapMinutes,
      breakGapMinutes: dto.breakGapMinutes,
      wentHomeGapMinutes: dto.wentHomeGapMinutes,
    };
    assertValidTravelGapSettings(next);
    const previous = await loadTravelGapSettings(this.prisma);
    if ((Object.keys(next) as (keyof TravelGapSettings)[]).every((k) => previous[k] === next[k])) {
      return { message: 'The travel settings are already set to that', data: previous };
    }
    const data = {
      travelGapPayEnabled: next.enabled,
      travelPayBasis: next.basis,
      travelWaitingGapMinutes: next.waitingGapMinutes,
      travelBreakGapMinutes: next.breakGapMinutes,
      travelWentHomeGapMinutes: next.wentHomeGapMinutes,
    };
    await this.prisma.$transaction(async (tx) => {
      const settings = await tx.organisationGeneralSettings.findFirst({ select: { id: true } });
      if (settings) {
        await tx.organisationGeneralSettings.update({ where: { id: settings.id }, data });
      } else {
        await tx.organisationGeneralSettings.create({ data });
      }
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.BILLING,
        action: AuditAction.TRAVEL_GAP_SETTINGS_CHANGED,
        recordType: 'OrganisationGeneralSettings',
        recordId: settings?.id,
        oldValues: previous,
        newValues: next,
        metadata: { reason: dto.reason.trim() },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
    });
    return {
      message: !next.enabled
        ? 'Gaps between visits are no longer paid automatically'
        : next.basis === 'DISTANCE'
          ? 'Travel is now worked out from the distance between visits'
          : 'Travel gap limits updated',
      data: next,
    };
  }
}
