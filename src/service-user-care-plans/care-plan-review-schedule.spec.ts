import { CarePathwayFormType } from '@prisma/client';
import {
  addCalendarMonths,
  aggregateCarePlanListStatus,
  aggregatePublishedCarePlanReview,
  carePlanListStatusByServiceUser,
  computeCarePlanReviewState,
  DEFAULT_CARE_PLAN_REVIEW_FREQUENCY_MONTHS,
  defaultNextReviewDate,
  DRAFT_NEXT_REVIEW_DATE_KEY,
  ensureDraftValuesNextReviewDate,
  isoDateOnly,
  parseDraftNextReviewDate,
  resolvePublishedNextReviewDueAt,
  reviewFrequencyMonthsForCreate,
} from './care-plan-review-schedule';

describe('care-plan-review-schedule', () => {
  const from = new Date(Date.UTC(2026, 7, 31)); // 31 Aug 2026

  it('persists allowed Care Pathway frequencies and defaults CARE_PLAN to 6 months', () => {
    expect(reviewFrequencyMonthsForCreate(CarePathwayFormType.CARE_PLAN, 3)).toBe(3);
    expect(reviewFrequencyMonthsForCreate(CarePathwayFormType.CARE_PLAN, undefined)).toBe(
      DEFAULT_CARE_PLAN_REVIEW_FREQUENCY_MONTHS,
    );
    expect(reviewFrequencyMonthsForCreate(CarePathwayFormType.CARE_PLAN, 365)).toBe(6);
    expect(reviewFrequencyMonthsForCreate(CarePathwayFormType.ASSESSMENT, undefined)).toBeNull();
    expect(reviewFrequencyMonthsForCreate(CarePathwayFormType.ASSESSMENT, 12)).toBe(12);
  });

  it('adds 1 calendar month', () => {
    expect(isoDateOnly(addCalendarMonths(from, 1))).toBe('2026-09-30');
  });

  it('adds 2 calendar months', () => {
    expect(isoDateOnly(addCalendarMonths(from, 2))).toBe('2026-10-31');
  });

  it('adds 3 calendar months (month-end clamp)', () => {
    expect(isoDateOnly(addCalendarMonths(from, 3))).toBe('2026-11-30');
  });

  it('adds 6 calendar months (month-end clamp)', () => {
    expect(isoDateOnly(addCalendarMonths(from, 6))).toBe('2027-02-28');
  });

  it('adds 12 calendar months', () => {
    expect(isoDateOnly(addCalendarMonths(from, 12))).toBe('2027-08-31');
  });

  it('clamps leap-year and non-leap month-end dates', () => {
    expect(isoDateOnly(addCalendarMonths(new Date(Date.UTC(2024, 0, 31)), 1))).toBe('2024-02-29');
    expect(isoDateOnly(addCalendarMonths(new Date(Date.UTC(2025, 0, 31)), 1))).toBe('2025-02-28');
  });

  it('computes a new draft default from Care Pathway frequency, not 365 days', () => {
    const next = defaultNextReviewDate(from, 6);
    expect(next && isoDateOnly(next)).toBe('2027-02-28');
    expect(defaultNextReviewDate(from, 365)).toBeNull();
  });

  it('keeps a staff-selected draft date as an explicit override', () => {
    const values = { [DRAFT_NEXT_REVIEW_DATE_KEY]: '2026-12-15' };
    expect(isoDateOnly(parseDraftNextReviewDate(values)!)).toBe('2026-12-15');
    const ensured = ensureDraftValuesNextReviewDate(values, {
      reviewFrequencyMonths: 3,
      from,
    });
    expect(ensured[DRAFT_NEXT_REVIEW_DATE_KEY]).toBe('2026-12-15');
  });

  it('publish preserves a manual date and does not fall back to 365 days', () => {
    const published = resolvePublishedNextReviewDueAt({
      explicitDate: '2026-12-15',
      existingNextReviewDueAt: null,
      reviewFrequencyMonths: 12,
      from,
    });
    expect(published && isoDateOnly(published)).toBe('2026-12-15');
  });

  it('publish uses Care Pathway frequency when no explicit date exists', () => {
    const published = resolvePublishedNextReviewDueAt({
      explicitDate: null,
      existingNextReviewDueAt: null,
      reviewFrequencyMonths: 3,
      from,
    });
    expect(published && isoDateOnly(published)).toBe('2026-11-30');
  });

  it('does not overwrite an existing published nextReviewDueAt', () => {
    const published = resolvePublishedNextReviewDueAt({
      explicitDate: null,
      existingNextReviewDueAt: '2027-08-31',
      reviewFrequencyMonths: 6,
      from,
    });
    expect(published && isoDateOnly(published)).toBe('2027-08-31');
  });

  it('marks review overdue when today is after the review date', () => {
    const state = computeCarePlanReviewState({
      nextReviewDueAt: '2026-08-01',
      now: new Date(Date.UTC(2026, 7, 31)),
      intervalMonths: 6,
    });
    expect(state.status).toBe('overdue');
  });

  it('marks review due soon within 30 calendar days', () => {
    const state = computeCarePlanReviewState({
      nextReviewDueAt: '2026-09-15',
      now: new Date(Date.UTC(2026, 7, 31)),
      intervalMonths: 6,
    });
    expect(state.status).toBe('due_soon');
  });

  it('marks review ok when more than 30 days away', () => {
    const state = computeCarePlanReviewState({
      nextReviewDueAt: '2026-10-15',
      now: new Date(Date.UTC(2026, 7, 31)),
      intervalMonths: 6,
    });
    expect(state.status).toBe('ok');
  });

  it('flags the service user as review-required when one published plan is overdue', () => {
    const aggregate = aggregatePublishedCarePlanReview([
      { status: 'overdue' },
      { status: 'ok' },
      { status: 'ok' },
    ]);
    expect(aggregate.carePlanReviewRequired).toBe(true);
    expect(aggregate.overdueCount).toBe(1);
    expect(aggregate.upToDateCount).toBe(2);
  });

  it('does not flag the service user when all published plans are in the future', () => {
    const aggregate = aggregatePublishedCarePlanReview([{ status: 'ok' }, { status: 'due_soon' }]);
    expect(aggregate.carePlanReviewRequired).toBe(false);
    expect(aggregate.overdueCount).toBe(0);
  });
});

