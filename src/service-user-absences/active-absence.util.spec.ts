import { activeServiceUserAbsenceWhere, calendarDayUtcNoon } from './active-absence.util';

describe('activeServiceUserAbsenceWhere', () => {
  const today = calendarDayUtcNoon(new Date('2026-05-19T08:00:00Z'));

  it('matches open-ended absences that started on or before today', () => {
    expect(activeServiceUserAbsenceWhere(today)).toEqual({
      deletedAt: null,
      startDate: { lte: today },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    });
  });
});
