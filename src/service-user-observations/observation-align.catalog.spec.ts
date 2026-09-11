import { formatAlignedCareValue } from './observation-align.catalog';

describe('formatAlignedCareValue', () => {
  it('labels meals fields like the carer app form', () => {
    expect(
      formatAlignedCareValue('MEALS', {
        amount: 'HALF',
        texture: ['PUREED'],
      }),
    ).toBe('Amount eaten: Half · Texture / support: Pureed');
  });

  it('labels refused reason and comma-joins texture codes', () => {
    expect(
      formatAlignedCareValue('MEALS', {
        amount: 'REFUSED',
        refused_reason: 'NOT_HUNGRY',
        texture: 'PUREED,ASSISTED',
      }),
    ).toBe(
      'Amount eaten: Refused · Why refused: Not hungry · Texture / support: Pureed, Assisted',
    );
  });
});
