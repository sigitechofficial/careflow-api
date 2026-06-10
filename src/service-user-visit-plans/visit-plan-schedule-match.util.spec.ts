import {
  VisitPlanMonthlyDayMode,
  VisitPlanMonthlyOrdinal,
  VisitPlanScheduleFrequency,
} from '@prisma/client';
import { visitPlanSlotMatchesDay } from './visit-plan-schedule-match.util';

const base = {
  slotCode: 'MORNING',
  daysOfWeek: [1, 2, 3, 4, 5],
  repeatEvery: 1,
};

describe('visitPlanSlotMatchesDay', () => {
  const anchor = new Date(Date.UTC(2026, 0, 1));

  it('matches monthly by date', () => {
    const slot = {
      ...base,
      scheduleFrequency: VisitPlanScheduleFrequency.MONTHLY,
      monthlyDayMode: VisitPlanMonthlyDayMode.BY_DATE,
      monthlyDaysOfMonth: [1, 15],
      monthlyPatternOrdinal: null,
      monthlyPatternWeekday: null,
    };
    expect(visitPlanSlotMatchesDay(slot, new Date(Date.UTC(2026, 0, 1)), anchor)).toBe(true);
    expect(visitPlanSlotMatchesDay(slot, new Date(Date.UTC(2026, 0, 15)), anchor)).toBe(true);
    expect(visitPlanSlotMatchesDay(slot, new Date(Date.UTC(2026, 0, 2)), anchor)).toBe(false);
  });

  it('matches monthly by pattern (first Monday)', () => {
    const slot = {
      ...base,
      scheduleFrequency: VisitPlanScheduleFrequency.MONTHLY,
      monthlyDayMode: VisitPlanMonthlyDayMode.BY_PATTERN,
      monthlyDaysOfMonth: [],
      monthlyPatternOrdinal: VisitPlanMonthlyOrdinal.FIRST,
      monthlyPatternWeekday: 1,
    };
    // Jan 2026: first Monday is 5th
    expect(visitPlanSlotMatchesDay(slot, new Date(Date.UTC(2026, 0, 5)), anchor)).toBe(true);
    expect(visitPlanSlotMatchesDay(slot, new Date(Date.UTC(2026, 0, 12)), anchor)).toBe(false);
  });
});
