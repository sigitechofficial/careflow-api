import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { diskStorage } from 'multer';
import {
  runWhisper,
  WhisperError,
  type WhisperSegment,
} from './whisper-process.util';

export type TranscriptionStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export type TranscriptionJob = {
  id: string;
  submissionId: string;
  userId: string;
  fileName: string;
  status: TranscriptionStatus;
  /** Seconds of audio processed so far, and the audio length (known once Whisper starts). */
  done: number;
  duration: number | null;
  text: string | null;
  language: string | null;
  segments: WhisperSegment[];
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  /** The recording kept as an attachment of the assessment, and its saved transcript once done. */
  recordingAttachmentId: string | null;
  transcriptAttachmentId: string | null;
};

/** Called with the finished transcript; returns the id of the attachment that keeps it. */
export type TranscriptSaver = (text: string) => Promise<string | null>;

const AUDIO_EXT = new Set([
  '.webm',
  '.ogg',
  '.oga',
  '.opus',
  '.mp3',
  '.m4a',
  '.mp4',
  '.aac',
  '.wav',
  '.flac',
  '.wma',
  '.amr',
  '.3gp',
]);
export const TRANSCRIPTION_JOB_TTL_MS = 2 * 60 * 60 * 1000;

function uploadDir() {
  const dir = join(tmpdir(), 'careflow-transcribe');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function transcriptionMaxBytes() {
  const mb = Number(process.env.WHISPER_MAX_UPLOAD_MB ?? 200);
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

/** Audio lands in the OS temp folder; the controller then moves it into the assessment's attachments. */
export function transcriptionMulterOptions() {
  return {
    storage: diskStorage({
      destination: (
        _req: unknown,
        _file: Express.Multer.File,
        cb: (e: Error | null, dest: string) => void,
      ) => cb(null, uploadDir()),
      filename: (
        _req: unknown,
        file: Express.Multer.File,
        cb: (e: Error | null, name: string) => void,
      ) =>
        cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: transcriptionMaxBytes() },
    fileFilter: (
      _req: unknown,
      file: Express.Multer.File,
      cb: (e: Error | null, ok: boolean) => void,
    ) => {
      const ext = extname(file.originalname).toLowerCase();
      const audioLike =
        file.mimetype.startsWith('audio/') ||
        file.mimetype === 'video/webm' ||
        file.mimetype === 'video/mp4';
      if (!audioLike && !AUDIO_EXT.has(ext)) {
        cb(
          new BadRequestException(
            'Upload an audio recording (MP3, M4A, WAV, WebM, OGG, AAC or FLAC).',
          ),
          false,
        );
        return;
      }
      cb(null, true);
    },
  };
}

/**
 * Speech-to-text with Whisper running on this server (scripts/whisper/transcribe.py).
 * Jobs run one at a time (Whisper uses all CPU cores) and are kept in memory for 2 hours. The audio
 * file belongs to the caller (it is a saved attachment) and is never deleted here; the finished
 * transcript is handed to the caller's saver.
 */
@Injectable()
export class InitialAssessmentTranscriptionService implements OnModuleDestroy {
  private readonly logger = new Logger(
    InitialAssessmentTranscriptionService.name,
  );
  private readonly jobs = new Map<string, TranscriptionJob>();
  private readonly queue: {
    job: TranscriptionJob;
    path: string;
    save?: TranscriptSaver;
  }[] = [];
  private running: ChildProcess | null = null;

  start(
    userId: string,
    submissionId: string,
    audio: {
      path: string;
      originalName: string;
      recordingAttachmentId?: string | null;
    },
    save?: TranscriptSaver,
  ): TranscriptionJob {
    this.prune();
    const job: TranscriptionJob = {
      id: randomUUID(),
      submissionId,
      userId,
      fileName: audio.originalName,
      status: 'QUEUED',
      done: 0,
      duration: null,
      text: null,
      language: null,
      segments: [],
      error: null,
      createdAt: new Date(),
      finishedAt: null,
      recordingAttachmentId: audio.recordingAttachmentId ?? null,
      transcriptAttachmentId: null,
    };
    this.jobs.set(job.id, job);
    this.queue.push({ job, path: audio.path, save });
    this.next();
    return job;
  }

  get(
    submissionId: string,
    jobId: string,
  ): TranscriptionJob & { position: number } {
    const job = this.jobs.get(jobId);
    if (!job || job.submissionId !== submissionId)
      throw new NotFoundException('Transcription not found or expired');
    return {
      ...job,
      position: this.queue.findIndex((q) => q.job.id === jobId) + 1,
    };
  }

  onModuleDestroy() {
    this.running?.kill();
  }

  private next() {
    if (this.running) return;
    const item = this.queue.shift();
    if (!item) return;
    const { job, path, save } = item;
    job.status = 'RUNNING';
    const run = runWhisper(path, {
      onProgress: (p) => {
        job.done = p.done;
        job.duration = p.duration ?? job.duration;
      },
    });
    this.running = run.child;
    run.result
      .then((r) => {
        job.status = 'DONE';
        job.text = r.text;
        job.language = r.language;
        job.duration = r.duration ?? job.duration;
        job.done = job.duration ?? job.done;
        job.segments = r.segments;
        if (save && job.text.trim()) {
          save(job.text)
            .then((id) => {
              job.transcriptAttachmentId = id;
            })
            .catch((e: Error) =>
              this.logger.warn(`Transcript ${job.id} not saved: ${e.message}`),
            );
        }
      })
      .catch((e: Error) => {
        job.status = 'FAILED';
        job.error = e.message;
        const stderr = e instanceof WhisperError ? e.stderr : '';
        this.logger.warn(
          `Transcription ${job.id} failed: ${job.error}\n${stderr}`,
        );
      })
      .finally(() => {
        job.finishedAt = new Date();
        this.running = null;
        this.next();
      });
  }

  private prune() {
    const cutoff = Date.now() - TRANSCRIPTION_JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && job.finishedAt.getTime() < cutoff)
        this.jobs.delete(id);
    }
  }
}
