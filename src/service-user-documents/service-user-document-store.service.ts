import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ServiceUserDocumentAccessLevel } from '@prisma/client';
import { DataAccessType } from '@prisma/client';
import { createReadStream, existsSync } from 'fs';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { CreateServiceUserDocumentRecordDto } from './dto/create-service-user-document-record.dto';
import { UpdateServiceUserDocumentRecordDto } from './dto/update-service-user-document-record.dto';
import {
  buildDocumentStoreCompliance,
  carePlanApprovalBlockedByDocuments,
} from './document-store-compliance.util';
import { safeUploadPath } from '../common/utils/upload-path.util';

const DOC_SEGMENTS = ['service-users', 'documents', 'store'] as const;

const ACCESS_RANK: Record<ServiceUserDocumentAccessLevel, number> = {
  MANAGER_ONLY: 0,
  COORDINATOR_MANAGER: 1,
  CARER_SUMMARY: 2,
  ALL_USERS: 3,
};

function parseCalendarDate(value: string | null | undefined, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) throw new BadRequestException(`Invalid ${field}`);
  return dt;
}

function mapDocumentType(row: {
  id: string;
  code: string;
  name: string;
  physicalLocationInHomeRequired: boolean;
  expiryTrackingRequired: boolean;
  defaultAccessLevel: ServiceUserDocumentAccessLevel;
  requiredBeforeFirstVisit: boolean;
  blocksCarePlanApprovalIfMissing: boolean;
  expiryAlertDays: number | null;
  cqcLegalStandard: string | null;
  sortOrder: number;
}) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    physicalLocationInHomeRequired: row.physicalLocationInHomeRequired,
    expiryTrackingRequired: row.expiryTrackingRequired,
    defaultAccessLevel: row.defaultAccessLevel,
    requiredBeforeFirstVisit: row.requiredBeforeFirstVisit,
    blocksCarePlanApprovalIfMissing: row.blocksCarePlanApprovalIfMissing,
    expiryAlertDays: row.expiryAlertDays,
    cqcLegalStandard: row.cqcLegalStandard,
    sortOrder: row.sortOrder,
  };
}

function mapDocumentRecord(row: {
  id: string;
  serviceUserId: string;
  documentTypeId: string;
  title: string;
  documentDate: Date;
  uploadedAt: Date;
  uploadedById: string | null;
  supersedesDocumentId: string | null;
  expiryDate: Date | null;
  physicalLocationInHome: string | null;
  accessLevel: ServiceUserDocumentAccessLevel;
  status: string;
  linkedRecordType: string | null;
  linkedRecordId: string | null;
  notes: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  createdAt: Date;
  updatedAt: Date;
  documentType: Parameters<typeof mapDocumentType>[0];
  uploadedBy?: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
}) {
  return {
    id: row.id,
    serviceUserId: row.serviceUserId,
    documentTypeId: row.documentTypeId,
    title: row.title,
    documentDate: row.documentDate.toISOString().slice(0, 10),
    uploadedAt: row.uploadedAt.toISOString(),
    uploadedById: row.uploadedById,
    uploadedByName: row.uploadedBy
      ? [row.uploadedBy.firstName, row.uploadedBy.lastName].filter(Boolean).join(' ') || row.uploadedBy.email
      : null,
    supersedesDocumentId: row.supersedesDocumentId,
    expiryDate: row.expiryDate ? row.expiryDate.toISOString().slice(0, 10) : null,
    physicalLocationInHome: row.physicalLocationInHome,
    accessLevel: row.accessLevel,
    status: row.status,
    linkedRecordType: row.linkedRecordType,
    linkedRecordId: row.linkedRecordId,
    notes: row.notes,
    fileUrl: row.fileUrl,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    documentType: mapDocumentType(row.documentType),
  };
}

