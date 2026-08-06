import { VisitTimelineService } from './visit-timeline.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('VisitTimelineService', () => {
  const upsert = jest.fn();
  const findMany = jest.fn();
  const prisma = {
    visitTimelineEvent: { upsert, findMany },
  } as unknown as PrismaService;

  const service = new VisitTimelineService(prisma);

  beforeEach(() => {
    upsert.mockReset();
    findMany.mockReset();
  });

  it('upserts on write and returns API item', async () => {
    upsert.mockResolvedValue({
      id: 'tl-clock',
      eventType: 'clock_in',
      occurredAt: new Date('2026-08-06T05:02:00.000Z'),
      timeLabel: '05:02',
      title: 'Clocked in',
      detail: 'GPS confirmed',
      tone: 'primary',
      sourceType: 'check_in',
      sourceId: 'check_in',
      logEntryId: null,
      isDraft: false,
    });

    const item = await service.upsertEvent({
      scheduledJobId: 'job-1',
      eventType: 'clock_in',
      sourceType: 'check_in',
      sourceId: 'check_in',
      title: 'Clocked in',
      detail: 'GPS confirmed',
      tone: 'primary',
      occurredAt: new Date('2026-08-06T05:02:00.000Z'),
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].where).toEqual({
      scheduledJobId_sourceType_sourceId_eventType: {
        scheduledJobId: 'job-1',
        sourceType: 'check_in',
        sourceId: 'check_in',
        eventType: 'clock_in',
      },
    });
    expect(item?.title).toBe('Clocked in');
    expect(item?.time).toBe('05:02');
  });

  it('idempotent retry uses same unique key (no duplicate insert path)', async () => {
    upsert.mockResolvedValue({
      id: 'tl-note',
      eventType: 'visit_note',
      occurredAt: new Date('2026-08-06T10:00:00.000Z'),
      timeLabel: '10:00',
      title: 'Visit note',
      detail: 'Updated body',
      tone: 'ink',
      sourceType: 'log_note',
      sourceId: 'visit_note',
      logEntryId: 'n2',
      isDraft: false,
    });

    await service.upsertEvent({
      scheduledJobId: 'job-1',
      eventType: 'visit_note',
      sourceType: 'log_note',
      sourceId: 'visit_note',
      title: 'Visit note',
      detail: 'First',
      tone: 'ink',
      occurredAt: new Date('2026-08-06T09:00:00.000Z'),
      logEntryId: 'n1',
    });
    await service.upsertEvent({
      scheduledJobId: 'job-1',
      eventType: 'visit_note',
      sourceType: 'log_note',
      sourceId: 'visit_note',
      title: 'Visit note',
      detail: 'Updated body',
      tone: 'ink',
      occurredAt: new Date('2026-08-06T10:00:00.000Z'),
      logEntryId: 'n2',
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    const keys = upsert.mock.calls.map(
      (c) => c[0].where.scheduledJobId_sourceType_sourceId_eventType,
    );
    expect(keys[0]).toEqual(keys[1]);
  });

  it('listForJob excludes drafts and returns ascending order', async () => {
    findMany.mockResolvedValue([
      {
        id: 'tl-2',
        eventType: 'task',
        occurredAt: new Date('2026-08-06T10:20:00.000Z'),
        timeLabel: '10:20',
        title: 'Personal care',
        detail: 'Completed',
        tone: 'success',
        sourceType: 'task',
        sourceId: 'task_456',
        logEntryId: null,
        isDraft: false,
      },
      {
        id: 'tl-1',
        eventType: 'clock_in',
        occurredAt: new Date('2026-08-06T10:02:00.000Z'),
        timeLabel: '10:02',
        title: 'Clocked in',
        detail: 'GPS confirmed',
        tone: 'primary',
        sourceType: 'check_in',
        sourceId: 'check_in',
        logEntryId: null,
        isDraft: false,
      },
    ]);

    const items = await service.listForJob('job-1');
    expect(findMany).toHaveBeenCalledWith({
      where: { scheduledJobId: 'job-1', isDraft: false },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    expect(items.map((i) => i.id)).toEqual(['tl-1', 'tl-2']);
    expect(items[0].type).toBe('clock_in');
  });

  it('returns empty timeline when no events', async () => {
    findMany.mockResolvedValue([]);
    await expect(service.listForJob('job-fresh')).resolves.toEqual([]);
  });
});
