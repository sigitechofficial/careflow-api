import {
  assertReorderVisitIdsMatchRun,
  assertUniqueVisitIds,
  jobStartMatchesRunDate,
  nextRunSequence,
  sortTimelineJobsByRunSequence,
} from './schedule-run-jobs.util';

describe('schedule-run-jobs.util', () => {
  it('detects duplicate visit ids', () => {
    expect(() => assertUniqueVisitIds(['a', 'a'])).toThrow('Duplicate visit IDs');
  });

  it('matches job start date to run date', () => {
    const runDate = new Date(Date.UTC(2026, 5, 17));
    const jobStart = new Date(Date.UTC(2026, 5, 17, 8, 0, 0));
    expect(jobStartMatchesRunDate(runDate, jobStart)).toBe(true);
    expect(jobStartMatchesRunDate(runDate, new Date(Date.UTC(2026, 5, 18, 8, 0, 0)))).toBe(false);
  });

  it('computes next run sequence', () => {
    expect(nextRunSequence([1, 3, null])).toBe(4);
    expect(nextRunSequence([])).toBe(1);
  });

  it('sorts timeline jobs by run sequence', () => {
    const sorted = sortTimelineJobsByRunSequence([
      { id: 'b', runSequence: 2, scheduledStartDateTime: '2026-06-17T09:00:00.000Z' },
      { id: 'a', runSequence: 1, scheduledStartDateTime: '2026-06-17T08:00:00.000Z' },
    ]);
    expect(sorted.map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('validates reorder visit ids', () => {
    expect(() =>
      assertReorderVisitIdsMatchRun(['job-1', 'job-2'], ['job-1', 'job-2']),
    ).not.toThrow();
    expect(() => assertReorderVisitIdsMatchRun(['job-1'], ['job-1', 'job-2'])).toThrow(
      'every visit currently in the run',
    );
    expect(() => assertReorderVisitIdsMatchRun(['job-3'], ['job-1'])).toThrow(
      'not in this run',
    );
  });
});