@Injectable()
export class ServiceUserDocumentStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  filePublicUrl(fileName: string): string {
    return `/uploads/${DOC_SEGMENTS.join('/')}/${fileName}`;
  }

  private documentInclude() {
    return {
      documentType: true,
      uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    } satisfies Prisma.ServiceUserDocumentRecordInclude;
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  private validateAccessLevel(
    chosen: ServiceUserDocumentAccessLevel,
    defaultLevel: ServiceUserDocumentAccessLevel,
  ) {
    if (ACCESS_RANK[chosen] > ACCESS_RANK[defaultLevel]) {
      throw new BadRequestException(
        'Access level cannot be less restrictive than the document type default',
      );
    }
  }

  private validateRequiredFields(
    type: {
      physicalLocationInHomeRequired: boolean;
      expiryTrackingRequired: boolean;
    },
    physicalLocationInHome: string | null | undefined,
    expiryDate: Date | null | undefined,
  ) {
    if (type.physicalLocationInHomeRequired && !physicalLocationInHome?.trim()) {
      throw new BadRequestException('Physical location in home is required for this document type');
    }
    if (type.expiryTrackingRequired && !expiryDate) {
      throw new BadRequestException('Expiry date is required for this document type');
    }
  }

  async listDocumentTypes() {
    const rows = await this.prisma.serviceUserDocumentTypeCatalog.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return { data: rows.map(mapDocumentType) };
  }

  async getStore(serviceUserId: string) {
    await this.ensureServiceUser(serviceUserId);

    const [documentTypes, documents, legal, mcaAssessment, activeMedicationCount, activeDolsCount] =
      await Promise.all([
      this.prisma.serviceUserDocumentTypeCatalog.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.serviceUserDocumentRecord.findMany({
        where: { serviceUserId, deletedAt: null },
        include: this.documentInclude(),
        orderBy: [{ status: 'asc' }, { documentDate: 'desc' }, { uploadedAt: 'desc' }],
      }),
      this.prisma.serviceUserLegalDocument.findUnique({ where: { serviceUserId } }),
      this.prisma.serviceUserAssessment.findUnique({
        where: { serviceUserId_assessmentKey: { serviceUserId, assessmentKey: 'mca-screening' } },
        include: { completions: { take: 1 } },
      }),
      this.prisma.serviceUserMedication.count({
        where: { serviceUserId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.serviceUserDolsRecord.count({
        where: {
          serviceUserId,
          deletedAt: null,
          isActive: true,
          isCurrent: true,
        },
      }),
    ]);

    const mappedDocuments = documents.map(mapDocumentRecord);
    const activeDocuments = documents.filter((d) => d.status === 'ACTIVE');
    const compliance = buildDocumentStoreCompliance({
      documents: activeDocuments,
      legal,
      mcaAssessmentComplete: Boolean(mcaAssessment?.completions?.length),
      medicationSupportRequired: activeMedicationCount > 0,
      hasActiveDols: activeDolsCount > 0,
    });

    return {
      data: {
        documentTypes: documentTypes.map(mapDocumentType),
        documents: mappedDocuments,
        compliance,
        carePlanApprovalBlocked: carePlanApprovalBlockedByDocuments(compliance),
        medicationSupportRequired: activeMedicationCount > 0,
      },
    };
  }

  async createRecord(
    userId: string,
    serviceUserId: string,
    dto: CreateServiceUserDocumentRecordDto,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    if (!file) throw new BadRequestException('File is required');
    this.validateCertMime(file.mimetype);
    await this.ensureServiceUser(serviceUserId);

    const documentType = await this.prisma.serviceUserDocumentTypeCatalog.findFirst({
      where: { id: dto.documentTypeId, deletedAt: null, isActive: true },
    });
    if (!documentType) throw new NotFoundException('Document type not found');

    const documentDate = parseCalendarDate(dto.documentDate, 'documentDate');
    if (!documentDate) throw new BadRequestException('documentDate is required');

    const expiryDate = parseCalendarDate(dto.expiryDate, 'expiryDate');
    const physicalLocation = dto.physicalLocationInHome?.trim() || null;
    this.validateRequiredFields(documentType, physicalLocation, expiryDate ?? null);

    const accessLevel = dto.accessLevel ?? documentType.defaultAccessLevel;
    this.validateAccessLevel(accessLevel, documentType.defaultAccessLevel);

    const url = this.filePublicUrl(file.filename);

    return this.prisma.$transaction(async (tx) => {
      if (dto.supersedesDocumentId) {
        const superseded = await tx.serviceUserDocumentRecord.findFirst({
          where: { id: dto.supersedesDocumentId, serviceUserId, deletedAt: null },
        });
        if (!superseded) throw new NotFoundException('Superseded document not found');
        await tx.serviceUserDocumentRecord.update({
          where: { id: superseded.id },
          data: { status: 'SUPERSEDED', updatedById: userId },
        });
      }

      const row = await tx.serviceUserDocumentRecord.create({
        data: {
          serviceUserId,
          documentTypeId: dto.documentTypeId,
          title: dto.title.trim(),
          documentDate,
          uploadedById: userId,
          supersedesDocumentId: dto.supersedesDocumentId ?? null,
          expiryDate: expiryDate ?? null,
          physicalLocationInHome: physicalLocation,
          accessLevel,
          status: dto.status ?? 'ACTIVE',
          linkedRecordType: dto.linkedRecordType?.trim() || null,
          linkedRecordId: dto.linkedRecordId ?? null,
          notes: dto.notes?.trim() || null,
          fileUrl: url,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          createdById: userId,
        },
        include: this.documentInclude(),
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOCUMENT_RECORD_CREATED,
        recordType: 'ServiceUserDocumentRecord',
        recordId: row.id,
        newValues: auditSnapshot(mapDocumentRecord(row)),
        metadata: { serviceUserId, documentTypeCode: documentType.code },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Document uploaded', data: mapDocumentRecord(row) };
    });
  }

  async updateRecord(
    userId: string,
    serviceUserId: string,
    documentId: string,
    dto: UpdateServiceUserDocumentRecordDto,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.serviceUserDocumentRecord.findFirst({
        where: { id: documentId, serviceUserId, deletedAt: null },
        include: { documentType: true },
      });
      if (!existing) throw new NotFoundException('Document not found');

      const documentDate =
        dto.documentDate === undefined ? undefined : parseCalendarDate(dto.documentDate, 'documentDate');
      if (documentDate === null) throw new BadRequestException('documentDate is required');
      const expiryDate = parseCalendarDate(dto.expiryDate, 'expiryDate');
      const physicalLocation =
        dto.physicalLocationInHome === undefined
          ? undefined
          : dto.physicalLocationInHome?.trim() || null;

      const nextPhysical =
        physicalLocation !== undefined ? physicalLocation : existing.physicalLocationInHome;
      const nextExpiry = expiryDate !== undefined ? expiryDate : existing.expiryDate;
      this.validateRequiredFields(existing.documentType, nextPhysical, nextExpiry);

      if (dto.accessLevel) {
        this.validateAccessLevel(dto.accessLevel, existing.documentType.defaultAccessLevel);
      }

      if (dto.supersedesDocumentId && dto.supersedesDocumentId !== existing.supersedesDocumentId) {
        const superseded = await tx.serviceUserDocumentRecord.findFirst({
          where: { id: dto.supersedesDocumentId, serviceUserId, deletedAt: null },
        });
        if (!superseded) throw new NotFoundException('Superseded document not found');
        await tx.serviceUserDocumentRecord.update({
          where: { id: superseded.id },
          data: { status: 'SUPERSEDED', updatedById: userId },
        });
      }

      const oldSnap = auditSnapshot(mapDocumentRecord({ ...existing, documentType: existing.documentType }));

      const patchData: Prisma.ServiceUserDocumentRecordUpdateInput = {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(documentDate !== undefined ? { documentDate } : {}),
        ...(expiryDate !== undefined ? { expiryDate } : {}),
        ...(physicalLocation !== undefined ? { physicalLocationInHome: physicalLocation } : {}),
        ...(dto.accessLevel !== undefined ? { accessLevel: dto.accessLevel } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.linkedRecordType !== undefined
          ? { linkedRecordType: dto.linkedRecordType?.trim() || null }
          : {}),
        ...(dto.linkedRecordId !== undefined ? { linkedRecordId: dto.linkedRecordId } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}),
        updatedById: userId,
      };

      if (dto.supersedesDocumentId !== undefined) {
        patchData.supersedes = dto.supersedesDocumentId
          ? { connect: { id: dto.supersedesDocumentId } }
          : { disconnect: true };
      }

      const updated = await tx.serviceUserDocumentRecord.update({
        where: { id: documentId },
        data: patchData,
        include: this.documentInclude(),
      });

      const mappedUpdated = mapDocumentRecord({
        ...updated,
        documentType: updated.documentType,
      });
      const newSnap = auditSnapshot(mappedUpdated);
      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOCUMENT_RECORD_UPDATED,
        recordType: 'ServiceUserDocumentRecord',
        recordId: documentId,
        oldValues: oldSnap,
        newValues: newSnap,
        metadata: { changedFields: this.audit.getChangedFields(oldSnap, newSnap), serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Document updated', data: mappedUpdated };
    });
  }

  async removeRecord(userId: string, serviceUserId: string, documentId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.serviceUserDocumentRecord.findFirst({
        where: { id: documentId, serviceUserId, deletedAt: null },
        include: { documentType: true },
      });
      if (!existing) throw new NotFoundException('Document not found');

      await tx.serviceUserDocumentRecord.update({
        where: { id: documentId },
        data: { deletedAt: new Date(), deletedById: userId, isActive: false },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_DOCUMENT_RECORD_DELETED,
        recordType: 'ServiceUserDocumentRecord',
        recordId: documentId,
        oldValues: auditSnapshot(mapDocumentRecord(existing)),
        metadata: { serviceUserId },
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return { message: 'Document removed', data: {} };
    });
  }

  private validateCertMime(mimetype: string) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if (!allowed.has(mimetype)) throw new BadRequestException('Only JPEG, PNG, WebP, and PDF files are allowed');
  }

  /** The stored file inside the uploads folder; a stored URL that would escape it is refused. */
  private resolveAbsFromFileUrl(fileUrl: string): string {
    const abs = safeUploadPath(fileUrl);
    if (!abs) throw new NotFoundException('File not found');
    return abs;
  }

  async downloadRecord(
    userId: string,
    serviceUserId: string,
    documentId: string,
    res: Response,
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const doc = await this.prisma.serviceUserDocumentRecord.findFirst({
      where: { id: documentId, serviceUserId, deletedAt: null },
    });
    if (!doc?.fileUrl) throw new NotFoundException('Document not found');
    const abs = this.resolveAbsFromFileUrl(doc.fileUrl);
    if (!existsSync(abs)) throw new NotFoundException('File not found on disk');

    const downloadName = doc.fileName?.trim() || `${doc.title.trim() || 'document'}`;

    await this.audit.logDataAccess({
      userId,
      module: AuditModule.SERVICE_USER,
      recordType: 'ServiceUserDocumentRecord',
      recordId: documentId,
      accessType: DataAccessType.DOWNLOAD,
      ipAddress: meta?.ipAddress ?? undefined,
      userAgent: meta?.userAgent ?? undefined,
      metadata: { serviceUserId, documentTypeId: doc.documentTypeId },
    });
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.SERVICE_USER_DOCUMENT_RECORD_DOWNLOADED,
      recordType: 'ServiceUserDocumentRecord',
      recordId: documentId,
      metadata: { serviceUserId, fileName: downloadName },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    res.setHeader('Content-Type', doc.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    createReadStream(abs).pipe(res);
  }
}
