import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  explainWhisperFailure,
  runWhisper,
  WhisperError,
} from './whisper-process.util';

/** A stand-in for transcribe.py, run with `node` instead of Python. */
function fakeScript(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'whisper-spec-'));
  const file = join(dir, 'fake.js');
  writeFileSync(file, body);
  return file;
}

const out = (o: unknown) =>
  `process.stdout.write(${JSON.stringify(JSON.stringify(o) + '\n')});`;

describe('runWhisper', () => {
  it('reports progress and resolves with the result', async () => {
    const script = fakeScript(
      out({ type: 'progress', done: 0, duration: 4 }) +
        out({ type: 'progress', done: 2, duration: 4 }) +
        out({
          type: 'result',
          text: 'Hello\nthere',
          language: 'en',
          duration: 4,
          segments: [{ start: 0, end: 2, text: 'Hello' }],
        }),
    );
    const progress: number[] = [];
    const r = await runWhisper('audio.wav', {
      python: process.execPath,
      script,
      onProgress: (p) => progress.push(p.done),
    }).result;
    expect(progress).toEqual([0, 2]);
    expect(r).toEqual({
      text: 'Hello\nthere',
      language: 'en',
      duration: 4,
      segments: [{ start: 0, end: 2, text: 'Hello' }],
    });
  });

  it('counts a result as success even if the process then exits non-zero', async () => {
    const script = fakeScript(
      out({
        type: 'result',
        text: 'ok',
        language: 'en',
        duration: 1,
        segments: [],
      }) + 'process.exit(3);',
    );
    await expect(
      runWhisper('a.wav', { python: process.execPath, script }).result,
    ).resolves.toMatchObject({ text: 'ok' });
  });

  it('rejects with an explained message and keeps stderr for the logs', async () => {
    const script = fakeScript(
      "process.stderr.write('ModuleNotFoundError: No module named \\'faster_whisper\\'\\n'); process.exit(1);",
    );
    const err = await runWhisper('a.wav', {
      python: process.execPath,
      script,
    }).result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WhisperError);
    expect((err as WhisperError).message).toBe(
      'Whisper is not installed on the server. Run "pip install faster-whisper".',
    );
    expect((err as WhisperError).stderr).toContain('faster_whisper');
  });

  it('rejects when no result was printed', async () => {
    const script = fakeScript('process.exit(0);');
    await expect(
      runWhisper('a.wav', { python: process.execPath, script }).result,
    ).rejects.toThrow('Transcription stopped unexpectedly');
  });

  it('rejects when Python cannot be started', async () => {
    await expect(
      runWhisper('a.wav', {
        python: 'no-such-python-binary-xyz',
        script: 'x.py',
      }).result,
    ).rejects.toThrow(/Whisper could not start/);
  });

  it('stops a run that takes too long', async () => {
    const script = fakeScript('setTimeout(() => {}, 60000);');
    await expect(
      runWhisper('a.wav', { python: process.execPath, script, maxRunMs: 200 })
        .result,
    ).rejects.toThrow();
  });
});

describe('explainWhisperFailure', () => {
  it('explains unreadable audio', () => {
    expect(explainWhisperFailure('av.error.InvalidDataError: x')).toBe(
      'This file could not be read as audio.',
    );
  });
  it('falls back to the last stderr line', () => {
    expect(explainWhisperFailure('a\nboom')).toBe('Transcription failed: boom');
    expect(explainWhisperFailure('')).toBe('Transcription failed');
  });
});
