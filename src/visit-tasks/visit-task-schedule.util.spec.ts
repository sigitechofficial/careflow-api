import {
  VisitPlanMonthlyDayMode,
  VisitPlanMonthlyOrdinal,
  VisitPlanRepeatUnit,
  VisitPlanScheduleFrequency,
} from '@prisma/client';
import {
  mergeVisitTaskSchedule,
  visitTaskMatchesDay,
} from './visit-task-schedule.util';

describe('visitTaskMatchesDay', () => {
  const monday = new Date(Date.UTC(2026, 7, 3)); // Mon 3 Aug 2026
  const tuesday = new Date(Date.UTC(2026, 7, 4));

  it('matches daily tasks on selected weekdays', () => {
    const schedule = mergeVisitTaskSchedule({
      scheduleFrequency: VisitPlanScheduleFrequency.DAILY,
      daysOfWeek: [1], // Monday
      repeatEvery: 1,
    });
    expect(visitTaskMatchesDay(schedule, monday, monday)).toBe(true);
    expect(visitTaskMatchesDay(schedule, tuesday, monday)).toBe(false);
  });

  it('matches weekly tasks every N weeks', () => {
    const schedule = mergeVisitTaskSchedule({
      scheduleFrequency: VisitPlanScheduleFrequency.WEEKLY,
      daysOfWeek: [1],
      repeatEvery: 2,
      repeatUnit: VisitPlanRepeatUnit.WEEKS,
    });
    const nextWeek = new Date(Date.UTC(2026, 7, 10));
    const fortnight = new Date(Date.UTC(2026, 7, 17));
    expect(visitTaskMatchesDay(schedule, monday, monday)).toBe(true);
    expect(visitTaskMatchesDay(schedule, nextWeek, monday)).toBe(false);
    expect(visitTaskMatchesDay(schedule, fortnight, monday)).toBe(true);
  });

  it('matches monthly by date', () => {
    const schedule = mergeVisitTaskSchedule({
      scheduleFrequency: VisitPlanScheduleFrequency.MONTHLY,
      monthlyDayMode: VisitPlanMonthlyDayMode.BY_DATE,
      monthlyDaysOfMonth: [3],
      monthlyPatternOrdinal: VisitPlanMonthlyOrdinal.FIRST,
      repeatEvery: 1,
      repeatUnit: VisitPlanRepeatUnit.MONTHS,
    });
    expect(visitTaskMatchesDay(schedule, monday, monday)).toBe(true);
    expect(visitTaskMatchesDay(schedule, tuesday, monday)).toBe(false);
  });
});
