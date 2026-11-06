import {
  computeReviewNextDue,
  deriveReviewStatus,
  effectiveNextDue,
  reviewAppliesTo,
  scheduledNextDue,
  withDerivedReviewStatus,
  type ReviewSchedule,
} from './employee-review-schedule.util';

describe('employee-review-schedule.util', () => {
  const now = new Date('2026-11-04T10:00:00.000Z');

  describe('computeReviewNextDue', () => {
    it('adds the review type interval to last done (supervision every 90 days)', () => {
      const next = computeReviewNextDue(new Date('2026-11-04T12:00:00.000Z'), 90);
      expect(next?.toISOString().slice(0, 10)).toBe('2027-02-02');
    });

    it('returns null without a last done date or interval', () => {
      expect(computeReviewNextDue(null, 90)).toBeNull();
      expect(computeReviewNextDue(new Date(), null)).toBeNull();
      expect(computeReviewNextDue(new Date(), 0)).toBeNull();
    });
  });

  describe('deriveReviewStatus', () => {
    it('is OVERDUE once the due day has passed', () => {
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-03T12:00:00.000Z') }, now)).toBe('OVERDUE');
    });

    it('is DUE_SOON on the due day and within 14 days', () => {
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-04T23:00:00.000Z') }, now)).toBe('DUE_SOON');
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-18T12:00:00.000Z') }, now)).toBe('DUE_SOON');
    });

    it('is SCHEDULED further ahead', () => {
      expect(deriveReviewStatus({ nextDue: new Date('2026-11-19T12:00:00.000Z') }, now)).toBe('SCHEDULED');
    });

    it('is COMPLETED for a done one-off review and null when nothing is set', () => {
      expect(deriveReviewStatus({ lastDone: new Date('2026-10-01'), nextDue: null }, now)).toBe('COMPLETED');
      expect(deriveReviewStatus({}, now)).toBeNull();
    });
  });

  it('withDerivedReviewStatus replaces a stale stored status', () => {
    const row = { lastDone: null, nextDue: new Date('2026-10-01T12:00:00.000Z'), status: 'SCHEDULED' };
    expect(withDerivedReviewStatus(row, now).status).toBe('OVERDUE');
  });
});

describe('review schedules', () => {
  const start = new Date('2026-01-05T00:00:00.000Z');
  const day = (iso: string) => new Date(`${iso}T09:00:00.000Z`);
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  const repeating: ReviewSchedule = {
    scheduleKind: 'REPEATING',
    defaultIntervalDays: 90,
    firstDueAfterStartDays: null,
    milestoneDays: [],
    audience: 'ALL_STAFF',
  };
  const probation: ReviewSchedule = { ...repeating, scheduleKind: 'MILESTONES', defaultIntervalDays: null, milestoneDays: [30, 90, 180] };
  const induction: ReviewSchedule = { ...probation, milestoneDays: [7, 14, 21, 28] };

  it('repeats from last done, and from the start date for a new starter', () => {
    expect(iso(scheduledNextDue(repeating, { lastDone: day('2026-11-04'), startDate: start }))).toBe('2027-02-02');
    expect(iso(scheduledNextDue(repeating, { lastDone: null, startDate: start }))).toBe('2026-04-05');
    expect(iso(scheduledNextDue({ ...repeating, firstDueAfterStartDays: 30 }, { lastDone: null, startDate: start }))).toBe(
      '2026-02-04',
    );
    expect(scheduledNextDue(repeating, { lastDone: null, startDate: null })).toBeNull();
  });

  it('walks probation milestones and stops after the last', () => {
    expect(iso(scheduledNextDue(probation, { lastDone: null, startDate: start }))).toBe('2026-02-04');
    // a 1-month review held 5 days early still counts for month 1
    expect(iso(scheduledNextDue(probation, { lastDone: day('2026-01-30'), startDate: start }))).toBe('2026-04-05');
    // held 10 days late: still month 1, so month 3 is next
    expect(iso(scheduledNextDue(probation, { lastDone: day('2026-02-14'), startDate: start }))).toBe('2026-04-05');
    // the 3-month review held early counts for month 3
    expect(iso(scheduledNextDue(probation, { lastDone: day('2026-03-20'), startDate: start }))).toBe('2026-07-04');
    expect(scheduledNextDue(probation, { lastDone: day('2026-07-04'), startDate: start })).toBeNull();
  });

  it('does weekly induction check-ins for four weeks only', () => {
    expect(iso(scheduledNextDue(induction, { lastDone: day('2026-01-12'), startDate: start }))).toBe('2026-01-19');
    expect(iso(scheduledNextDue(induction, { lastDone: day('2026-01-26'), startDate: start }))).toBe('2026-02-02');
    expect(scheduledNextDue(induction, { lastDone: day('2026-02-02'), startDate: start })).toBeNull();
  });

  it('only follows up event types once one is recorded', () => {
    const pip: ReviewSchedule = { ...repeating, scheduleKind: 'EVENT', defaultIntervalDays: 14 };
    expect(scheduledNextDue(pip, { lastDone: null, startDate: start })).toBeNull();
    expect(iso(scheduledNextDue(pip, { lastDone: day('2026-03-01'), startDate: start }))).toBe('2026-03-15');
  });

  it('keeps a date set by hand except for milestones', () => {
    const tracker = { lastDone: day('2026-11-04'), nextDue: day('2026-12-01') };
    expect(iso(effectiveNextDue(repeating, tracker, start))).toBe('2026-12-01');
    expect(iso(effectiveNextDue(repeating, null, start))).toBe('2026-04-05');
    expect(effectiveNextDue({ ...repeating, scheduleKind: 'EVENT' }, null, start)).toBeNull();
    expect(iso(effectiveNextDue(probation, { lastDone: null, nextDue: day('2030-01-01') }, start))).toBe('2026-02-04');
  });

  it('applies NMC types to staff with a PIN only', () => {
    expect(reviewAppliesTo({ audience: 'NMC_REGISTRANTS' }, { nmcPinNumber: '12A3456E' })).toBe(true);
    expect(reviewAppliesTo({ audience: 'NMC_REGISTRANTS' }, { nmcPinNumber: ' ' })).toBe(false);
    expect(reviewAppliesTo({ audience: 'ALL_STAFF' }, {})).toBe(true);
  });
});