describe('aggregateCarePlanListStatus (7-day list icon)', () => {
  const now = new Date(Date.UTC(2026, 7, 31)); // 31 Aug 2026

  it('is none when there are no published care plans', () => {
    expect(aggregateCarePlanListStatus([], now)).toBe('none');
  });

  it('is ok when two published plans are both more than 7 days away', () => {
    expect(aggregateCarePlanListStatus(['2026-10-15', '2026-12-01'], now)).toBe('ok');
  });

  it('is due_within_week when one plan is due in 5 days and another is future', () => {
    expect(aggregateCarePlanListStatus(['2026-09-05', '2026-12-01'], now)).toBe('due_within_week');
  });

  it('is overdue when one plan is overdue and another is future', () => {
    expect(aggregateCarePlanListStatus(['2026-08-01', '2026-12-01'], now)).toBe('overdue');
  });

  it('is overdue when one plan is overdue and another is due in 5 days', () => {
    expect(aggregateCarePlanListStatus(['2026-08-01', '2026-09-05'], now)).toBe('overdue');
  });

  it('stays ok when a plan is due in 8 days (30-day due_soon would be amber)', () => {
    expect(aggregateCarePlanListStatus(['2026-09-08'], now)).toBe('ok');
    expect(
      computeCarePlanReviewState({ nextReviewDueAt: '2026-09-08', now, intervalMonths: 6 }).status,
    ).toBe('due_soon');
  });

  it('is due_within_week when the review date is today', () => {
    expect(aggregateCarePlanListStatus(['2026-08-31'], now)).toBe('due_within_week');
  });

  it('is due_within_week on the 7th calendar day and ok on the 8th', () => {
    expect(aggregateCarePlanListStatus(['2026-09-07'], now)).toBe('due_within_week');
    expect(aggregateCarePlanListStatus(['2026-09-08'], now)).toBe('ok');
  });

  it('treats a published plan with a null date as ok, not none', () => {
    expect(aggregateCarePlanListStatus([null], now)).toBe('ok');
    expect(aggregateCarePlanListStatus([null, '2026-12-01'], now)).toBe('ok');
  });

  it('maps a page of service users from batched published dates', () => {
    const byUser = carePlanListStatusByServiceUser(
      ['su-none', 'su-ok', 'su-week', 'su-overdue'],
      [
        { serviceUserId: 'su-ok', nextReviewDueAt: '2026-12-01' },
        { serviceUserId: 'su-ok', nextReviewDueAt: '2026-11-01' },
        { serviceUserId: 'su-week', nextReviewDueAt: '2026-09-05' },
        { serviceUserId: 'su-week', nextReviewDueAt: '2026-12-01' },
        { serviceUserId: 'su-overdue', nextReviewDueAt: '2026-08-01' },
        { serviceUserId: 'su-overdue', nextReviewDueAt: '2026-12-01' },
      ],
      now,
    );
    expect(byUser.get('su-none')).toBe('none');
    expect(byUser.get('su-ok')).toBe('ok');
    expect(byUser.get('su-week')).toBe('due_within_week');
    expect(byUser.get('su-overdue')).toBe('overdue');
  });
});
