import { adjacentVisits, hmDifferenceMinutes } from './allocation-job-rules.util';

const at = (hm: string) => new Date(`2026-10-20T${hm}:00.000Z`);
const visit = (start: string, end: string, id: string) => ({ id, start: at(start), end: at(end) });

describe('hmDifferenceMinutes', () => {
  it('measures clock distance and wraps midnight', () => {
    expect(hmDifferenceMinutes('09:00', '09:45')).toBe(45);
    expect(hmDifferenceMinutes('23:50', '00:10')).toBe(20);
  });

  it('returns null for values that are not HH:mm', () => {
    expect(hmDifferenceMinutes('9:00', '09:00')).toBeNull();
    expect(hmDifferenceMinutes(null, '09:00')).toBeNull();
  });
});

describe('adjacentVisits', () => {
  it('picks the nearest visit before and after, ignoring overlaps', () => {
    const visits = [
      visit('06:00', '07:00', 'early'),
      visit('08:00', '09:00', 'prev'),
      visit('09:30', '10:30', 'overlap'),
      visit('11:00', '12:00', 'next'),
      visit('14:00', '15:00', 'later'),
    ];
    const { previous, next } = adjacentVisits(visits, at('10:00'), at('11:00'));
    expect(previous?.id).toBe('prev');
    expect(next?.id).toBe('next');
  });

  it('ignores visits more than 12 hours away', () => {
    const { previous, next } = adjacentVisits([visit('00:00', '01:00', 'far')], at('14:00'), at('15:00'));
    expect(previous).toBeNull();
    expect(next).toBeNull();
  });
});
