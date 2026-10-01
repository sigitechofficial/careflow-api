import { decideKeySafeProposal } from './initial-assessment-key-safe.util';

describe('decideKeySafeProposal', () => {
  it('ignores an empty assessment answer', () => {
    expect(decideKeySafeProposal('', '1234')).toBe('none');
    expect(decideKeySafeProposal(null, null)).toBe('none');
  });

  it('fills an empty master only', () => {
    expect(decideKeySafeProposal('1234', null)).toBe('fill_master');
    expect(decideKeySafeProposal('1234', '  ')).toBe('fill_master');
  });

  it('never overwrites a different master code', () => {
    expect(decideKeySafeProposal('1234', '9999')).toBe('conflict');
    expect(decideKeySafeProposal('12 34', '1234')).toBe('matches');
  });
});
