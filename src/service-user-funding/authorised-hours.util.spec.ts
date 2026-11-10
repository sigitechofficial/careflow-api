import { totalAuthorisedWeeklyHours, unfundedWeeklyHours } from './authorised-hours.util';

describe('authorised weekly hours', () => {
  it('adds the agreed hours on every live line', () => {
    expect(totalAuthorisedWeeklyHours([{ authorisedWeeklyHours: 10 }, { authorisedWeeklyHours: 2 }])).toBe(12);
  });
  it('ignores lines with no agreed hours, and is empty when none have any', () => {
    expect(totalAuthorisedWeeklyHours([{ authorisedWeeklyHours: 7.5 }, { authorisedWeeklyHours: null }])).toBe(7.5);
    expect(totalAuthorisedWeeklyHours([{ authorisedWeeklyHours: null }])).toBeNull();
    expect(totalAuthorisedWeeklyHours([])).toBeNull();
  });
  it('reports planned hours above the agreed hours', () => {
    expect(unfundedWeeklyHours(14, 12)).toBe(2);
    expect(unfundedWeeklyHours(12, 12)).toBeNull();
    expect(unfundedWeeklyHours(10, 12)).toBeNull();
    expect(unfundedWeeklyHours(10, null)).toBeNull();
  });
});
