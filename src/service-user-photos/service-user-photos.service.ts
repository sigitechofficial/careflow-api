import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

const PHOTO_SEGMENTS = ['service-users', 'photos'] as const;

@Injectable()
export class ServiceUserPhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly config: ConfigService,
  ) {}

  uploadRoot(): string {
    const base = this.config.get<string>('app.uploadBasePath', 'uploads');
    return join(process.cwd(), base, ...PHOTO_SEGMENTS);
  }

  maxFileSize(): number {
    return this.config.get<number>('app.uploadMaxFileSizeBytes', 10_485_760);
  }

  private async ensureServiceUser(serviceUserId: string) {
    const u = await this.prisma.serviceUser.findFirst({ where: { id: serviceUserId, deletedAt: null } });
    if (!u) throw new NotFoundException('Service user not found');
  }

  ensureUploadDir() {
    const root = this.uploadRoot();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    return root;
  }

  filePublicUrl(fileName: string): string {
    return `/uploads/${PHOTO_SEGMENTS.join('/')}/${fileName}`;
  }

  async uploadProfile(
    userId: string,
    serviceUserId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    return this.upload(userId, serviceUserId, file, { setAsProfile: true }, meta);
  }

  async upload(
    userId: string | null,
    serviceUserId: string,
    file: Express.Multer.File,
    options: { setAsProfile?: boolean } = {},
    meta?: RequestAuditMeta,
  ) {
    await this.ensureServiceUser(serviceUserId);
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }
    if (file.size > this.maxFileSize()) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }

    const setAsProfile = options.setAsProfile ?? false;
    const fileUrl = this.filePublicUrl(file.filename);

    return this.prisma.$transaction(async (tx) => {
      if (setAsProfile) {
        await tx.serviceUserPhoto.updateMany({
          where: { serviceUserId, deletedAt: null, isProfilePhoto: true },
          data: { deletedAt: new Date(), isProfilePhoto: false },
        });
      }

      const created = await tx.serviceUserPhoto.create({
        data: {
          serviceUserId,
          fileName: file.filename,
          originalName: file.originalname,
          fileUrl,
          fileSize: file.size,
          mimeType: file.mimetype,
          uploadedById: userId,
          isProfilePhoto: setAsProfile,
        },
      });

      if (setAsProfile) {
        await tx.serviceUser.update({
          where: { id: serviceUserId },
          data: { profilePhotoUrl: fileUrl, ...(userId ? { updatedById: userId } : {}) },
        });
      }

      await this.audit.logAudit({
        tx,
        userId: userId ?? undefined,
        module: AuditModule.SERVICE_USER,
        action: AuditAction.SERVICE_USER_PHOTO_UPLOADED,
        recordType: 'ServiceUserPhoto',
        recordId: created.id,
        newValues: auditSnapshot({
          id: created.id,
          serviceUserId,
          mimeType: created.mimeType,
          fileSize: created.fileSize,
          fileUrl: created.fileUrl,
          isProfilePhoto: setAsProfile,
          uploadedViaPortal: userId == null,
        }),
        ipAddress: meta?.ipAddress ?? undefined,
        userAgent: meta?.userAgent ?? undefined,
      });

      return {
        message: 'Photo uploaded',
        data: {
          id: created.id,
          fileUrl: created.fileUrl,
          originalName: created.originalName,
          isProfilePhoto: created.isProfilePhoto,
          uploadedAt: created.uploadedAt.toISOString(),
        },
      };
    });
  }

  async deleteProfile(userId: string, serviceUserId: string, meta?: RequestAuditMeta) {
    await this.ensureServiceUser(serviceUserId);
    return this.prisma.$transaction(async (tx) => {
      const photos = await tx.serviceUserPhoto.findMany({
        where: { serviceUserId, deletedAt: null, isProfilePhoto: true },
      });
      const now = new Date();
      for (const p of photos) {
        await tx.serviceUserPhoto.update({
          where: { id: p.id },
          data: { deletedAt: now, isProfilePhoto: false },
        });
        await this.audit.logAudit({
          tx,
          userId,
          module: AuditModule.SERVICE_USER,
          action: AuditAction.SERVICE_USER_PHOTO_DELETED,
          recordType: 'ServiceUserPhoto',
          recordId: p.id,
          oldValues: auditSnapshot(p),
          ipAddress: meta?.ipAddress ?? undefined,
          userAgent: meta?.userAgent ?? undefined,
        });
      }
      await tx.serviceUser.update({
        where: { id: serviceUserId },
        data: { profilePhotoUrl: null, updatedById: userId },
      });
      return { message: 'Profile photo removed', data: {} };
    });
  }
}
