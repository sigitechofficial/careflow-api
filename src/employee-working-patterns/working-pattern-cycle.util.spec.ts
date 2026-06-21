import { DayOfWeek } from '@prisma/client';
import {
  resolveCycleWeekIndex,
  resolvePatternForDate,
  utcMonday,
  type WorkingPatternCycleConfig,
  type WorkingPatternRow,
} from './working-pattern-cycle.util';

const baseConfig: WorkingPatternCycleConfig = {
  workingPatternCycleWeeks: 2,
  workingPatternCycleAnchorDate: new Date(Date.UTC(2026, 0, 5, 0, 0, 0, 0)), // Mon 2026-01-05
  startDate: null,
  employeeCreatedAt: new Date(Date.UTC(2025, 0, 1)),
};

function row(weekInCycle: number, dayOfWeek: DayOfWeek, isAvailable = true): WorkingPatternRow {
  return {
    weekInCycle,
    dayOfWeek,
    startTime: '09:00',
    endTime: '17:00',
    isAvailable,
    notes: null,
  };
}

describe('utcMonday', () => {
  it('returns Monday for a Wednesday', () => {
    const wed = new Date(Date.UTC(2026, 0, 7)); // Wed Jan 7
    expect(utcMonday(wed).toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });

  it('returns previous Monday for Sunday', () => {
    const sun = new Date(Date.UTC(2026, 0, 11)); // Sun Jan 11
    expect(utcMonday(sun).toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });
});

describe('resolveCycleWeekIndex', () => {
  const anchor = new Date(Date.UTC(2026, 0, 5));

  it('returns 1 for anchor week Monday', () => {
    expect(resolveCycleWeekIndex(new Date(Date.UTC(2026, 0, 5)), anchor, 2)).toBe(1);
  });

  it('returns 2 for the following week Monday', () => {
    expect(resolveCycleWeekIndex(new Date(Date.UTC(2026, 0, 12)), anchor, 2)).toBe(2);
  });

  it('wraps back to week 1 after two weeks', () => {
    expect(resolveCycleWeekIndex(new Date(Date.UTC(2026, 0, 19)), anchor, 2)).toBe(1);
  });

  it('always returns 1 when cycleWeeks is 1', () => {
    expect(resolveCycleWeekIndex(new Date(Date.UTC(2026, 0, 12)), anchor, 1)).toBe(1);
  });
});

describe('resolvePatternForDate', () => {
  const rows: WorkingPatternRow[] = [
    row(1, DayOfWeek.MONDAY),
    row(2, DayOfWeek.MONDAY, false),
  ];

  it('uses week 1 pattern on anchor week Monday', () => {
    const p = resolvePatternForDate(rows, baseConfig, '2026-01-05');
    expect(p?.weekInCycle).toBe(1);
    expect(p?.isAvailable).toBe(true);
  });

  it('uses week 2 pattern on following Monday', () => {
    const p = resolvePatternForDate(rows, baseConfig, '2026-01-12');
    expect(p?.weekInCycle).toBe(2);
    expect(p?.isAvailable).toBe(false);
  });

  it('ignores week 2 when cycleWeeks is 1', () => {
    const config: WorkingPatternCycleConfig = { ...baseConfig, workingPatternCycleWeeks: 1 };
    const p = resolvePatternForDate(rows, config, '2026-01-12');
    expect(p?.weekInCycle).toBe(1);
    expect(p?.isAvailable).toBe(true);
  });
});
