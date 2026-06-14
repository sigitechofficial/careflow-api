import { computeAssessmentReviewState } from './assessment-review-schedule';

describe('assessment-review-schedule', () => {
  it('marks waterlow overdue after 30 days for stable scores', () => {
    const last = new Date('2026-05-01T12:00:00.000Z');
    const now = new Date('2026-06-05T12:00:00.000Z');
    const state = computeAssessmentReviewState({
      assessmentKey: 'waterlow',
      lastCompletedAt: last,
      snapshot: { waterlow: { score: 10 } },
      now,
    });
    expect(state.status).toBe('overdue');
    expect(state.effectiveIntervalDays).toBe(30);
    expect(state.alertActive).toBe(true);
  });

  it('uses weekly interval for high waterlow scores', () => {
    const last = new Date('2026-05-28T12:00:00.000Z');
    const now = new Date('2026-06-05T12:00:00.000Z');
    const state = computeAssessmentReviewState({
      assessmentKey: 'waterlow',
      lastCompletedAt: last,
      snapshot: { waterlow: { score: 18 } },
      now,
    });
    expect(state.effectiveIntervalDays).toBe(7);
    expect(state.status).toBe('overdue');
  });

  it('does not alert for event-driven MCA screening', () => {
    const state = computeAssessmentReviewState({
      assessmentKey: 'mca-screening',
      lastCompletedAt: new Date('2025-01-01T00:00:00.000Z'),
      snapshot: {},
      now: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(state.status).toBe('event_driven');
    expect(state.alertActive).toBe(false);
    expect(state.nextReviewDueAt).toBeNull();
  });

  it('applies annual review schedule for care pathway bed rail assessments', () => {
    const last = new Date('2025-01-01T12:00:00.000Z');
    const now = new Date('2026-06-01T12:00:00.000Z');
    const state = computeAssessmentReviewState({
      assessmentKey: '00000000-0000-4000-8000-000000000001',
      carePathwayFormName: 'Bed Rail Assessment',
      lastCompletedAt: last,
      snapshot: { formName: 'Bed Rail Assessment' },
      now,
    });
    expect(state.effectiveIntervalDays).toBe(365);
    expect(state.status).toBe('overdue');
    expect(state.alertActive).toBe(true);
  });
});
