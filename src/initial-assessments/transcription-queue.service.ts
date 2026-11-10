import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { InitialAssessmentTranscriptionJob } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TRANSCRIPTION_JOB_TTL_MS,
  type TranscriptionJob,
} from './initial-assessment-transcription.service';
import { TranscriptionJobStarter } from './transcription-job-starter';
import type { WhisperSegment } from './whisper-process.util';

/** A queued job no worker picked up in this time is failed (the Container Apps Job did not start). */
export const TRANSCRIPTION_QUEUE_STALE_MS = 20 * 60 * 1000;
/** A running job whose worker has not reported in this time is failed (the worker stopped). */
export const TRANSCRIPTION_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

export const START_FAILED_MESSAGE =
  'The transcription service could not be started. The recording is saved in the attachments; try again in a few minutes.';
export const NOT_STARTED_MESSAGE =
  'The transcription service did not start in time. The recording is saved in the attachments; try again.';
export const WORKER_STOPPED_MESSAGE = 'Transcription stopped unexpectedly';

/** The same shape the local (in-memory) mode returns, so the admin app does not change. */
export function toTranscriptionView(
  row: InitialAssessmentTranscriptionJob,
  position: number,
): TranscriptionJob & { position: number } {
  return {
    id: row.id,
    submissionId: row.submissionId,
    userId: row.userId,
    fileName: row.fileName,
    status: row.status as TranscriptionJob['status'],
    done: row.done,
    duration: row.duration,
    text: row.text,
    language: row.language,
    segments: (row.segments as WhisperSegment[] | null) ?? [],
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    recordingAttachmentId: row.recordingAttachmentId,
    transcriptAttachmentId: row.transcriptAttachmentId,
    position,
  };
}

/** Why a job should now be failed (its worker never came or went away), or null. */
export function staleReason(
  row: Pick<
    InitialAssessmentTranscriptionJob,
    'status' | 'createdAt' | 'startedAt' | 'heartbeatAt'
  >,
  now = Date.now(),
): string | null {
  if (
    row.status === 'QUEUED' &&
    now - row.createdAt.getTime() > TRANSCRIPTION_QUEUE_STALE_MS
  )
    return NOT_STARTED_MESSAGE;
  if (row.status === 'RUNNING') {
    const seen = row.heartbeatAt ?? row.startedAt ?? row.createdAt;
    if (now - seen.getTime() > TRANSCRIPTION_HEARTBEAT_STALE_MS)
      return WORKER_STOPPED_MESSAGE;
  }
  return null;
}

/**
 * Transcriptions in WHISPER_MODE=azure-job: the API only queues the job (database) and starts the
 * Whisper Container Apps Job; the worker (TranscriptionWorker) does the work. Status survives API
 * restarts and is the same whichever API replica is asked.
 */
@Injectable()
export class TranscriptionQueueService {
  private readonly logger = new Logger(TranscriptionQueueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly starter: TranscriptionJobStarter,
  ) {}

  async start(
    userId: string,
    serviceUserId: string,
    submissionId: string,
    audio: { originalName: string; recordingAttachmentId: string },
  ) {
    await this.prune();
    let row = await this.prisma.initialAssessmentTranscriptionJob.create({
      data: {
        submissionId,
        serviceUserId,
        userId,
        fileName: audio.originalName,
        recordingAttachmentId: audio.recordingAttachmentId,
      },
    });
    try {
      const execution = await this.starter.start();
      this.logger.log(
        `Transcription ${row.id} queued; Whisper job execution ${execution ?? '-'}`,
      );
    } catch (e) {
      this.logger.error(
        `Transcription ${row.id}: could not start the Whisper job: ${e instanceof Error ? e.message : String(e)}`,
      );
      // Only if no worker has claimed it meanwhile (another execution may already be running).
      await this.prisma.initialAssessmentTranscriptionJob.updateMany({
        where: { id: row.id, status: 'QUEUED' },
        data: {
          status: 'FAILED',
          error: START_FAILED_MESSAGE,
          finishedAt: new Date(),
        },
      });
      row =
        (await this.prisma.initialAssessmentTranscriptionJob.findUnique({
          where: { id: row.id },
        })) ?? row;
    }
    return toTranscriptionView(row, await this.position(row));
  }

  async get(submissionId: string, jobId: string) {
    let row = await this.prisma.initialAssessmentTranscriptionJob.findFirst({
      where: { id: jobId, submissionId },
    });
    if (
      !row ||
      (row.finishedAt &&
        row.finishedAt.getTime() < Date.now() - TRANSCRIPTION_JOB_TTL_MS)
    )
      throw new NotFoundException('Transcription not found or expired');
    const reason = staleReason(row);
    if (reason) {
      // Conditional on the state we saw, so a worker that just reported is not overruled.
      const { count } =
        await this.prisma.initialAssessmentTranscriptionJob.updateMany({
          where: {
            id: row.id,
            status: row.status,
            heartbeatAt: row.heartbeatAt,
          },
          data: { status: 'FAILED', error: reason, finishedAt: new Date() },
        });
      if (count) this.logger.warn(`Transcription ${row.id} failed: ${reason}`);
      row =
        (await this.prisma.initialAssessmentTranscriptionJob.findUnique({
          where: { id: row.id },
        })) ?? row;
    }
    return toTranscriptionView(row, await this.position(row));
  }

  /** Place in the queue while QUEUED (1 = next), as in local mode; 0 otherwise. */
  private async position(row: InitialAssessmentTranscriptionJob) {
    if (row.status !== 'QUEUED') return 0;
    const ahead = await this.prisma.initialAssessmentTranscriptionJob.count({
      where: { status: 'QUEUED', createdAt: { lt: row.createdAt } },
    });
    return ahead + 1;
  }

  /** Finished jobs (and their transcript text) are kept for 2 hours, as in local mode. */
  private prune() {
    return this.prisma.initialAssessmentTranscriptionJob.deleteMany({
      where: {
        finishedAt: { lt: new Date(Date.now() - TRANSCRIPTION_JOB_TTL_MS) },
      },
    });
  }
}
