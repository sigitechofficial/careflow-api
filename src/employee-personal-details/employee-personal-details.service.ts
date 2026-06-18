import { Injectable, NotFoundException } from '@nestjs/common';
import type { Express } from 'express';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { UpdateEmployeePersonalDetailsDto } from './dto/update-employee-personal-details.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeePersonalDetailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async get(employeeId: string, audit?: RequestAuditMeta & { actorUserId?: string }) {
    const pd = await this.prisma.employeePersonalDetail.findFirst({
      where: { employeeId, deletedAt: null },
      include: { title: true, gender: true, nationality: true, status: true },
    });
    if (!pd) throw new NotFoundException('Personal details not found');

    if (audit?.actorUserId) {
      await this.audit.logDataAccess({
        userId: audit.actorUserId,
        module: AuditModule.EMPLOYEE,
        recordType: 'EmployeePersonalDetail',
        recordId: pd.id,
        accessType: DataAccessType.VIEW,
        ipAddress: audit.ipAddress ?? undefined,
        userAgent: audit.userAgent ?? undefined,
        metadata: { employeeId },
      });
    }

    return { data: pd };
  }

  async update(userId: string, employeeId: string, dto: UpdateEmployeePersonalDetailsDto, meta?: RequestAuditMeta) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.employeePersonalDetail.findUnique({ where: { employeeId } });
      const pd = await tx.employeePersonalDetail.upsert({
        where: { employeeId },
        update: { ...dto, updatedById: userId },
        create: {
          employeeId,
          firstName: dto.firstName ?? 'Unknown',
          lastName: dto.lastName ?? 'Unknown',
          username: dto.username ?? `employee-${employeeId}`,
          email: dto.email,
          titleId: dto.titleId,
          genderId: dto.genderId,
          nationalityId: dto.nationalityId,
          statusId: dto.statusId,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2,
          town: dto.town,
          country: dto.country,
          postcode: dto.postcode,
          homeTelephone: dto.homeTelephone,
          mobileTelephone: dto.mobileTelephone,
          photoUrl: dto.photoUrl,
          dateOfBirth: dto.dateOfBirth,
          createdById: userId,
        },
      });
      const oldS = auditSnapshot(before);
      const newS = auditSnapshot(pd);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE,
        action: AuditAction.EMPLOYEE_UPDATED,
        recordType: 'EmployeePersonalDetail',
        recordId: pd.id,
        oldValues: before ? oldS : {},
        newValues: newS,
        metadata: {
          employeeId,
          changedFields: this.audit.getChangedFields(before ? oldS : {}, newS),
        },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Personal details updated', data: pd };
    });
  }

  /** Persists `photoUrl` after multer has written the file under `/uploads/employees/photos/`. */
  async uploadPhoto(
    userId: string,
    employeeId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    const photoUrl = `/uploads/employees/photos/${file.filename}`;
    return this.update(userId, employeeId, { photoUrl }, meta);
  }
}
