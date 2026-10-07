import {
  externalBodyErrors,
  externalBodyName,
  isExternalBodyOpen,
} from './incident-external-body.util';

const today = '2026-10-07';
const base = {
  bodyType: 'POLICE',
  organisationName: null,
  referredOn: '2026-10-01',
  status: 'REFERRED',
  outcome: null,
  outcomeDate: null,
};

describe('externalBodyErrors', () => {
  it('accepts an open referral without an outcome', () => {
    expect(externalBodyErrors(base, today)).toEqual([]);
  });

  it('needs the organisation name for Other', () => {
    expect(externalBodyErrors({ ...base, bodyType: 'OTHER' }, today)).toEqual([
      'Name the organisation',
    ]);
  });

  it('needs an outcome and its date once concluded or no further action', () => {
    expect(externalBodyErrors({ ...base, status: 'CONCLUDED' }, today)).toEqual(
      ['Record their outcome', 'Give the outcome date'],
    );
    expect(
      externalBodyErrors(
        {
          ...base,
          status: 'NO_FURTHER_ACTION',
          outcome: 'NFA — no crime',
          outcomeDate: '2026-10-05',
        },
        today,
      ),
    ).toEqual([]);
  });

  it('rejects future dates and an outcome before the referral', () => {
    expect(
      externalBodyErrors({ ...base, referredOn: '2026-10-08' }, today),
    ).toEqual(['The referral date can’t be in the future']);
    expect(
      externalBodyErrors(
        {
          ...base,
          status: 'CONCLUDED',
          outcome: 'x',
          outcomeDate: '2026-09-30',
        },
        today,
      ),
    ).toEqual(['The outcome date can’t be before the referral']);
  });
});

describe('externalBodyName / isExternalBodyOpen', () => {
  it('names the body', () => {
    expect(
      externalBodyName({
        bodyType: 'POLICE',
        organisationName: 'West Yorkshire Police',
      }),
    ).toBe('Police (West Yorkshire Police)');
    expect(
      externalBodyName({ bodyType: 'OTHER', organisationName: 'Ombudsman' }),
    ).toBe('Ombudsman');
    expect(externalBodyName({ bodyType: 'CQC', organisationName: null })).toBe(
      'CQC',
    );
  });

  it('treats referred / in progress as open', () => {
    expect(isExternalBodyOpen('REFERRED')).toBe(true);
    expect(isExternalBodyOpen('IN_PROGRESS')).toBe(true);
    expect(isExternalBodyOpen('CONCLUDED')).toBe(false);
  });
});
