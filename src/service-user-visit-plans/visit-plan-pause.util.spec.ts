import { defaultSuspensionReviewDueAt, parseVisitPlanDateOnly } from './visit-plan-pause.util';

describe('visit-plan-pause.util', () => {
  it('defaultSuspensionReviewDueAt adds seven days', () => {
    const from = new Date('2026-06-01T15:30:00.000Z');
    const due = defaultSuspensionReviewDueAt(from);
    expect(due.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('parseVisitPlanDateOnly parses YYYY-MM-DD', () => {
    const d = parseVisitPlanDateOnly('2026-12-01', 'test');
    expect(d.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});
