import {
  compartmentMatchesVisitRound,
  filterCompartmentsForVisitRound,
  medMatchesCompartmentDueTime,
} from './employee-app-visit-medication-round.util';

describe('employee-app-visit-medication-round.util', () => {
  const morningRound = { code: 'MORNING', name: 'Morning', dueTime: '08:00' };

  it('matches compartment by due time', () => {
    expect(
      compartmentMatchesVisitRound({ label: 'Morning dose', dueTime: '08:00' }, morningRound),
    ).toBe(true);
  });

  it('matches compartment by label when due time differs', () => {
    expect(
      compartmentMatchesVisitRound({ label: 'Morning', dueTime: '09:00' }, morningRound),
    ).toBe(true);
  });

  it('filters compartments for visit round', () => {
    const compartments = [
      { id: '1', label: 'Morning', dueTime: '08:00' },
      { id: '2', label: 'Evening', dueTime: '18:00' },
    ];
    expect(filterCompartmentsForVisitRound(compartments, morningRound)).toEqual([compartments[0]]);
  });

  it('matches medication schedule to compartment due time', () => {
    expect(
      medMatchesCompartmentDueTime([{ dueTime: '08:00' }, { dueTime: '18:00' }], '8:00'),
    ).toBe(true);
  });
});
