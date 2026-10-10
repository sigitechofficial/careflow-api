import { sanitizeOutcomeSharing } from './incident-outcome.util';

const today = '2026-10-06';

describe('sanitizeOutcomeSharing', () => {
  it('accepts a shared row and a not-shared row with a reason', () => {
    const { entries, errors } = sanitizeOutcomeSharing(
      [
        { key: 'SU:1', personKind: 'SERVICE_USER', name: 'James', shared: true, sharedOn: '2026-10-05', method: 'IN_PERSON' },
        { key: 'REP:1', personKind: 'REPRESENTATIVE', name: 'Daughter', shared: false, notSharedReason: 'NOT_NEEDED' },
      ],
      today,
    );
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.key)).toEqual(['SU:1', 'REP:1']);
    expect(entries[1].sharedOn).toBeNull();
  });

  it('needs a date and method when shared, and a reason when not', () => {
    const { errors } = sanitizeOutcomeSharing(
      [
        { key: 'SU:1', personKind: 'SERVICE_USER', name: 'James', shared: true },
        { key: 'REP:1', personKind: 'REPRESENTATIVE', name: 'Daughter', shared: false },
      ],
      today,
    );
    expect(errors).toEqual([
      'when the outcome was shared with James',
      'how the outcome was shared with James',
      'whether the outcome was shared with Daughter',
    ]);
  });

  it('rejects future dates and needs a note for "not appropriate"', () => {
    const { errors } = sanitizeOutcomeSharing(
      [
        { key: 'SU:1', personKind: 'SERVICE_USER', name: 'James', shared: true, sharedOn: '2026-10-07', method: 'PHONE' },
        { key: 'REP:1', personKind: 'REPRESENTATIVE', name: 'Son', shared: false, notSharedReason: 'NOT_APPROPRIATE' },
      ],
      today,
    );
    expect(errors).toEqual([
      'a date that is not in the future for James',
      'why sharing with Son was not appropriate',
    ]);
  });

  it('drops unknown kinds and duplicate keys', () => {
    const { entries } = sanitizeOutcomeSharing(
      [
        { key: 'X', personKind: 'ALIEN', name: 'x', shared: false, notSharedReason: 'DECLINED' },
        { key: 'SU:1', personKind: 'SERVICE_USER', name: 'A', shared: false, notSharedReason: 'DECLINED' },
        { key: 'SU:1', personKind: 'SERVICE_USER', name: 'B', shared: false, notSharedReason: 'DECLINED' },
      ],
      today,
    );
    expect(entries.map((e) => e.name)).toEqual(['A']);
  });
});

it('needs a name only for people the outcome was shared with', () => {
  const { errors } = sanitizeOutcomeSharing(
    [
      { key: 'REP:1', personKind: 'REPRESENTATIVE', name: '', shared: false, notSharedReason: 'NOT_NEEDED' },
      { key: 'REP:2', personKind: 'REPRESENTATIVE', name: '', shared: true, sharedOn: '2026-10-05', method: 'PHONE' },
    ],
    '2026-10-06',
  );
  expect(errors).toEqual(['the name of each person the outcome was shared with']);
});
