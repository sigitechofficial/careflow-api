import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { DEFAULT_CARER_MAX_WEEKLY_HOURS } from '../organisation-general-settings/dom-care-allocation-rules.util';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { UpdateEmployeeEmploymentDto } from './dto/update-employee-employment.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { RbacEmploymentSyncService } from './rbac-employment-sync.service';
import { assertEmployeeDefaultPayCard } from '../billing/pay-card-assignment.util';
import { recordEmployeePayCardChange } from '../billing/employee-pay-card-assignment.util';
import { syncLeavingRecordFromEmployment } from './employee-leaving-sync.util';

@Injectable()
export class EmployeeEmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly rbacEmploymentSync: RbacEmploymentSyncService,
  ) {}

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
        floorLocations: {
          include: { location: true },
        },
        serviceUserAreas: {
          include: {
            serviceUserArea: {
              select: {
                id: true,
                name: true,
                code: true,
                scheduleAreaId: true,
              },
            },
          },
        },
        defaultPayCard: {
          select: { id: true, name: true, code: true, status: true },
        },
      },
    });
    if (!employment) throw new NotFoundException('Employment details not found');

    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE,
        recordType: 'EmployeeEmployment',
        recordId: employment.id,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { employeeId },
      });
    }

    return {
      data: {
        ...employment,
        serviceUserAreaIds: employment.serviceUserAreas.map((row) => row.serviceUserAreaId),
      },
    };
  }

  async update(
    userId: string,
    employeeId: string,
    dto: UpdateEmployeeEmploymentDto,
    meta?: RequestAuditMeta,
  ) {
    const exists = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
    });
    if (!exists) throw new NotFoundException('Employee not found');

    // Maximum weekly hours can never be below contracted weekly hours: whichever is already set,
    // the other is checked against it.
    if (dto.contractedWeeklyHours !== undefined || dto.maximumWeeklyHours !== undefined) {
      const current = await this.prisma.employeeEmployment.findUnique({
        where: { employeeId },
        select: { contractedWeeklyHours: true, maximumWeeklyHours: true },
      });
      const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
      const contracted = num(dto.contractedWeeklyHours !== undefined ? dto.contractedWeeklyHours : current?.contractedWeeklyHours);
      const maximum = num(dto.maximumWeeklyHours !== undefined ? dto.maximumWeeklyHours : current?.maximumWeeklyHours);
      // A blank maximum means 60h.
      const effectiveMax = maximum != null && maximum > 0 ? maximum : DEFAULT_CARER_MAX_WEEKLY_HOURS;
      if (contracted != null && effectiveMax < contracted - 0.001) {
        throw new BadRequestException(
          dto.maximumWeeklyHours !== undefined && dto.maximumWeeklyHours !== null
            ? `Maximum weekly hours (${effectiveMax}h) can't be less than the contracted weekly hours (${contracted}h).`
            : `Contracted weekly hours (${contracted}h) can't be more than the maximum weekly hours (${effectiveMax}h${maximum == null || maximum <= 0 ? ' — the default when Maximum is blank' : ''}).`,
        );
      }
    }

    // Once set, contracted weekly hours only change through an approved hours request.
    if (dto.contractedWeeklyHours !== undefined) {
      const current = await this.prisma.employeeEmployment.findUnique({
        where: { employeeId },
        select: { contractedWeeklyHours: true },
      });
      const currentHours = current?.contractedWeeklyHours ?? null;
      if (
        currentHours != null &&
        Math.abs(Number(dto.contractedWeeklyHours) - currentHours) > 0.001
      ) {
        throw new BadRequestException(
          'Contracted weekly hours can only be changed through a manager-approved request. Send it for review instead.',
        );
      }
    }

    const { baseLocationIds, serviceUserAreaIds, defaultPayCardId, ...employmentScalars } = dto;

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

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.employeeEmployment.findUnique({ where: { employeeId } });
      const employment = await tx.employeeEmployment.upsert({
        where: { employeeId },
        update: {
          ...employmentScalars,
          ...(defaultPayCardId !== undefined ? { defaultPayCardId } : {}),
          ...agencyClear,
          updatedById: userId,
        },
        create: {
          employeeId,
          ...employmentScalars,
          ...(defaultPayCardId !== undefined ? { defaultPayCardId } : {}),
          ...agencyClear,
          createdById: userId,
        },
      });

      if (
        dto.endDate !== undefined ||
        dto.leavingReasonId !== undefined ||
        dto.leavingNotes !== undefined
      ) {
        await syncLeavingRecordFromEmployment(tx, employeeId, userId, {
          endDate: employment.endDate,
          leavingReasonId: employment.leavingReasonId,
          leavingNotes: employment.leavingNotes,
        });
      }

      if (defaultPayCardId !== undefined && defaultPayCardId !== (before?.defaultPayCardId ?? null)) {
        // Keep the dated pay card history in step (applies from today).
        await recordEmployeePayCardChange(tx, {
          employeeId,
          payCardId: defaultPayCardId,
          reason: 'Changed on employee profile',
          userId,
        });
      }

      if (defaultPayCardId !== undefined) {
        await assertEmployeeDefaultPayCard(tx, defaultPayCardId, {
          employeeId,
          roleId: employment.roleId,
          locationId: employment.locationId,
          baseLocationId: employment.baseLocationId,
          contractTypeId: employment.contractTypeId,
          isAgencyStaff: employment.isAgencyStaff,
          isBankStaff: employment.isBankStaff,
        });
      }

      if (baseLocationIds !== undefined) {
        const floorIds = [...baseLocationIds];
        const primaryLocationId = employmentScalars.locationId ?? employment.locationId ?? null;
        if (primaryLocationId && !floorIds.includes(primaryLocationId)) {
          floorIds.unshift(primaryLocationId);
        }

        await tx.employeeEmploymentFloorLocation.deleteMany({
          where: { employmentId: employment.id },
        });

        const extraFloorIds = floorIds.filter((id) => id !== primaryLocationId);
        if (extraFloorIds.length > 0) {
          await tx.employeeEmploymentFloorLocation.createMany({
            data: extraFloorIds.map((locationId) => ({
              employmentId: employment.id,
              locationId,
            })),
            skipDuplicates: true,
          });
        }

        // Keep legacy singular baseLocationId in sync with primary. Stale values here used to
        // reappear as a second "selected" branch on edit after saving one branch.
        await tx.employeeEmployment.update({
          where: { id: employment.id },
          data: { baseLocationId: primaryLocationId },
        });
      }

      if (serviceUserAreaIds !== undefined) {
        const uniqueAreaIds = [...new Set(serviceUserAreaIds.filter(Boolean))];
        if (uniqueAreaIds.length) {
          const found = await tx.serviceUserArea.findMany({
            where: { id: { in: uniqueAreaIds }, deletedAt: null, isActive: true },
            select: { id: true },
          });
          if (found.length !== uniqueAreaIds.length) {
            throw new NotFoundException('One or more service areas were not found');
          }
        }
        await tx.employeeEmploymentServiceUserArea.deleteMany({
          where: { employmentId: employment.id },
        });
        if (uniqueAreaIds.length) {
          await tx.employeeEmploymentServiceUserArea.createMany({
            data: uniqueAreaIds.map((serviceUserAreaId) => ({
              employmentId: employment.id,
              serviceUserAreaId,
            })),
            skipDuplicates: true,
          });
        }
      }

      const refreshed = await tx.employeeEmployment.findFirst({
        where: { id: employment.id },
        include: {
          floorLocations: { include: { location: true } },
          serviceUserAreas: {
            include: {
              serviceUserArea: {
                select: { id: true, name: true, code: true, scheduleAreaId: true },
              },
            },
          },
        },
      });

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
      return {
        message: 'Employment details updated',
        data: {
          ...refreshed!,
          serviceUserAreaIds: (refreshed?.serviceUserAreas ?? []).map((row) => row.serviceUserAreaId),
        },
      };
    });
  }
}
