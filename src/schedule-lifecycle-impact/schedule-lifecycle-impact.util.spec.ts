import {
  buildUnallocateEmployeeJobsInWindowWhere,
  calendarDayUtc,
  datesOverlap,
  filterJobsByWeekdays,
  OPEN_ENDED_IMPACT_MAX_DAYS,
  resolveImpactWindow,
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

  describe('resolveImpactWindow (calendar labels → org-local day bounds)', () => {
    const label = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

    it('London BST: a single day spans 23:00Z previous day to 22:59:59.999Z', () => {
      const w = resolveImpactWindow(label('2026-07-15'), label('2026-07-15'), 'Europe/London');
      expect(w.from.toISOString()).toBe('2026-07-14T23:00:00.000Z');
      expect(w.to.toISOString()).toBe('2026-07-15T22:59:59.999Z');
    });

    it('London GMT: a single day is the UTC day', () => {
      const w = resolveImpactWindow(label('2026-01-15'), label('2026-01-15'), 'Europe/London');
      expect(w.from.toISOString()).toBe('2026-01-15T00:00:00.000Z');
      expect(w.to.toISOString()).toBe('2026-01-15T23:59:59.999Z');
    });

    it('DST days: 2026-03-29 is 23h long, 2026-10-25 is 25h long', () => {
      const spring = resolveImpactWindow(label('2026-03-29'), label('2026-03-29'), 'Europe/London');
      expect(spring.from.toISOString()).toBe('2026-03-29T00:00:00.000Z');
      expect(spring.to.toISOString()).toBe('2026-03-29T22:59:59.999Z');
      const autumn = resolveImpactWindow(label('2026-10-25'), label('2026-10-25'), 'Europe/London');
      expect(autumn.from.toISOString()).toBe('2026-10-24T23:00:00.000Z');
      expect(autumn.to.toISOString()).toBe('2026-10-25T23:59:59.999Z');
    });

    it('includes a 23:30 London BST visit (22:30Z) and excludes the previous evening', () => {
      const w = resolveImpactWindow(label('2026-07-15'), label('2026-07-15'), 'Europe/London');
      const lateVisit = new Date('2026-07-15T22:30:00.000Z');
      const previousEvening = new Date('2026-07-14T22:30:00.000Z'); // 23:30 BST on the 14th
      expect(lateVisit >= w.from && lateVisit <= w.to).toBe(true);
      expect(previousEvening >= w.from && previousEvening <= w.to).toBe(false);
    });

    it('accepts noon-UTC labels (absence dates) the same as midnight labels', () => {
      const w = resolveImpactWindow(
        new Date('2026-07-15T12:00:00.000Z'),
        new Date('2026-07-16T12:00:00.000Z'),
        'Europe/London',
      );
      expect(w.from.toISOString()).toBe('2026-07-14T23:00:00.000Z');
      expect(w.to.toISOString()).toBe('2026-07-16T22:59:59.999Z');
    });

    it('Asia/Karachi: day starts 19:00Z previous UTC day', () => {
      const w = resolveImpactWindow(label('2026-07-15'), label('2026-07-15'), 'Asia/Karachi');
      expect(w.from.toISOString()).toBe('2026-07-14T19:00:00.000Z');
      expect(w.to.toISOString()).toBe('2026-07-15T18:59:59.999Z');
    });

    it('open-ended range is capped at OPEN_ENDED_IMPACT_MAX_DAYS org-local days', () => {
      const w = resolveImpactWindow(label('2026-07-15'), null, 'Europe/London');
      expect(w.from.toISOString()).toBe('2026-07-14T23:00:00.000Z');
      // 2026-07-15 + 365 days = 2027-07-15 (BST)
      expect(w.to.toISOString()).toBe('2027-07-15T22:59:59.999Z');
    });
  });

  describe('filterJobsByWeekdays (org-local weekday)', () => {
    const jobs = [
      { id: 'mon-late', scheduledStartDateTime: new Date('2026-07-13T22:30:00.000Z') }, // Mon 23:30 BST
      { id: 'tue-early', scheduledStartDateTime: new Date('2026-07-13T23:30:00.000Z') }, // Tue 00:30 BST
    ];

    it('London BST: removing Tuesday cancels the 00:30 BST Tuesday visit only', () => {
      expect(filterJobsByWeekdays(jobs, [2], 'Europe/London').map((j) => j.id)).toEqual(['tue-early']);
      expect(filterJobsByWeekdays(jobs, [1], 'Europe/London').map((j) => j.id)).toEqual(['mon-late']);
    });

    it('Asia/Karachi: both instants are Tuesday morning PKT', () => {
      expect(filterJobsByWeekdays(jobs, [2], 'Asia/Karachi').map((j) => j.id)).toEqual([
        'mon-late',
        'tue-early',
      ]);
    });

    it('London GMT (2026-01-12 Mon 23:30 GMT = 23:30Z) stays Monday', () => {
      const winter = [{ id: 'w', scheduledStartDateTime: new Date('2026-01-12T23:30:00.000Z') }];
      expect(filterJobsByWeekdays(winter, [1], 'Europe/London')).toHaveLength(1);
      expect(filterJobsByWeekdays(winter, [1], 'Asia/Karachi')).toHaveLength(0);
    });

    it('returns all jobs when no weekdays are given', () => {
      expect(filterJobsByWeekdays(jobs, undefined, 'Europe/London')).toHaveLength(2);
    });
  });

  it('limits a timed window to overlapping visits, not the whole day', () => {
    const from = new Date('2026-10-24T10:00:00.000Z');
    const to = new Date('2026-10-24T11:00:00.000Z');
    const where = buildUnallocateEmployeeJobsInWindowWhere('emp-1', from, to);
    expect(where.scheduledJob).toMatchObject({
      scheduledStartDateTime: { lt: to },
      OR: [
        { scheduledEndDateTime: { gt: from } },
        { scheduledEndDateTime: null, scheduledStartDateTime: { gte: from } },
      ],
    });
  });
});
