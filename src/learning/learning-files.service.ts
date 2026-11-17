import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { logLearningChange, type LearningActor } from './learning-audit.util';
import {
  assertLearningFileUpload,
  newLearningFileStoragePath,
  resolveLearningFilePath,
  signedLearningFileUrl,
} from './learning-file.util';

export type LearningFileView = {
  id: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  url: string;
};

@Injectable()
export class LearningFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  static view(row: {
    id: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
  }): LearningFileView {
    return {
      id: row.id,
      originalName: row.originalName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      url: signedLearningFileUrl(row.id),
    };
  }

  async upload(
    file:
      | {
          originalname?: string;
          mimetype?: string;
          size?: number;
          buffer?: Buffer;
        }
      | undefined,
    actor: LearningActor,
  ): Promise<LearningFileView> {
    const checked = assertLearningFileUpload(file);
    const storagePath = newLearningFileStoragePath(checked.ext);
    const absolute = resolveLearningFilePath(storagePath);
    if (!absolute) throw new Error('Learning file path outside storage');
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, checked.buffer);
    const row = await this.prisma.learningFile.create({
      data: {
        originalName: checked.originalName,
        mimeType: checked.mime,
        fileSize: checked.buffer.length,
        storagePath,
        uploadedById: actor.userId,
      },
    });
    await logLearningChange(this.audit, actor, {
      action: 'learning_file_uploaded',
      recordType: 'LearningFile',
      recordId: row.id,
      newValues: {
        originalName: row.originalName,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
      },
    });
    return LearningFilesService.view(row);
  }

  /** For the signed download route: the stored file, or 404 for anything missing. */
  async resolveForDownload(fileId: string) {
    const row = await this.prisma.learningFile.findFirst({
      where: { id: fileId, deletedAt: null },
      select: { storagePath: true, mimeType: true, originalName: true },
    });
    const absolute = row ? resolveLearningFilePath(row.storagePath) : null;
    if (!row || !absolute)
      throw new NotFoundException('File link expired or invalid');
    return { ...row, absolute };
  }
}
