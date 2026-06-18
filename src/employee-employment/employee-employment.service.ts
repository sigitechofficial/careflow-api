import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { UpdateEmployeeEmploymentDto } from './dto/update-employee-employment.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { RbacEmploymentSyncService } from './rbac-employment-sync.service';
import {
  assertEmploymentHoursWithinVisaLimit,
  parseEmployeeVisaTypes,
  type WeeklyHoursCapOverride,
} from '../organisation-general-settings/employee-visa-types.util';

const DEFAULT_SETTINGS_ID = '00000000-0000-4000-8000-000000000002';

@Injectable()
export class EmployeeEmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly rbacEmploymentSync: RbacEmploymentSyncService,
  ) {}

  private async loadImmigrationStatuses() {
    const row = await this.prisma.organisationGeneralSettings.findFirst({
      where: { id: DEFAULT_SETTINGS_ID },
      select: { employeeVisaTypes: true },
    });
    return parseEmployeeVisaTypes(row?.employeeVisaTypes);
  }

  private resolveCapOverride(
    dto: UpdateEmployeeEmploymentDto,
    existing?: {
      weeklyHoursCapOverride: number | null;
      weeklyHoursCapOverrideReason: string | null;
      weeklyHoursCapOverrideExpiresAt: Date | null;
    } | null,
  ): WeeklyHoursCapOverride {
    return {
      weeklyHoursCapOverride:
        dto.weeklyHoursCapOverride !== undefined
          ? dto.weeklyHoursCapOverride
          : (existing?.weeklyHoursCapOverride ?? null),
      weeklyHoursCapOverrideReason:
        dto.weeklyHoursCapOverrideReason !== undefined
          ? dto.weeklyHoursCapOverrideReason
          : (existing?.weeklyHoursCapOverrideReason ?? null),
      weeklyHoursCapOverrideExpiresAt:
        dto.weeklyHoursCapOverrideExpiresAt !== undefined
          ? dto.weeklyHoursCapOverrideExpiresAt
          : (existing?.weeklyHoursCapOverrideExpiresAt ?? null),
    };
  }

  private assertWeeklyHoursCapOverride(dto: UpdateEmployeeEmploymentDto) {
    if (dto.weeklyHoursCapOverride === undefined) return;
    if (dto.weeklyHoursCapOverride === null) return;
    const cap = dto.weeklyHoursCapOverride;
    if (!Number.isFinite(cap) || cap < 0 || cap > 168) {
      throw new BadRequestException('Weekly hours cap override must be between 0 and 168.');
    }
    const reason = dto.weeklyHoursCapOverrideReason?.trim();
    if (!reason) {
      throw new BadRequestException(
        'A reason is required when setting a weekly hours cap override.',
      );
    }
  }

  private async assertVisaWeeklyHourLimits(
    dto: UpdateEmployeeEmploymentDto,
    existing?: {
      visaTypeId: string | null;
      contractedWeeklyHours: number | null;
      maximumWeeklyHours: number | null;
      weeklyHoursCapOverride: number | null;
      weeklyHoursCapOverrideReason: string | null;
      weeklyHoursCapOverrideExpiresAt: Date | null;
    } | null,
  ) {
    const visaTypeId = dto.visaTypeId !== undefined ? dto.visaTypeId : (existing?.visaTypeId ?? null);
    if (!visaTypeId) return;
    const types = await this.loadImmigrationStatuses();
    const override = this.resolveCapOverride(dto, existing);
    const message = assertEmploymentHoursWithinVisaLimit(
      types,
      visaTypeId,
      {
        contractedWeeklyHours:
          dto.contractedWeeklyHours !== undefined
            ? dto.contractedWeeklyHours
            : existing?.contractedWeeklyHours,
        maximumWeeklyHours:
          dto.maximumWeeklyHours !== undefined ? dto.maximumWeeklyHours : existing?.maximumWeeklyHours,
      },
      override,
    );
    if (message) throw new BadRequestException(message);
  }

  private async assertLocations(locationIds: string[]) {
    if (locationIds.length === 0) return;
    const count = await this.prisma.location.count({
      where: { id: { in: locationIds }, deletedAt: null, isActive: true },
    });
    if (count !== locationIds.length) {
      throw new NotFoundException('One or more base locations were not found');
    }
  }

  private async syncBaseLocations(
    tx: Prisma.TransactionClient,
    employmentId: string,
    baseLocationIds: string[] | undefined,
    userId: string,
  ) {
    if (baseLocationIds === undefined) return;

    const uniqueIds = [...new Set(baseLocationIds.filter(Boolean))];
    await this.assertLocations(uniqueIds);

    await tx.employeeEmploymentBaseLocation.deleteMany({ where: { employmentId } });
    if (uniqueIds.length > 0) {
      await tx.employeeEmploymentBaseLocation.createMany({
        data: uniqueIds.map((locationId) => ({ employmentId, locationId })),
        skipDuplicates: true,
      });
    }

    await tx.employeeEmployment.update({
      where: { id: employmentId },
      data: {
        baseLocationId: uniqueIds[0] ?? null,
        updatedById: userId,
      },
    });
  }

  async get(employeeId: string, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const employment = await this.prisma.employeeEmployment.findFirst({
      where: { employeeId, deletedAt: null },
      include: {
        workArea: true,
        role: true,
        jobTitle: true,
        rbacLevel: true,
        grade: true,
        contractType: true,
        travelPaymentType: true,
        baseLocation: true,
        location: true,
        leavingReason: true,
        baseLocations: { include: { location: { select: { id: true, name: true } } } },
      },
    });
    if (!employment) throw new NotFoundException('Employment details not found');

    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE,
        recordType: 'EmployeeEmployment',
        recordId: employment.id,
        accessType: 'VIEW',
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { employeeId },
      });
    }

    return { data: employment };
  }

  async update(userId: string, employeeId: string, dto: UpdateEmployeeEmploymentDto, meta?: RequestAuditMeta) {
    const exists = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
    });
    if (!exists) throw new NotFoundException('Employee not found');

    const employmentDto = { ...dto };
    const baseLocationIds = employmentDto.baseLocationIds;
    delete employmentDto.baseLocationIds;

    const agencyClear =
      dto.isAgencyStaff === false
        ? {
            agencyName: null,
            agencyRating: null,
            isPreferredAgency: false,
            isBlacklisted: false,
            dailyRate: null,
            hourlyDayRate: null,
            hourlyNightRate: null,
          }
        : {};

    if (baseLocationIds !== undefined) {
      const uniqueIds = [...new Set(baseLocationIds.filter(Boolean))];
      employmentDto.baseLocationId = uniqueIds[0] ?? employmentDto.baseLocationId ?? undefined;
    }

    const existingEmployment = await this.prisma.employeeEmployment.findUnique({ where: { employeeId } });
    this.assertWeeklyHoursCapOverride(employmentDto);
    if (employmentDto.weeklyHoursCapOverride === null) {
      employmentDto.weeklyHoursCapOverrideReason = null;
      employmentDto.weeklyHoursCapOverrideExpiresAt = null;
    }
    await this.assertVisaWeeklyHourLimits(employmentDto, existingEmployment);

    return this.prisma.$transaction(async (tx) => {
      const before = existingEmployment ?? (await tx.employeeEmployment.findUnique({ where: { employeeId } }));
      const employment = await tx.employeeEmployment.upsert({
        where: { employeeId },
        update: {
          ...employmentDto,
          ...agencyClear,
          updatedById: userId,
        },
        create: {
          employeeId,
          ...employmentDto,
          ...agencyClear,
          createdById: userId,
        },
      });
      await this.syncBaseLocations(tx, employment.id, baseLocationIds, userId);

      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(employment);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYMENT_DETAILS_UPDATED,
        recordType: 'EmployeeEmployment',
        recordId: employment.id,
        oldValues: before ? oldS : {},
        newValues: newS,
        metadata: {
          employeeId,
          changedFields: this.audit.getChangedFields(before ? oldS : {}, newS),
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      await this.rbacEmploymentSync.syncUserRolesForEmployee(tx, employeeId);
      return { message: 'Employment details updated', data: employment };
    });
  }
}
