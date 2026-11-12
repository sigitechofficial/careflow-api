import { Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeLifecycleStatus, HrDocumentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateHrDocumentDto } from './dto/create-hr-document.dto';

@Injectable()
export class HrDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(employeeId: string) {
    await this.ensureEmployee(employeeId);
    const docs = await this.prisma.employeeDocument.findMany({
      where: {
        employeeId,
        deletedAt: null,
        documentType: { not: null },
      },
      orderBy: { uploadedDate: 'desc' },
    });
    return { data: docs };
  }

  async create(params: {
    userId: string;
    employeeId: string;
    dto: CreateHrDocumentDto;
    file: Express.Multer.File;
    fileUrl: string;
    meta?: RequestAuditMeta;
  }) {
    await this.ensureEmployee(params.employeeId);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeDocument.create({
        data: {
          employeeId: params.employeeId,
          name: params.dto.name ?? params.file.originalname,
          fileUrl: params.fileUrl,
          fileName: params.file.filename,
          fileSize: params.file.size,
          mimeType: params.file.mimetype,
          uploadedById: params.userId,
          uploadedDate: new Date(),
          documentType: params.dto.documentType,
          expiryDate: params.dto.expiryDate ?? null,
          status: params.dto.status ?? HrDocumentStatus.PENDING,
          tags: ['hr'],
          createdById: params.userId,
        },
      });

      await this.audit.logAudit({
        tx,
        userId: params.userId,
        module: AuditModule.HR,
        action: AuditAction.HR_DOCUMENT_UPLOADED,
        recordType: 'EmployeeDocument',
        recordId: created.id,
        newValues: auditSnapshot({
          id: created.id,
          employeeId: params.employeeId,
          documentType: created.documentType,
          status: created.status,
        }),
        ipAddress: params.meta?.ipAddress ?? undefined,
        userAgent: params.meta?.userAgent ?? undefined,
      });

      return { message: 'HR document uploaded', data: created };
    });
  }

  async remove(userId: string, documentId: string, meta?: RequestAuditMeta) {
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id: documentId, deletedAt: null, documentType: { not: null } },
    });
    if (!doc) throw new NotFoundException('HR document not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeDocument.update({
        where: { id: documentId },
        data: {
          deletedAt: new Date(),
          deletedById: userId,
          isActive: false,
        },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.HR,
        action: AuditAction.HR_DOCUMENT_DELETED,
        recordType: 'EmployeeDocument',
        recordId: documentId,
        oldValues: auditSnapshot({ id: doc.id, employeeId: doc.employeeId }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'HR document deleted', data: updated };
    });
  }

  /** Approve or reject an uploaded HR document. */
  async updateStatus(userId: string, documentId: string, status: HrDocumentStatus, meta?: RequestAuditMeta) {
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id: documentId, deletedAt: null, documentType: { not: null } },
    });
    if (!doc) throw new NotFoundException('HR document not found');
    if (doc.status === status) return { message: 'HR document unchanged', data: doc };

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employeeDocument.update({
        where: { id: documentId },
        data: { status, updatedById: userId },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.HR,
        action: AuditAction.HR_DOCUMENT_STATUS_CHANGED,
        recordType: 'EmployeeDocument',
        recordId: documentId,
        oldValues: auditSnapshot({ id: doc.id, employeeId: doc.employeeId, status: doc.status }),
        newValues: auditSnapshot({ id: doc.id, employeeId: doc.employeeId, status }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'HR document updated', data: updated };
    });
  }

  /**
   * HR documents that have expired or expire within `days` (soonest first), for the HR dashboard.
   * Rejected documents and people who have left are not included.
   */
  async expiring(days = 30) {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const until = new Date(today.getTime() + (days + 1) * 86_400_000);
    const rows = await this.prisma.employeeDocument.findMany({
      where: {
        deletedAt: null,
        documentType: { not: null },
        expiryDate: { lt: until },
        OR: [{ status: null }, { status: { not: HrDocumentStatus.REJECTED } }],
        employee: {
          deletedAt: null,
          OR: [
            { hrProfile: { is: null } },
            {
              hrProfile: {
                is: { employeeLifecycleStatus: { notIn: [EmployeeLifecycleStatus.LEFT, EmployeeLifecycleStatus.ALUMNI] } },
              },
            },
          ],
        },
      },
      select: {
        id: true,
        name: true,
        documentType: true,
        status: true,
        expiryDate: true,
        employeeId: true,
        employee: { select: { personalDetail: { select: { firstName: true, lastName: true } } } },
      },
      orderBy: { expiryDate: 'asc' },
      take: 100,
    });
    return {
      data: rows.map(({ employee, ...doc }) => ({
        ...doc,
        employeeName:
          [employee.personalDetail?.firstName, employee.personalDetail?.lastName].filter(Boolean).join(' ') ||
          'Unnamed employee',
      })),
    };
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }
}
