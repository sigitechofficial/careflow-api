import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { diskStorage } from 'multer';

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
  segments: { start: number; end: number; text: string }[];
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
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_RUN_MS = 3 * 60 * 60 * 1000;

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
    const python = process.env.WHISPER_PYTHON || 'python';
    // The VPS starts pm2 from dist/src, so look beside the build too, not only in the cwd.
    const script =
      [
        join(process.cwd(), 'scripts', 'whisper', 'transcribe.py'),
        join(__dirname, '..', '..', '..', 'scripts', 'whisper', 'transcribe.py'),
      ].find((p) => existsSync(p)) ??
      join(process.cwd(), 'scripts', 'whisper', 'transcribe.py');
    const child = spawn(python, [script, path], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });
    this.running = child;
    const timer = setTimeout(() => child.kill(), MAX_RUN_MS);
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
      let nl: number;
      while ((nl = out.indexOf('\n')) >= 0) {
        this.onLine(job, out.slice(0, nl));
        out = out.slice(nl + 1);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-4000);
    });
    const finish = (failure: string | null) => {
      clearTimeout(timer);
      this.running = null;
      if (job.status === 'DONE' && save && job.text?.trim()) {
        save(job.text)
          .then((id) => {
            job.transcriptAttachmentId = id;
          })
          .catch((e: Error) =>
            this.logger.warn(`Transcript ${job.id} not saved: ${e.message}`),
          );
      }
      if (job.status !== 'DONE') {
        job.status = 'FAILED';
        job.error = failure ?? 'Transcription stopped unexpectedly';
        this.logger.warn(
          `Transcription ${job.id} failed: ${job.error}\n${err}`,
        );
      }
      job.finishedAt = new Date();
      this.next();
    };
    child.on('error', (e) =>
      finish(
        `Whisper could not start (${e.message}). Install Python and run "pip install faster-whisper", or set WHISPER_PYTHON.`,
      ),
    );
    child.on('close', (code) => {
      if (out.trim()) this.onLine(job, out);
      finish(code === 0 ? null : this.explain(err));
    });
  }

  private onLine(job: TranscriptionJob, line: string) {
    let msg: {
      type?: string;
      done?: number;
      duration?: number;
      text?: string;
      language?: string;
      segments?: TranscriptionJob['segments'];
      message?: string;
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (msg.type === 'progress') {
      job.done = msg.done ?? job.done;
      job.duration = msg.duration ?? job.duration;
    } else if (msg.type === 'result') {
      job.status = 'DONE';
      job.text = msg.text ?? '';
      job.language = msg.language ?? null;
      job.duration = msg.duration ?? job.duration;
      job.done = job.duration ?? job.done;
      job.segments = msg.segments ?? [];
    } else if (msg.type === 'error') {
      job.error = msg.message ?? null;
    }
  }

  private explain(stderr: string) {
    if (/No module named ['"]?faster_whisper/.test(stderr))
      return 'Whisper is not installed on the server. Run "pip install faster-whisper".';
    if (
      /Invalid data found|could not open|InvalidDataError|Errno 1094995529/i.test(
        stderr,
      )
    )
      return 'This file could not be read as audio.';
    const last = stderr.trim().split(/\r?\n/).pop();
    return last
      ? `Transcription failed: ${last.slice(0, 300)}`
      : 'Transcription failed';
  }

  private prune() {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && job.finishedAt.getTime() < cutoff)
        this.jobs.delete(id);
    }
  }
}
