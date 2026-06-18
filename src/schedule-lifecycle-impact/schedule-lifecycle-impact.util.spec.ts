import {
  calendarDayUtc,
  datesOverlap,
  OPEN_ENDED_IMPACT_MAX_DAYS,
  resolveImpactEndDate,
  resolveServiceUserAbsenceJobOutcome,
} from './schedule-lifecycle-impact.util';

describe('schedule-lifecycle-impact.util', () => {
  it('resolves open-ended impact end to capped horizon', () => {
    const start = new Date(Date.UTC(2026, 5, 1, 0, 0, 0, 0));
    const end = resolveImpactEndDate(start, null);
    const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    expect(diffDays).toBeGreaterThanOrEqual(OPEN_ENDED_IMPACT_MAX_DAYS);
    expect(diffDays).toBeLessThanOrEqual(OPEN_ENDED_IMPACT_MAX_DAYS + 1);
  });

  it('detects overlapping absence and job day ranges', () => {
    const absentStart = new Date(Date.UTC(2026, 5, 10));
    const absentEnd = new Date(Date.UTC(2026, 5, 20));
    const jobDay = new Date(Date.UTC(2026, 5, 15));
    expect(datesOverlap(absentStart, absentEnd, jobDay, jobDay)).toBe(true);
    expect(
      datesOverlap(absentStart, absentEnd, new Date(Date.UTC(2026, 5, 25)), new Date(Date.UTC(2026, 5, 25))),
    ).toBe(false);
  });

  it('treats open-ended absence as overlapping future days within cap', () => {
    const absentStart = new Date(Date.UTC(2026, 5, 1));
    const future = calendarDayUtc(new Date(Date.UTC(2026, 8, 1)));
    expect(datesOverlap(absentStart, null, future, future)).toBe(true);
  });

  it('uses cancelled for planned hospital absences and call-off for unplanned', () => {
    expect(resolveServiceUserAbsenceJobOutcome('PLANNED', 'Hospital admission')).toBe('CANCELLED');
    expect(resolveServiceUserAbsenceJobOutcome('UNPLANNED', 'Sickness')).toBe('CALLED_OFF');
    expect(resolveServiceUserAbsenceJobOutcome('NOT_APPLICABLE', 'Temporary')).toBe('CALLED_OFF');
  });
});
