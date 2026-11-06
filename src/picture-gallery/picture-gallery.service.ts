import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CarePictureType, DataAccessType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { PictureGalleryQueryDto } from './dto/picture-gallery-query.dto';
import { UploadCarePictureDto } from './dto/upload-care-picture.dto';
import { UpdateCarePictureDto } from './dto/update-care-picture.dto';
import { uploadPath } from '../common/utils/upload-path.util';

const PICTURE_SEGMENTS = ['care-pathway', 'pictures'] as const;

function mapPicture(row: {
  id: string;
  name: string;
  type: CarePictureType;
  categoryId: string | null;
  category: string | null;
  fileUrl: string;
  thumbnailUrl: string | null;
  uploadedById: string | null;
  isStandard: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  pictureCategory?: {
    id: string;
    name: string;
    code: string;
    description: string | null;
    sortOrder: number;
  } | null;
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    categoryId: row.categoryId,
    category: row.category,
    fileUrl: row.fileUrl,
    thumbnailUrl: row.thumbnailUrl,
    uploadedById: row.uploadedById,
    isStandard: row.isStandard,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    pictureCategory: row.pictureCategory
      ? {
          id: row.pictureCategory.id,
          name: row.pictureCategory.name,
          code: row.pictureCategory.code,
          description: row.pictureCategory.description,
          sortOrder: row.pictureCategory.sortOrder,
        }
      : null,
  };
}

@Injectable()
export class PictureGalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  uploadRoot(): string {
        return uploadPath(...PICTURE_SEGMENTS);
  }

  maxFileSize(): number {
    const explicit = Number(process.env.CARE_PICTURE_MAX_BYTES ?? 0);
    if (explicit > 0) return explicit;
    return 5 * 1024 * 1024;
  }

  filePublicUrl(fileName: string): string {
    return `/uploads/${PICTURE_SEGMENTS.join('/')}/${fileName}`;
  }

  listStandard(query: PictureGalleryQueryDto) {
    return this.listPictures({
      ...query,
      type: CarePictureType.STANDARD,
      isStandard: true,
    });
  }

  listUploaded(query: PictureGalleryQueryDto) {
    return this.listPictures({
      ...query,
      type: CarePictureType.UPLOADED,
      isStandard: false,
    });
  }

  async search(userId: string, query: PictureGalleryQueryDto, meta?: RequestAuditMeta) {
    const searchTerm = (query.query ?? query.search)?.trim();
    const result = await this.listPictures({
      ...query,
      search: searchTerm,
    });

    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PICTURE_SEARCHED,
      recordType: 'CarePicture',
      recordId: 'search',
      metadata: { query: searchTerm ?? null, total: result.meta.total },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    void this.audit
      .logDataAccess({
        userId,
        module: AuditModule.CARE_PATHWAY,
        recordType: 'CarePicture',
        recordId: 'search',
        accessType: DataAccessType.VIEW,
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
        metadata: { route: 'picture_gallery.search', query: searchTerm ?? null },
      })
      .catch(() => undefined);

    return result;
  }

  async upload(
    userId: string,
    dto: UploadCarePictureDto,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Only JPG, JPEG, PNG, and WebP images are allowed');
    }
    if (file.size > this.maxFileSize()) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }

    const fileUrl = this.filePublicUrl(file.filename);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.carePicture.create({
        data: {
          name: dto.name.trim(),
          type: CarePictureType.UPLOADED,
          category: dto.category?.trim() ?? null,
          fileUrl,
          uploadedById: userId,
          isStandard: false,
          isActive: true,
        },
        include: { pictureCategory: true },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.PICTURE_UPLOADED,
        recordType: 'CarePicture',
        recordId: created.id,
        newValues: auditSnapshot(created),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });

      return { message: 'Picture uploaded', data: mapPicture(created) };
    });
  }

  async updateUploaded(
    userId: string,
    id: string,
    dto: UpdateCarePictureDto,
    meta?: RequestAuditMeta,
  ) {
    const before = await this.ensureUploadedPicture(id);

    const updated = await this.prisma.carePicture.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.category !== undefined ? { category: dto.category?.trim() ?? null } : {}),
      },
      include: { pictureCategory: true },
    });

    const oldS = auditSnapshot(before);
    const newS = auditSnapshot(updated);
    await this.audit.logAudit({
      userId,
      module: AuditModule.CARE_PATHWAY,
      action: AuditAction.PICTURE_UPDATED,
      recordType: 'CarePicture',
      recordId: id,
      oldValues: oldS,
      newValues: newS,
      metadata: { changedFields: this.audit.getChangedFields(oldS, newS) },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { message: 'Picture updated', data: mapPicture(updated) };
  }

  async removeUploaded(userId: string, id: string, meta?: RequestAuditMeta) {
    const before = await this.ensureUploadedPicture(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.carePicture.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await this.audit.logAudit({
        tx,
        userId,
        module: AuditModule.CARE_PATHWAY,
        action: AuditAction.PICTURE_DELETED,
        recordType: 'CarePicture',
        recordId: id,
        oldValues: auditSnapshot(before),
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
    });

    return { message: 'Picture deleted', data: {} };
  }

  private async listPictures(query: PictureGalleryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CarePictureWhereInput = {
      deletedAt: null,
      isActive: true,
    };

    if (query.type) where.type = query.type;
    if (query.isStandard !== undefined) where.isStandard = query.isStandard;
    if (query.category?.trim()) {
      where.category = { contains: query.category.trim(), mode: 'insensitive' };
    }

    const searchTerm = (query.search ?? query.query)?.trim();
    if (searchTerm) {
      where.name = { contains: searchTerm, mode: 'insensitive' };
    }

    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.carePicture.count({ where }),
      this.prisma.carePicture.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: { pictureCategory: true },
      }),
    ]);

    return {
      data: rows.map(mapPicture),
      meta: buildPaginationMeta({ page, limit, total }),
    };
  }

  private async ensureUploadedPicture(id: string) {
    const row = await this.prisma.carePicture.findFirst({
      where: {
        id,
        deletedAt: null,
        type: CarePictureType.UPLOADED,
        isStandard: false,
      },
      include: { pictureCategory: true },
    });
    if (!row) throw new NotFoundException('Uploaded picture not found');
    return row;
  }
}
