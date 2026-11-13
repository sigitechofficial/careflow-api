import { NotFoundException } from '@nestjs/common';
import type { InitialAssessmentTranscriptionJob } from '@prisma/client';
import {
  NOT_STARTED_MESSAGE,
  START_FAILED_MESSAGE,
  staleReason,
  TRANSCRIPTION_HEARTBEAT_STALE_MS,
  TRANSCRIPTION_QUEUE_STALE_MS,
  TranscriptionQueueService,
  WORKER_STOPPED_MESSAGE,
} from './transcription-queue.service';
import {
  TranscriptionJobStarter,
  transcriptionMode,
  whisperJobResourceId,
} from './transcription-job-starter';

const JOB_ID =
  '/subscriptions/0000/resourceGroups/rg-careflow-prod/providers/Microsoft.App/jobs/job-careflow-whisper';

function row(
  over: Partial<InitialAssessmentTranscriptionJob> = {},
): InitialAssessmentTranscriptionJob {
  return {
    id: 'job-1',
    submissionId: 'sub-1',
    serviceUserId: 'su-1',
    userId: 'user-1',
    recordingAttachmentId: 'att-1',
    fileName: 'talk.webm',
    status: 'QUEUED',
    done: 0,
    duration: null,
    text: null,
    language: null,
    segments: null,
    error: null,
    transcriptAttachmentId: null,
    createdAt: new Date(),
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
    ...over,
  };
}

function setup(current: InitialAssessmentTranscriptionJob) {
  let state = current;
  const table = {
    create: jest.fn(() => Promise.resolve(state)),
    findFirst: jest.fn(() => Promise.resolve(state)),
    findUnique: jest.fn(() => Promise.resolve(state)),
    updateMany: jest.fn(
      ({ data }: { data: Partial<InitialAssessmentTranscriptionJob> }) => {
        state = { ...state, ...data };
        return Promise.resolve({ count: 1 });
      },
    ),
    deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    count: jest.fn(() => Promise.resolve(0)),
  };
  const starter = {
    start: jest.fn(() => Promise.resolve<string | null>('exec-1')),
  };
  const service = new TranscriptionQueueService(
    { initialAssessmentTranscriptionJob: table } as never,
    starter as unknown as TranscriptionJobStarter,
  );
  return { service, table, starter };
}

describe('transcriptionMode', () => {
  const before = process.env.WHISPER_MODE;
  afterEach(() => {
    process.env.WHISPER_MODE = before;
  });
  it('is local unless exactly azure-job', () => {
    delete process.env.WHISPER_MODE;
    expect(transcriptionMode()).toBe('local');
    process.env.WHISPER_MODE = 'azure';
    expect(transcriptionMode()).toBe('local');
    process.env.WHISPER_MODE = ' Azure-Job ';
    expect(transcriptionMode()).toBe('azure-job');
  });
});

describe('whisperJobResourceId', () => {
  it('accepts only a Container Apps Job resource id', () => {
    expect(whisperJobResourceId(JOB_ID)).toBe(JOB_ID);
    expect(() => whisperJobResourceId('')).toThrow();
    expect(() => whisperJobResourceId('https://evil.example/x')).toThrow();
    expect(() =>
      whisperJobResourceId(
        JOB_ID.replace('Microsoft.App/jobs', 'Microsoft.App/containerApps'),
      ),
    ).toThrow();
  });
});

describe('TranscriptionJobStarter', () => {
  const before = process.env.WHISPER_JOB_RESOURCE_ID;
  afterEach(() => {
    process.env.WHISPER_JOB_RESOURCE_ID = before;
  });
  it('POSTs jobs/start on ARM with the managed identity token', async () => {
    process.env.WHISPER_JOB_RESOURCE_ID = JOB_ID;
    const starter = new TranscriptionJobStarter();
    starter.tokens = { getToken: () => Promise.resolve('tok') };
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ name: 'job-careflow-whisper-abc' }), {
          status: 202,
        }),
      ),
    );
    starter.fetchImpl = fetchImpl;
    await expect(starter.start()).resolves.toBe('job-careflow-whisper-abc');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://management.azure.com${JOB_ID}/start?api-version=2024-03-01`,
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
  });
  it('throws on a refused start', async () => {
    process.env.WHISPER_JOB_RESOURCE_ID = JOB_ID;
    const starter = new TranscriptionJobStarter();
    starter.tokens = { getToken: () => Promise.resolve('tok') };
    starter.fetchImpl = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 'AuthorizationFailed' } }),
          { status: 403 },
        ),
      );
    await expect(starter.start()).rejects.toThrow(
      'HTTP 403 (AuthorizationFailed)',
    );
  });
});

describe('staleReason', () => {
  const now = Date.now();
  it('fails a queued job no worker picked up', () => {
    expect(
      staleReason(
        row({ createdAt: new Date(now - TRANSCRIPTION_QUEUE_STALE_MS - 1) }),
        now,
      ),
    ).toBe(NOT_STARTED_MESSAGE);
    expect(
      staleReason(row({ createdAt: new Date(now - 60_000) }), now),
    ).toBeNull();
  });
  it('fails a running job whose worker went quiet', () => {
    const old = new Date(now - TRANSCRIPTION_HEARTBEAT_STALE_MS - 1);
    expect(staleReason(row({ status: 'RUNNING', heartbeatAt: old }), now)).toBe(
      WORKER_STOPPED_MESSAGE,
    );
    expect(
      staleReason(
        row({ status: 'RUNNING', heartbeatAt: new Date(now - 10_000) }),
        now,
      ),
    ).toBeNull();
  });
  it('never touches finished jobs', () => {
    expect(
      staleReason(row({ status: 'DONE', createdAt: new Date(0) }), now),
    ).toBeNull();
  });
});

describe('TranscriptionQueueService', () => {
  it('queues the job, starts the Whisper job and answers like local mode', async () => {
    const { service, table, starter } = setup(row());
    const view = await service.start('user-1', 'su-1', 'sub-1', {
      originalName: 'talk.webm',
      recordingAttachmentId: 'att-1',
    });
    expect(table.create).toHaveBeenCalled();
    expect(starter.start).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({
      id: 'job-1',
      status: 'QUEUED',
      position: 1,
      segments: [],
    });
  });

  it('fails the job with a clear message when the Whisper job cannot be started', async () => {
    const { service, starter, table } = setup(row());
    starter.start.mockRejectedValueOnce(new Error('HTTP 403'));
    const view = await service.start('user-1', 'su-1', 'sub-1', {
      originalName: 'talk.webm',
      recordingAttachmentId: 'att-1',
    });
    expect(table.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job-1', status: 'QUEUED' } }),
    );
    expect(view).toMatchObject({
      status: 'FAILED',
      error: START_FAILED_MESSAGE,
    });
  });

  it('expires jobs finished more than 2 hours ago', async () => {
    const { service } = setup(
      row({
        status: 'DONE',
        finishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      }),
    );
    await expect(service.get('sub-1', 'job-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('fails a stale running job when it is asked for', async () => {
    const { service } = setup(
      row({
        status: 'RUNNING',
        heartbeatAt: new Date(
          Date.now() - TRANSCRIPTION_HEARTBEAT_STALE_MS - 1000,
        ),
      }),
    );
    await expect(service.get('sub-1', 'job-1')).resolves.toMatchObject({
      status: 'FAILED',
      error: WORKER_STOPPED_MESSAGE,
      position: 0,
    });
  });
});
