import {
  JOB_CATALOGUE,
  JOB_NAMES,
  getJobDefinition,
  isJobName,
  manualPeriodKey,
  periodKeyFor,
} from './job-catalogue';

const def = (name: string) => getJobDefinition(name)!;

describe('job catalogue', () => {
  it('lists the 12 jobs once each, 7 functions + 5 container jobs', () => {
    expect(JOB_CATALOGUE.map((j) => j.name)).toEqual([...JOB_NAMES]);
    expect(new Set(JOB_NAMES).size).toBe(12);
    expect(
      JOB_CATALOGUE.filter((j) => j.trigger === 'function').map((j) => j.name),
    ).toEqual([
      'survey-distribution',
      'visit-start-reminder',
      'late-visit-alert',
      'ecm-missed-visit',
      'ecm-missing-checkout',
      'platform-costs-sync',
      'employee-payout-auto',
    ]);
    expect(
      JOB_CATALOGUE.filter((j) => j.trigger === 'container-job').map(
        (j) => j.name,
      ),
    ).toEqual([
      'rolling-rota',
      'visit-plan-scheduled-end',
      'learning-maintenance',
      'care-plan-review-reminders',
      'over-care-review',
    ]);
  });

  it('matches the contract schedules', () => {
    expect(def('rolling-rota').schedule.cron).toBe('0 2 * * *');
    expect(def('visit-plan-scheduled-end').schedule.cron).toBe('30 0 * * *');
    expect(def('learning-maintenance').schedule.cron).toBe('30 2 * * *');
    expect(def('care-plan-review-reminders').schedule.cron).toBe('0 6 * * *');
    expect(def('over-care-review').schedule.cron).toBe('45 2 * * *');
    expect(def('platform-costs-sync').schedule.cron).toBe('5 * * * *');
    expect(def('employee-payout-auto').schedule.cron).toBe('0 * * * *');
  });

  it('uses 7-day retention for minute/hour jobs and 90 days for daily jobs', () => {
    for (const j of JOB_CATALOGUE) {
      expect(j.retentionDays).toBe(j.period.kind === 'minutes' ? 7 : 90);
    }
  });

  it('validates names', () => {
    expect(isJobName('rolling-rota')).toBe(true);
    expect(isJobName('nope')).toBe(false);
    expect(getJobDefinition('nope')).toBeUndefined();
  });
});

describe('periodKeyFor', () => {
  it('buckets minute jobs in UTC', () => {
    const at = new Date('2026-10-02T10:07:31.123Z');
    expect(periodKeyFor(def('survey-distribution'), at)).toBe(
      '2026-10-02T10:07Z',
    );
    expect(periodKeyFor(def('visit-start-reminder'), at)).toBe(
      '2026-10-02T10:06Z',
    );
    expect(periodKeyFor(def('late-visit-alert'), at)).toBe('2026-10-02T10:05Z');
    expect(periodKeyFor(def('ecm-missed-visit'), at)).toBe('2026-10-02T10:05Z');
    expect(periodKeyFor(def('ecm-missing-checkout'), at)).toBe(
      '2026-10-02T10:00Z',
    );
    expect(periodKeyFor(def('platform-costs-sync'), at)).toBe(
      '2026-10-02T10:00Z',
    );
    expect(periodKeyFor(def('employee-payout-auto'), at)).toBe(
      '2026-10-02T10:00Z',
    );
  });

  it('gives an internal tick and a slightly late Function call the same 5-minute key', () => {
    const late = def('late-visit-alert');
    expect(periodKeyFor(late, new Date('2026-10-02T10:05:00.000Z'))).toBe(
      periodKeyFor(late, new Date('2026-10-02T10:05:42.000Z')),
    );
  });

  it('counts a trigger up to 5 s early (clock skew) for the upcoming bucket', () => {
    const late = def('late-visit-alert');
    expect(periodKeyFor(late, new Date('2026-10-02T10:04:57.000Z'))).toBe(
      '2026-10-02T10:05Z',
    );
    expect(periodKeyFor(late, new Date('2026-10-02T10:04:50.000Z'))).toBe(
      '2026-10-02T10:00Z',
    );
  });

  it('uses the UTC date for daily container jobs', () => {
    expect(
      periodKeyFor(
        def('visit-plan-scheduled-end'),
        new Date('2026-10-02T00:30:00Z'),
      ),
    ).toBe('2026-10-02');
    expect(
      periodKeyFor(
        def('care-plan-review-reminders'),
        new Date('2026-10-02T23:59:00Z'),
      ),
    ).toBe('2026-10-02');
  });

  it('uses the organisation-local date for the rolling rota', () => {
    const rota = def('rolling-rota');
    // 21:30 UTC on 2 Oct = 02:30 on 3 Oct in Karachi (UTC+5), still 2 Oct in London (BST)
    const at = new Date('2026-10-02T21:30:00Z');
    expect(periodKeyFor(rota, at, 'Asia/Karachi')).toBe('2026-10-03');
    expect(periodKeyFor(rota, at, 'Europe/London')).toBe('2026-10-02');
  });

  it('gives the internal rota run (org run hour) and the 02:00 UTC container job the same day key', () => {
    const rota = def('rolling-rota');
    expect(
      periodKeyFor(rota, new Date('2026-10-02T02:00:00Z'), 'Europe/London'),
    ).toBe(
      periodKeyFor(rota, new Date('2026-10-02T11:00:00Z'), 'Europe/London'),
    );
  });

  it('builds manual keys from the ISO minute', () => {
    expect(manualPeriodKey(new Date('2026-10-02T10:07:31Z'))).toBe(
      'manual:2026-10-02T10:07Z',
    );
  });
});
