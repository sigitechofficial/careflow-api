import {
  assessmentScheduleKey,
  computeAssessmentReviewState,
  getAssessmentReviewSchedule,
  listAssessmentReviewSchedules,
  resolveEffectiveReviewIntervalDays,
} from './assessment-review-schedule';

describe('assessment review schedules with organisation overrides', () => {
  it('uses the built-in schedule when nothing is overridden', () => {
    expect(getAssessmentReviewSchedule('waterlow')?.defaultIntervalDays).toBe(30);
    expect(getAssessmentReviewSchedule('waterlow', null, {})?.elevatedRiskIntervalDays).toBe(7);
  });

  it('applies overrides to tools and to Care Pathway catalogue forms', () => {
    const overrides = {
      waterlow: { defaultIntervalDays: 28, elevatedRiskIntervalDays: 3, dueSoonLeadDays: 5 },
      'bed-rail-assessment': { defaultIntervalDays: 180 },
    };
    expect(getAssessmentReviewSchedule('waterlow', null, overrides)).toMatchObject({
      defaultIntervalDays: 28,
      elevatedRiskIntervalDays: 3,
      dueSoonLeadDays: 5,
    });
    const formId = '6f1c1c62-4d38-4a39-9a4b-1f5c3d9c0a11';
    expect(getAssessmentReviewSchedule(formId, 'Bed Rail Assessment', overrides)?.defaultIntervalDays).toBe(180);
    expect(assessmentScheduleKey(formId, 'Bed Rail Assessment')).toBe('bed-rail-assessment');
    expect(assessmentScheduleKey('must')).toBe('must');
  });

  it('never gives an event-driven tool an interval, and never adds an elevated tier', () => {
    const overrides = {
      'mca-screening': { defaultIntervalDays: 30 },
      'advance-care-planning': { elevatedRiskIntervalDays: 10 },
    };
    expect(getAssessmentReviewSchedule('mca-screening', null, overrides)?.defaultIntervalDays).toBeUndefined();
    expect(getAssessmentReviewSchedule('advance-care-planning', null, overrides)?.elevatedRiskIntervalDays).toBeUndefined();
  });

  it('uses the score threshold carried on the schedule (Waterlow 15+, MUST 1+)', () => {
    expect(resolveEffectiveReviewIntervalDays('waterlow', { waterlow: { score: 14 } })).toBe(30);
    expect(resolveEffectiveReviewIntervalDays('waterlow', { waterlow: { score: 15 } })).toBe(7);
    expect(getAssessmentReviewSchedule('waterlow')?.elevatedRiskScoreFrom).toBe(15);
    expect(getAssessmentReviewSchedule('must')?.elevatedRiskScoreFrom).toBe(1);
    expect(
      resolveEffectiveReviewIntervalDays('waterlow', { waterlow: { score: 20 } }, null, {
        waterlow: { elevatedRiskIntervalDays: 3 },
      }),
    ).toBe(3);
  });

  it('computes the due date and due-soon window from the overridden schedule', () => {
    const state = computeAssessmentReviewState({
      assessmentKey: 'must',
      lastCompletedAt: '2026-10-01T00:00:00Z',
      snapshot: { must: { score: 0 } },
      now: new Date('2026-10-20T00:00:00Z'),
      overrides: { must: { defaultIntervalDays: 21, dueSoonLeadDays: 3 } },
    });
    expect(state.effectiveIntervalDays).toBe(21);
    expect(state.nextReviewDueAt).toBe('2026-10-22T00:00:00.000Z');
    expect(state.status).toBe('due_soon');
  });

  it('lists every tool and catalogue form with built-in values and overrides', () => {
    const rows = listAssessmentReviewSchedules({ waterlow: { defaultIntervalDays: 28 } });
    const waterlow = rows.find((r) => r.key === 'waterlow')!;
    expect(waterlow).toMatchObject({
      title: 'Waterlow',
      source: 'assessment_tool',
      overridden: true,
      builtIn: { defaultIntervalDays: 30, elevatedRiskIntervalDays: 7, dueSoonLeadDays: 7 },
    });
    expect(waterlow.schedule.defaultIntervalDays).toBe(28);
    const bedRail = rows.find((r) => r.key === 'bed-rail-assessment')!;
    expect(bedRail).toMatchObject({ source: 'care_pathway_form', title: 'Bed Rail Assessment', overridden: false });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});
