import {
  computeJobHealth,
  successRatePercent,
} from './system-jobs-health.util';

const now = new Date('2026-10-02T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe('computeJobHealth', () => {
  const base = { expectedIntervalMinutes: 5, daily: false, now };

  it('never-run when there are no runs', () => {
    expect(
      computeJobHealth({
        ...base,
        lastRun: null,
        lastFinishedStatus: null,
        lastSuccessAt: null,
      }),
    ).toBe('never-run');
  });

  it('running when a run is in progress', () => {
    expect(
      computeJobHealth({
        ...base,
        lastRun: { status: 'running' },
        lastFinishedStatus: 'failed',
        lastSuccessAt: minutesAgo(60),
      }),
    ).toBe('running');
  });

  it('failing when the last finished run failed', () => {
    expect(
      computeJobHealth({
        ...base,
        lastRun: { status: 'failed' },
        lastFinishedStatus: 'failed',
        lastSuccessAt: minutesAgo(5),
      }),
    ).toBe('failing');
  });

  it('ok when a success (or skipped) run is within 2x the interval', () => {
    expect(
      computeJobHealth({
        ...base,
        lastRun: { status: 'skipped' },
        lastFinishedStatus: 'skipped',
        lastSuccessAt: minutesAgo(9),
      }),
    ).toBe('ok');
  });

  it('late when no success within 2x the interval', () => {
    expect(
      computeJobHealth({
        ...base,
        lastRun: { status: 'success' },
        lastFinishedStatus: 'success',
        lastSuccessAt: minutesAgo(11),
      }),
    ).toBe('late');
  });

  it('gives daily jobs 15 minutes of grace on top of 2 days', () => {
    const daily = { expectedIntervalMinutes: 1440, daily: true, now };
    const run = {
      lastRun: { status: 'success' },
      lastFinishedStatus: 'success',
    };
    expect(
      computeJobHealth({
        ...daily,
        ...run,
        lastSuccessAt: minutesAgo(2 * 1440 + 10),
      }),
    ).toBe('ok');
    expect(
      computeJobHealth({
        ...daily,
        ...run,
        lastSuccessAt: minutesAgo(2 * 1440 + 16),
      }),
    ).toBe('late');
  });
});

describe('successRatePercent', () => {
  it('returns null without finished runs and a 1-dp percentage otherwise', () => {
    expect(successRatePercent(0, 0)).toBeNull();
    expect(successRatePercent(3, 1)).toBe(66.7);
    expect(successRatePercent(288, 0)).toBe(100);
  });
});
