import {
  isWeeklyHoursCapOverrideActive,
  resolveApprovedWeeklyHoursThreshold,
  resolveWeeklyHoursCapOverride,
} from './approved-weekly-hours.util';

describe('approved-weekly-hours.util', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('uses contracted hours when no override is set', () => {
    expect(
      resolveApprovedWeeklyHoursThreshold({ contractedWeeklyHours: 20 }, now),
    ).toBe(20);
    expect(resolveWeeklyHoursCapOverride({ contractedWeeklyHours: 20 }, now)).toBeNull();
  });

  it('uses active override instead of contracted hours', () => {
    expect(
      resolveApprovedWeeklyHoursThreshold(
        {
          contractedWeeklyHours: 20,
          weeklyHoursCapOverride: 30,
          weeklyHoursCapOverrideExpiresAt: null,
        },
        now,
      ),
    ).toBe(30);
    expect(
      isWeeklyHoursCapOverrideActive(
        { weeklyHoursCapOverride: 30, weeklyHoursCapOverrideExpiresAt: null },
        now,
      ),
    ).toBe(true);
  });

  it('ignores expired override and falls back to contracted', () => {
    expect(
      resolveApprovedWeeklyHoursThreshold(
        {
          contractedWeeklyHours: 20,
          weeklyHoursCapOverride: 35,
          weeklyHoursCapOverrideExpiresAt: '2026-01-01T00:00:00.000Z',
        },
        now,
      ),
    ).toBe(20);
  });

  it('returns null when neither contracted nor override is usable', () => {
    expect(resolveApprovedWeeklyHoursThreshold({}, now)).toBeNull();
  });
});
