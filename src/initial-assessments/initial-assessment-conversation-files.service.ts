import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InitialAssessmentAttachmentCategory,
  InitialAssessmentStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  copyFileSync,
  existsSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import { auditSnapshot } from '../common/utils/audit-snapshot.util';
import type { RequestAuditMeta } from '../common/utils/request-audit-meta.util';
import {
  initialAssessmentConversationRoot,
  initialAssessmentUploadRoot,
} from './initial-assessment-upload.util';

const CONVERSATION_CATEGORIES: InitialAssessmentAttachmentCategory[] = [
  InitialAssessmentAttachmentCategory.CONVERSATION_RECORDING,
  InitialAssessmentAttachmentCategory.CONVERSATION_TRANSCRIPT,
];

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

/** Moves a file, copying when the temp folder is on another drive. */
function moveFile(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch {
    copyFileSync(from, to);
    unlinkSync(from);
  }
}

/**
 * Recorded assessment conversations and their Whisper transcripts, kept as attachments of the
 * submission (and so of the service user). They live in a folder that is never served as static
 * files; {@link fileFor} is the only way to read them, behind the assessment read permission.
 */
@Injectable()
export class InitialAssessmentConversationFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  private fileUrl(
    serviceUserId: string,
    submissionId: string,
    attachmentId: string,
  ) {
    return `/service-users/${serviceUserId}/initial-assessments/${submissionId}/attachments/${attachmentId}/file`;
  }

  private async editableSubmission(
    serviceUserId: string,
    submissionId: string,
  ) {
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, serviceUserId, deletedAt: null },
      select: { id: true, status: true, templateId: true },
    });
    if (!submission)
      throw new NotFoundException('Initial assessment submission not found');
    if (
      submission.status !== InitialAssessmentStatus.DRAFT &&
      submission.status !== InitialAssessmentStatus.IN_PROGRESS
    ) {
      throw new ForbiddenException(
        'Recordings can only be added while the assessment is a draft or in progress',
      );
    }
    return submission;
  }

  /** Keeps an uploaded recording (moved out of the temp folder) as an attachment. */
  async saveRecording(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    file: Express.Multer.File,
    meta?: RequestAuditMeta,
  ) {
    const submission = await this.editableSubmission(
      serviceUserId,
      submissionId,
    );
    const id = randomUUID();
    const ext = extname(file.originalname).toLowerCase() || '.webm';
    const fileName = `recording-${Date.now()}${ext}`;
    moveFile(
      file.path,
      join(initialAssessmentConversationRoot(submissionId), fileName),
    );
    const mimeType = file.mimetype.startsWith('audio/')
      ? file.mimetype
      : (AUDIO_MIME_BY_EXT[ext] ?? 'audio/webm');

    const row = await this.prisma.initialAssessmentAttachment.create({
      data: {
        id,
        submissionId,
        serviceUserId,
        category: InitialAssessmentAttachmentCategory.CONVERSATION_RECORDING,
        label: 'Assessment conversation recording',
        fileName,
        originalName: file.originalname,
        fileUrl: this.fileUrl(serviceUserId, submissionId, id),
        mimeType,
        fileSize: file.size,
        uploadedById: userId,
      },
    });
    await this.logUpload(userId, row, submission.templateId, meta);
    return {
      attachment: row,
      path: join(initialAssessmentConversationRoot(submissionId), fileName),
    };
  }

  /** Keeps the Whisper transcript of a saved recording as a .txt attachment. */
  async saveTranscript(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    recording: { id: string; originalName: string },
    text: string,
  ) {
    const submission = await this.prisma.initialAssessmentSubmission.findFirst({
      where: { id: submissionId, serviceUserId, deletedAt: null },
      select: { templateId: true },
    });
    if (!submission) return null;
    const id = randomUUID();
    const fileName = `transcript-${Date.now()}.txt`;
    const body = Buffer.from(text, 'utf8');
    writeFileSync(
      join(initialAssessmentConversationRoot(submissionId), fileName),
      body,
    );
    const base = recording.originalName.replace(/\.[^.]+$/, '');
    const row = await this.prisma.initialAssessmentAttachment.create({
      data: {
        id,
        submissionId,
        serviceUserId,
        category: InitialAssessmentAttachmentCategory.CONVERSATION_TRANSCRIPT,
        label: 'Transcript of the assessment conversation',
        fileName,
        originalName: `${base}-transcript.txt`,
        fileUrl: this.fileUrl(serviceUserId, submissionId, id),
        mimeType: 'text/plain; charset=utf-8',
        fileSize: body.length,
        uploadedById: userId,
      },
    });
    await this.logUpload(userId, row, submission.templateId);
    return row;
  }

  /** The stored file of an attachment, for the permission-checked download endpoint. */
  async fileFor(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    attachmentId: string,
    meta?: RequestAuditMeta,
  ) {
    const row = await this.prisma.initialAssessmentAttachment.findFirst({
      where: { id: attachmentId, submissionId, serviceUserId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Attachment not found');
    const dir = CONVERSATION_CATEGORIES.includes(row.category)
      ? initialAssessmentConversationRoot(submissionId)
      : initialAssessmentUploadRoot(submissionId);
    const path = join(dir, row.fileName);
    if (!existsSync(path))
      throw new NotFoundException('The file is no longer on the server');
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_ATTACHMENT_DOWNLOADED,
      recordType: 'InitialAssessmentAttachment',
      recordId: row.id,
      metadata: { serviceUserId, submissionId, category: row.category },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { path, mimeType: row.mimeType, originalName: row.originalName };
  }

  private async logUpload(
    userId: string,
    row: {
      id: string;
      category: string;
      originalName: string;
      mimeType: string;
      fileSize: number;
      serviceUserId: string;
      submissionId: string;
    },
    templateId: string,
    meta?: RequestAuditMeta,
  ) {
    await this.audit.logAudit({
      userId,
      module: AuditModule.SERVICE_USER,
      action: AuditAction.INITIAL_ASSESSMENT_ATTACHMENT_UPLOADED,
      recordType: 'InitialAssessmentAttachment',
      recordId: row.id,
      newValues: auditSnapshot({
        id: row.id,
        category: row.category,
        originalName: row.originalName,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
      }),
      metadata: {
        serviceUserId: row.serviceUserId,
        submissionId: row.submissionId,
        templateId,
      },
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }
}
