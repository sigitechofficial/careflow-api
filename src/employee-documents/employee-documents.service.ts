import { Injectable, NotFoundException } from '@nestjs/common';
import { DataAccessType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import { CreateEmployeeDocumentDto } from './dto/create-employee-document.dto';
import { UpdateEmployeeDocumentDto } from './dto/update-employee-document.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

@Injectable()
export class EmployeeDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async list(employeeId: string) {
    const docs = await this.prisma.employeeDocument.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { uploadedDate: 'desc' },
    });
    return { data: docs };
  }

  async create(params: {
    userId: string;
    employeeId: string;
    dto: CreateEmployeeDocumentDto;
    file: Express.Multer.File;
    fileUrl: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    await this.ensureEmployee(params.employeeId);
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeDocument.create({
        data: {
          employeeId: params.employeeId,
          name: params.dto.name ?? params.file.originalname,
          description: params.dto.description,
          fileUrl: params.fileUrl,
          fileName: params.file.filename,
          fileSize: params.file.size,
          mimeType: params.file.mimetype,
          uploadedById: params.userId,
          uploadedDate: new Date(),
          tags: params.dto.tags ?? [],
          createdById: params.userId,
        },
      });
      await this.audit.logAudit({
        tx,
        userId: params.userId,
        module: AuditModule.EMPLOYEE_DOCUMENT,
        action: AuditAction.EMPLOYEE_DOCUMENT_UPLOADED,
        recordType: 'EmployeeDocument',
        recordId: created.id,
        newValues: auditSnapshot({
          id: created.id,
          employeeId: params.employeeId,
          name: created.name,
          mimeType: created.mimeType,
          fileSize: created.fileSize,
        }),
        ipAddress: params.ipAddress ?? undefined,
        userAgent: params.userAgent ?? undefined,
      });
      return { message: 'Document uploaded', data: created };
    });
  }

  async update(
    userId: string,
    employeeId: string,
    documentId: string,
    dto: UpdateEmployeeDocumentDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeDocument.findFirst({
        where: { id: documentId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Document not found');

      const updated = await tx.employeeDocument.update({
        where: { id: documentId },
        data: { ...dto, updatedById: userId },
      });
      const oldS = auditSnapshot(existing);
      const newS = auditSnapshot(updated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_DOCUMENT,
        action: AuditAction.EMPLOYEE_DOCUMENT_UPDATED,
        recordType: 'EmployeeDocument',
        recordId: documentId,
        oldValues: oldS,
        newValues: newS,
        metadata: { changedFields: this.audit.getChangedFields(oldS, newS), employeeId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Document updated', data: updated };
    });
  }

  async remove(userId: string, employeeId: string, documentId: string, meta?: RequestAuditMeta) {
    await this.ensureEmployee(employeeId);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.employeeDocument.findFirst({
        where: { id: documentId, employeeId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Document not found');

      await tx.employeeDocument.update({
        where: { id: documentId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.EMPLOYEE_DOCUMENT,
        action: AuditAction.EMPLOYEE_DOCUMENT_DELETED,
        recordType: 'EmployeeDocument',
        recordId: documentId,
        oldValues: auditSnapshot(existing),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });
      return { message: 'Document deleted', data: {} };
    });
  }

  async getDocument(employeeId: string, documentId: string) {
    const doc = await this.prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /** Load document metadata and record audit + data-access for download. */
  async getDocumentForDownload(
    userId: string,
    employeeId: string,
    documentId: string,
    meta?: RequestAuditMeta,
  ) {
    const doc = await this.getDocument(employeeId, documentId);
    await this.audit.logAudit({
      userId,
      module: AuditModule.EMPLOYEE_DOCUMENT,
      action: AuditAction.EMPLOYEE_DOCUMENT_DOWNLOADED,
      recordType: 'EmployeeDocument',
      recordId: documentId,
      metadata: auditSnapshot({ employeeId, name: doc.name, mimeType: doc.mimeType }),
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
    });
    await this.audit.logDataAccess({
      userId,
      module: AuditModule.EMPLOYEE_DOCUMENT,
      recordType: 'EmployeeDocument',
      recordId: documentId,
      accessType: DataAccessType.DOWNLOAD,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
      metadata: { employeeId },
    });
    return doc;
  }

  private async ensureEmployee(employeeId: string) {
    const exists = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Employee not found');
  }
}
