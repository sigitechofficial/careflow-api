import { parseServiceUserDateOfDeath } from './service-user-date-of-death.util';

describe('parseServiceUserDateOfDeath', () => {
  it('parses YYYY-MM-DD at UTC noon', () => {
    expect(parseServiceUserDateOfDeath('2026-03-15')?.toISOString()).toBe(
      '2026-03-15T12:00:00.000Z',
    );
  });

  it('returns null for empty or invalid', () => {
    expect(parseServiceUserDateOfDeath('')).toBeNull();
    expect(parseServiceUserDateOfDeath('not-a-date')).toBeNull();
  });
});

describe('deathStatusAction', () => {
  const { deathStatusAction } = jest.requireActual('./service-user-date-of-death.util') as typeof import('./service-user-date-of-death.util');
  const d = new Date('2026-11-01T12:00:00Z');
  it('sets Deceased when a date is entered', () => {
    expect(deathStatusAction({ dateOfDeath: d, statusCode: 'ACTIVE', statusChangedToDeceased: false, dateCleared: false })).toEqual({ kind: 'set_deceased' });
  });
  it('refuses Deceased with no date', () => {
    expect(deathStatusAction({ dateOfDeath: null, statusCode: 'DECEASED', statusChangedToDeceased: true, dateCleared: false }).kind).toBe('refuse');
  });
  it('refuses clearing the date while Deceased', () => {
    expect(deathStatusAction({ dateOfDeath: null, statusCode: 'DECEASED', statusChangedToDeceased: false, dateCleared: true }).kind).toBe('refuse');
  });
  it('refuses choosing another status while a date of death is recorded', () => {
    expect(deathStatusAction({ dateOfDeath: d, statusCode: 'ACTIVE', statusChangedToDeceased: false, statusChangedAway: true, dateCleared: false }).kind).toBe('refuse');
  });
  it('does nothing when they agree', () => {
    expect(deathStatusAction({ dateOfDeath: d, statusCode: 'DECEASED', statusChangedToDeceased: false, dateCleared: false })).toEqual({ kind: 'none' });
    expect(deathStatusAction({ dateOfDeath: null, statusCode: 'ACTIVE', statusChangedToDeceased: false, dateCleared: false })).toEqual({ kind: 'none' });
  });
});
