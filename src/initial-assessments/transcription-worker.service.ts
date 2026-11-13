import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { InitialAssessmentConversationFilesService } from './initial-assessment-conversation-files.service';
import { initialAssessmentConversationRoot } from './initial-assessment-upload.util';
import { TRANSCRIPTION_JOB_TTL_MS } from './initial-assessment-transcription.service';
import {
  runWhisper,
  WhisperError,
  type WhisperProgress,
  type WhisperResult,
} from './whisper-process.util';

/** How often a running job reports it is alive (well inside TRANSCRIPTION_HEARTBEAT_STALE_MS). */
const HEARTBEAT_MS = 30_000;
/** Progress is written at most this often. */
const PROGRESS_WRITE_MS = 5_000;
/** Safety cap on jobs handled by one execution (each run is also capped by the job's replicaTimeout). */
const MAX_JOBS_PER_RUN = 25;

type ClaimedJob = {
  id: string;
  submissionId: string;
  serviceUserId: string;
  userId: string;
  recordingAttachmentId: string;
  fileName: string;
};

export type WorkerSummary = { done: number; failed: number };

/**
 * The Whisper worker (WHISPER_MODE=azure-job): one Container Apps Job execution claims queued
 * transcriptions one at a time (row lock, so parallel executions never take the same job), runs
 * Whisper on the saved recording, saves the transcript attachment and records the result. It exits
 * when the queue is empty, so the job costs nothing while idle.
 */
@Injectable()
export class TranscriptionWorker {
  private readonly logger = new Logger(TranscriptionWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationFiles: InitialAssessmentConversationFilesService,
  ) {}

  async runPending(
    run: typeof runWhisper = runWhisper,
  ): Promise<WorkerSummary> {
    const summary: WorkerSummary = { done: 0, failed: 0 };
    for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
      const job = await this.claim();
      if (!job) break;
      const ok = await this.process(job, run);
      if (ok) summary.done += 1;
      else summary.failed += 1;
    }
    await this.prisma.initialAssessmentTranscriptionJob.deleteMany({
      where: {
        finishedAt: { lt: new Date(Date.now() - TRANSCRIPTION_JOB_TTL_MS) },
      },
    });
    return summary;
  }

  /** Oldest queued job, marked RUNNING in the same statement; null when the queue is empty. */
  async claim(): Promise<ClaimedJob | null> {
    const now = new Date();
    const rows = await this.prisma.$queryRaw<ClaimedJob[]>`
      UPDATE "service_users"."InitialAssessmentTranscriptionJob"
         SET "status" = 'RUNNING', "startedAt" = ${now}, "heartbeatAt" = ${now}
       WHERE "id" = (
         SELECT "id" FROM "service_users"."InitialAssessmentTranscriptionJob"
          WHERE "status" = 'QUEUED'
          ORDER BY "createdAt"
          LIMIT 1
          FOR UPDATE SKIP LOCKED)
      RETURNING "id", "submissionId", "serviceUserId", "userId", "recordingAttachmentId", "fileName"`;
    return rows[0] ?? null;
  }

  private async process(
    job: ClaimedJob,
    run: typeof runWhisper,
  ): Promise<boolean> {
    const started = Date.now();
    const recording = await this.prisma.initialAssessmentAttachment.findFirst({
      where: {
        id: job.recordingAttachmentId,
        submissionId: job.submissionId,
        deletedAt: null,
      },
      select: { id: true, fileName: true, originalName: true },
    });
    const path = recording
      ? join(
          initialAssessmentConversationRoot(job.submissionId),
          recording.fileName,
        )
      : null;
    if (!recording || !path || !existsSync(path)) {
      await this.fail(job.id, 'The recording is no longer available.');
      return false;
    }

    // Only touches the row while it is still ours (RUNNING), so a late write never undoes the result.
    const touch = (data: { done?: number; duration?: number | null }) =>
      this.prisma.initialAssessmentTranscriptionJob
        .updateMany({
          where: { id: job.id, status: 'RUNNING' },
          data: { ...data, heartbeatAt: new Date() },
        })
        .catch((e: Error) =>
          this.logger.warn(`Transcription ${job.id} heartbeat: ${e.message}`),
        );
    const heartbeat = setInterval(() => void touch({}), HEARTBEAT_MS);
    let lastWrite = 0;
    const onProgress = (p: WhisperProgress) => {
      if (Date.now() - lastWrite < PROGRESS_WRITE_MS) return;
      lastWrite = Date.now();
      void touch({ done: p.done, duration: p.duration });
    };

    let result: WhisperResult;
    try {
      result = await run(path, { onProgress }).result;
    } catch (e) {
      clearInterval(heartbeat);
      const message = e instanceof Error ? e.message : String(e);
      const stderr = e instanceof WhisperError ? e.stderr : '';
      this.logger.warn(`Transcription ${job.id} failed: ${message}\n${stderr}`);
      await this.fail(job.id, message);
      return false;
    }
    clearInterval(heartbeat);

    let transcriptAttachmentId: string | null = null;
    if (result.text.trim()) {
      try {
        transcriptAttachmentId =
          (
            await this.conversationFiles.saveTranscript(
              job.userId,
              job.serviceUserId,
              job.submissionId,
              { id: recording.id, originalName: recording.originalName },
              result.text,
            )
          )?.id ?? null;
      } catch (e) {
        this.logger.warn(
          `Transcript ${job.id} not saved: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    await this.prisma.initialAssessmentTranscriptionJob.updateMany({
      where: { id: job.id, status: 'RUNNING' },
      data: {
        status: 'DONE',
        text: result.text,
        language: result.language,
        duration: result.duration,
        done: result.duration ?? 0,
        segments: result.segments,
        transcriptAttachmentId,
        finishedAt: new Date(),
        heartbeatAt: new Date(),
      },
    });
    this.logger.log(
      `Transcription ${job.id} done: ${result.duration ?? '?'}s of audio in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    return true;
  }

  private fail(id: string, error: string) {
    return this.prisma.initialAssessmentTranscriptionJob.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'FAILED', error, finishedAt: new Date() },
    });
  }
}
