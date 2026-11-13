import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/** Longest a single Whisper run may take before it is stopped. */
export const WHISPER_MAX_RUN_MS = 3 * 60 * 60 * 1000;

export type WhisperSegment = { start: number; end: number; text: string };

export type WhisperResult = {
  text: string;
  language: string | null;
  duration: number | null;
  segments: WhisperSegment[];
};

export type WhisperProgress = { done: number; duration: number | null };

/** A failed run: `message` can be shown to the user, `stderr` (last 4000 chars) is for the logs. */
export class WhisperError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'WhisperError';
  }
}

export type WhisperRun = {
  child: ChildProcess;
  /** Resolves with the transcript; rejects with a message that can be shown to the user. */
  result: Promise<WhisperResult>;
};

/** scripts/whisper/transcribe.py, looked up beside the build too (pm2 on the VPS starts from dist/src). */
export function whisperScriptPath() {
  return (
    [
      join(process.cwd(), 'scripts', 'whisper', 'transcribe.py'),
      join(__dirname, '..', '..', '..', 'scripts', 'whisper', 'transcribe.py'),
    ].find((p) => existsSync(p)) ??
    join(process.cwd(), 'scripts', 'whisper', 'transcribe.py')
  );
}

export function explainWhisperFailure(stderr: string) {
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

/**
 * Runs scripts/whisper/transcribe.py on one audio file (WHISPER_PYTHON, default `python`).
 * Progress lines are passed to onProgress; a result line counts as success even if the process
 * exits non-zero afterwards.
 */
export function runWhisper(
  audioPath: string,
  opts: {
    onProgress?: (p: WhisperProgress) => void;
    /** Tests only. */
    python?: string;
    script?: string;
    maxRunMs?: number;
  } = {},
): WhisperRun {
  const python = opts.python ?? (process.env.WHISPER_PYTHON || 'python');
  const child = spawn(python, [opts.script ?? whisperScriptPath(), audioPath], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    windowsHide: true,
  });
  const result = new Promise<WhisperResult>((resolve, reject) => {
    const timer = setTimeout(
      () => child.kill(),
      opts.maxRunMs ?? WHISPER_MAX_RUN_MS,
    );
    let out = '';
    let err = '';
    let duration: number | null = null;
    let done: WhisperResult | null = null;
    let settled = false;

    const onLine = (line: string) => {
      let msg: {
        type?: string;
        done?: number;
        duration?: number;
        text?: string;
        language?: string;
        segments?: WhisperSegment[];
      };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === 'progress') {
        duration = msg.duration ?? duration;
        opts.onProgress?.({ done: msg.done ?? 0, duration });
      } else if (msg.type === 'result') {
        done = {
          text: msg.text ?? '',
          language: msg.language ?? null,
          duration: msg.duration ?? duration,
          segments: msg.segments ?? [],
        };
      }
    };
    const finish = (failure: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (done) resolve(done);
      else
        reject(
          new WhisperError(
            failure ?? 'Transcription stopped unexpectedly',
            err,
          ),
        );
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out += chunk;
      let nl: number;
      while ((nl = out.indexOf('\n')) >= 0) {
        onLine(out.slice(0, nl));
        out = out.slice(nl + 1);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString()).slice(-4000);
    });
    child.on('error', (e) =>
      finish(
        `Whisper could not start (${e.message}). Install Python and run "pip install faster-whisper", or set WHISPER_PYTHON.`,
      ),
    );
    child.on('close', (code) => {
      if (out.trim()) onLine(out);
      finish(code === 0 ? null : explainWhisperFailure(err));
    });
  });
  return { child, result };
}
