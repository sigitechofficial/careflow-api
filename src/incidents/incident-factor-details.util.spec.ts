import {
  sanitizeChangesMadeDetails,
  sanitizeContributingFactorDetails,
} from './incident-factor-details.util';

describe('sanitizeContributingFactorDetails', () => {
  it('keeps items and notes for ticked factors only', () => {
    const out = sanitizeContributingFactorDetails(
      {
        STAFFING: { items: [{ id: 'e1', label: 'Liam Walsh' }], note: ' Short-staffed ' },
        CARE_PLAN: { items: [{ id: 'c1', label: 'Falls care plan' }] },
      },
      ['STAFFING'],
    );
    expect(out).toEqual({
      STAFFING: { items: [{ id: 'e1', label: 'Liam Walsh' }], note: 'Short-staffed' },
    });
  });

  it('drops unknown factors, malformed and duplicate items', () => {
    const out = sanitizeContributingFactorDetails(
      {
        NOT_A_FACTOR: { note: 'x' },
        STAFFING: {
          items: [{ id: 'e1', label: 'A' }, { id: 'e1', label: 'A again' }, { id: '', label: 'B' }, 'bad'],
        },
      },
      ['NOT_A_FACTOR', 'STAFFING'],
    );
    expect(out).toEqual({ STAFFING: { items: [{ id: 'e1', label: 'A' }] } });
  });

  it('returns null when nothing is left', () => {
    expect(sanitizeContributingFactorDetails({ STAFFING: { items: [], note: '  ' } }, ['STAFFING'])).toBeNull();
    expect(sanitizeContributingFactorDetails('nope', ['STAFFING'])).toBeNull();
  });
});

describe('sanitizeChangesMadeDetails', () => {
  it('accepts change codes and rejects contributing-factor-only codes', () => {
    const out = sanitizeChangesMadeDetails(
      {
        STAFF_TRAINING: { items: [{ id: 'e1', label: 'Liam Walsh' }] },
        HUMAN_ERROR: { note: 'not a change code' },
      },
      ['STAFF_TRAINING', 'HUMAN_ERROR'],
    );
    expect(out).toEqual({ STAFF_TRAINING: { items: [{ id: 'e1', label: 'Liam Walsh' }] } });
  });
});
