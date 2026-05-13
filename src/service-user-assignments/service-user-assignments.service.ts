import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { UpdateServiceUserAssignmentDto } from './dto/update-service-user-assignment.dto';

@Injectable()
export class ServiceUserAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private async ensureActiveEmployee(id: string | null | undefined) {
    if (!id) return;
    const e = await this.prisma.employee.findFirst({
      where: { id, deletedAt: null, isActive: true },
    });
    if (!e) throw new BadRequestException(`Employee ${id} not found or inactive`);
  }

  private async ensureActiveLocation(id: string | null | undefined) {
    if (!id) return;
    const loc = await this.prisma.location.findFirst({
      where: { id, deletedAt: null, isActive: true },
    });
    if (!loc) throw new BadRequestException(`Location ${id} not found or inactive`);
  }

  async get(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);
    const row = await this.prisma.serviceUserAssignment.findFirst({
      where: { serviceUserId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        keyWorker: { include: { personalDetail: true } },
        namedNurse: { include: { personalDetail: true } },
        location: true,
      },
    });
    return { data: row };
  }

  async patch(userId: string, serviceUserId: string, dto: UpdateServiceUserAssignmentDto, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    await this.ensureActiveEmployee(dto.keyWorkerId ?? undefined);
    await this.ensureActiveEmployee(dto.namedNurseId ?? undefined);
    await this.ensureActiveLocation(dto.locationId ?? undefined);

    return this.prisma.$transaction(async (tx) => {
      const beforeAssignment = await tx.serviceUserAssignment.findFirst({
        where: { serviceUserId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
      });

      await tx.serviceUser.update({
        where: { id: serviceUserId },
        data: {
          ...(dto.keyWorkerId !== undefined ? { keyWorkerId: dto.keyWorkerId } : {}),
          ...(dto.namedNurseId !== undefined ? { namedNurseId: dto.namedNurseId } : {}),
          ...(dto.locationId !== undefined ? { locationId: dto.locationId } : {}),
          updatedById: userId,
        },
      });

      const userAfter = await tx.serviceUser.findFirst({ where: { id: serviceUserId } });
      const keyWorkerId =
        dto.keyWorkerId !== undefined ? dto.keyWorkerId : beforeAssignment?.keyWorkerId ?? userAfter?.keyWorkerId ?? null;
      const namedNurseId =
        dto.namedNurseId !== undefined
          ? dto.namedNurseId
          : beforeAssignment?.namedNurseId ?? userAfter?.namedNurseId ?? null;
      const locationId =
        dto.locationId !== undefined ? dto.locationId : beforeAssignment?.locationId ?? userAfter?.locationId ?? null;

      let assignment = beforeAssignment;
      if (assignment) {
        assignment = await tx.serviceUserAssignment.update({
          where: { id: assignment.id },
          data: {
            keyWorkerId: dto.keyWorkerId !== undefined ? dto.keyWorkerId : assignment.keyWorkerId,
            namedNurseId: dto.namedNurseId !== undefined ? dto.namedNurseId : assignment.namedNurseId,
            locationId: dto.locationId !== undefined ? dto.locationId : assignment.locationId,
            startDate:
              dto.startDate !== undefined
                ? dto.startDate
                  ? new Date(dto.startDate)
                  : null
                : assignment.startDate,
            endDate:
              dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : assignment.endDate,
            notes: dto.notes !== undefined ? dto.notes : assignment.notes,
            updatedById: userId,
          },
        });
      } else {
        assignment = await tx.serviceUserAssignment.create({
          data: {
            serviceUserId,
            keyWorkerId,
            namedNurseId,
            locationId,
            startDate: dto.startDate ? new Date(dto.startDate) : null,
            endDate: dto.endDate ? new Date(dto.endDate) : null,
            notes: dto.notes ?? null,
            createdById: userId,
          },
        });
      }

      const after = await tx.serviceUserAssignment.findFirst({
        where: { id: assignment.id },
        include: {
          keyWorker: { include: { personalDetail: true } },
          namedNurse: { include: { personalDetail: true } },
          location: true,
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_ASSIGNMENT_UPDATED,
        recordType: 'ServiceUserAssignment',
        recordId: assignment.id,
        oldValues: auditSnapshot(beforeAssignment),
        newValues: auditSnapshot(after),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Assignments updated', data: after };
    });
  }
}
