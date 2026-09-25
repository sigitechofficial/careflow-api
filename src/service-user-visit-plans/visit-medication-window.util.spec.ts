import {
  dueTimeFallsInHmWindow,
  dueTimeFallsInVisitInstantWindow,
  parseHmToMinutes,
  pickScheduleInVisitWindow,
} from './visit-medication-window.util';

describe('visit-medication-window.util', () => {
  it('parses HH:mm to minutes', () => {
    expect(parseHmToMinutes('09:30')).toBe(9 * 60 + 30);
    expect(parseHmToMinutes('6:00')).toBe(6 * 60);
    expect(parseHmToMinutes('bad')).toBeNull();
  });

  it('matches due time inside same-day visit window (inclusive)', () => {
    expect(dueTimeFallsInHmWindow('09:30', '09:00', '10:00')).toBe(true);
    expect(dueTimeFallsInHmWindow('09:00', '09:00', '10:00')).toBe(true);
    expect(dueTimeFallsInHmWindow('10:00', '09:00', '10:00')).toBe(true);
    expect(dueTimeFallsInHmWindow('08:59', '09:00', '10:00')).toBe(false);
    expect(dueTimeFallsInHmWindow('10:01', '09:00', '10:00')).toBe(false);
  });

  it('does not put 09:30 on a 06:00–08:00 visit', () => {
    expect(dueTimeFallsInHmWindow('09:30', '06:00', '08:00')).toBe(false);
  });

  it('handles overnight windows', () => {
    expect(dueTimeFallsInHmWindow('23:00', '22:00', '06:00')).toBe(true);
    expect(dueTimeFallsInHmWindow('05:00', '22:00', '06:00')).toBe(true);
    expect(dueTimeFallsInHmWindow('12:00', '22:00', '06:00')).toBe(false);
  });

  it('picks the schedule whose dueTime is in the visit window', () => {
    const schedules = [
      { dueTime: '07:00', round: { code: 'MORNING' } },
      { dueTime: '09:30', round: { code: 'MORNING' } },
    ];
    expect(pickScheduleInVisitWindow(schedules, '09:00', '10:00')?.dueTime).toBe('09:30');
    expect(pickScheduleInVisitWindow(schedules, '06:00', '08:00')?.dueTime).toBe('07:00');
    expect(pickScheduleInVisitWindow(schedules, '11:00', '12:00')).toBeNull();
  });

  it('matches due time against absolute visit instants', () => {
    const combine = (day: string, hm: string) => {
      const [h, m] = hm.split(':').map(Number);
      return new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
    };
    expect(
      dueTimeFallsInVisitInstantWindow({
        dueTime: '09:30',
        visitDayIso: '2026-03-25',
        windowStart: combine('2026-03-25', '09:00'),
        windowEnd: combine('2026-03-25', '10:00'),
        combineDateAndHm: (d, hm) => combine(d, hm),
        timeZone: 'UTC',
      }),
    ).toBe(true);
    expect(
      dueTimeFallsInVisitInstantWindow({
        dueTime: '09:30',
        visitDayIso: '2026-03-25',
        windowStart: combine('2026-03-25', '06:00'),
        windowEnd: combine('2026-03-25', '08:00'),
        combineDateAndHm: (d, hm) => combine(d, hm),
        timeZone: 'UTC',
      }),
    ).toBe(false);
  });
});
