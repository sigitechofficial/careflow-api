import { fallsCaseFinding } from './initial-assessment-falls.util';

const none = { fallsLast12Months: false, unsteadiness: false, fearOfFalling: false, clinicalConcern: false };

describe('fallsCaseFinding', () => {
  it('requires the falls assessment after a fall or with unsteadiness', () => {
    expect(fallsCaseFinding({ ...none, fallsLast12Months: true }).status).toBe('required');
    expect(fallsCaseFinding({ ...none, unsteadiness: true, fearOfFalling: null }).status).toBe('required');
  });

  it('suggests it for fear of falling or another clinical concern', () => {
    const result = fallsCaseFinding({ ...none, fearOfFalling: true });
    expect(result.status).toBe('suggested');
    expect(result.reasons).toEqual(['Fear of falling']);
  });

  it('is not needed only when every screen is a clear No', () => {
    expect(fallsCaseFinding(none).status).toBe('not_needed');
  });

  it('stays pending when the screen is unanswered (never treated as required)', () => {
    expect(fallsCaseFinding({ ...none, clinicalConcern: null }).status).toBe('pending');
    expect(
      fallsCaseFinding({ fallsLast12Months: null, unsteadiness: null, fearOfFalling: null, clinicalConcern: null })
        .status,
    ).toBe('pending');
  });
});
