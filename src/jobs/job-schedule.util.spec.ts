import {
  nextDailyHourInTimeZone,
  nextUtcCronOccurrence,
} from './job-schedule.util';
import { JOB_CATALOGUE } from './job-catalogue';

describe('nextUtcCronOccurrence', () => {
  const at = new Date('2026-10-02T10:07:31Z');

  it('supports every catalogue schedule', () => {
    for (const j of JOB_CATALOGUE) {
      expect(nextUtcCronOccurrence(j.schedule.cron, at)).not.toBeNull();
    }
  });

  it('computes minute, step, hourly and daily schedules', () => {
    expect(nextUtcCronOccurrence('* * * * *', at)?.toISOString()).toBe(
      '2026-10-02T10:08:00.000Z',
    );
    expect(nextUtcCronOccurrence('*/5 * * * *', at)?.toISOString()).toBe(
      '2026-10-02T10:10:00.000Z',
    );
    expect(nextUtcCronOccurrence('*/15 * * * *', at)?.toISOString()).toBe(
      '2026-10-02T10:15:00.000Z',
    );
    expect(nextUtcCronOccurrence('5 * * * *', at)?.toISOString()).toBe(
      '2026-10-02T11:05:00.000Z',
    );
    expect(nextUtcCronOccurrence('0 2 * * *', at)?.toISOString()).toBe(
      '2026-10-03T02:00:00.000Z',
    );
    expect(nextUtcCronOccurrence('30 0 * * *', at)?.toISOString()).toBe(
      '2026-10-03T00:30:00.000Z',
    );
  });

  it('is strictly after the reference time', () => {
    expect(
      nextUtcCronOccurrence(
        '*/5 * * * *',
        new Date('2026-10-02T10:05:00Z'),
      )?.toISOString(),
    ).toBe('2026-10-02T10:10:00.000Z');
  });

  it('returns null for unsupported patterns', () => {
    expect(nextUtcCronOccurrence('0 2 * * 1', at)).toBeNull();
    expect(nextUtcCronOccurrence('0 0 2 * * *', at)).toBeNull();
  });
});

describe('nextDailyHourInTimeZone', () => {
  it('finds the next org-local run hour (BST)', () => {
    expect(
      nextDailyHourInTimeZone(
        12,
        'Europe/London',
        new Date('2026-07-01T09:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-07-01T11:00:00.000Z');
  });

  it('rolls over to the next day', () => {
    expect(
      nextDailyHourInTimeZone(
        2,
        'Asia/Karachi',
        new Date('2026-10-02T10:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-10-02T21:00:00.000Z');
  });
});
