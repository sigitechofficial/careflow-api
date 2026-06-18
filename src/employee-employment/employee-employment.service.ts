import { Injectable, NotFoundException } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { UpdateEmployeeEmploymentDto } from './dto/update-employee-employment.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { RbacEmploymentSyncService } from './rbac-employment-sync.service';

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

    return { data: employment };
  }

  async update(userId: string, employeeId: string, dto: UpdateEmployeeEmploymentDto, meta?: RequestAuditMeta) {
    const exists = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
    });
    if (!exists) throw new NotFoundException('Employee not found');

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
          ...dto,
          ...agencyClear,
          updatedById: userId,
        },
        create: {
          employeeId,
          ...dto,
          ...agencyClear,
          createdById: userId,
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
      return { message: 'Employment details updated', data: employment };
    });
  }
}
