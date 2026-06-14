import {
  computeCarePlanReviewState,
  computeNextReviewDueAt,
  getCarePlanReviewSchedule,
} from './care-plan-review-schedule';

describe('care-plan-review-schedule', () => {
  it('returns Medication schedule with 365-day interval', () => {
    const schedule = getCarePlanReviewSchedule('Medication');
    expect(schedule.defaultIntervalDays).toBe(365);
    expect(schedule.dueSoonLeadDays).toBe(30);
  });

  it('computes next review due from publish date', () => {
    const from = new Date('2026-01-01T12:00:00.000Z');
    const next = computeNextReviewDueAt(from, 365);
    expect(next.toISOString()).toBe('2027-01-01T12:00:00.000Z');
  });

  it('marks review overdue when past due date', () => {
    const state = computeCarePlanReviewState({
      nextReviewDueAt: '2025-01-01T00:00:00.000Z',
      lastReviewedAt: '2024-01-01T00:00:00.000Z',
      intervalDays: 365,
      guidanceSummary: 'Annual review',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(state.status).toBe('overdue');
  });

  it('marks review due soon within lead window', () => {
    const state = computeCarePlanReviewState({
      nextReviewDueAt: '2026-06-15T00:00:00.000Z',
      lastReviewedAt: '2025-06-15T00:00:00.000Z',
      intervalDays: 365,
      guidanceSummary: 'Annual review',
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(state.status).toBe('due_soon');
  });
});
