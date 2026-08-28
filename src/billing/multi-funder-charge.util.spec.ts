import { FundingStatus } from '@prisma/client';
import {
  calculatePerFunderChargeAmounts,
  shouldUsePerFunderChargeCards,
  type MultiFunderChargeInput,
} from './multi-funder-charge.util';
import { buildFundingSplits } from './billing-run.util';

function row(overrides: Partial<MultiFunderChargeInput> & { fundingId: string }): MultiFunderChargeInput {
  return {
    funderId: null,
    funderName: 'Funder',
    splitPercent: null,
    splitPriority: 1,
    isPrimary: false,
    isActive: true,
    status: FundingStatus.ACTIVE,
    chargeCardId: 'card-1',
    cardGrossAmount: 10,
    ...overrides,
  };
}

describe('shouldUsePerFunderChargeCards', () => {
  it('is true when multiple funders have split %', () => {
    const splits = buildFundingSplits([
      {
        id: 'a',
        funderId: '1',
        splitPercent: 60,
        splitPriority: 1,
        isPrimary: true,
        isActive: true,
        status: FundingStatus.ACTIVE,
        funder: { name: 'LA' },
      },
      {
        id: 'b',
        funderId: '2',
        splitPercent: 40,
        splitPriority: 2,
        isPrimary: false,
        isActive: true,
        status: FundingStatus.ACTIVE,
        funder: { name: 'Family' },
      },
    ]);
    expect(shouldUsePerFunderChargeCards(splits)).toBe(true);
  });
});

describe('calculatePerFunderChargeAmounts', () => {
  it('charges each funder using their own card gross and split %', () => {
    const result = calculatePerFunderChargeAmounts([
      row({
        fundingId: 'a',
        funderName: 'Croydon Council',
        splitPercent: 60,
        splitPriority: 1,
        isPrimary: true,
        chargeCardId: 'la-card',
        cardGrossAmount: 12.5,
      }),
      row({
        fundingId: 'b',
        funderName: 'Family Funded',
        splitPercent: 40,
        splitPriority: 2,
        chargeCardId: 'family-card',
        cardGrossAmount: 20,
      }),
    ]);
    expect(result?.lines[0]).toMatchObject({ amount: 7.5, included: true });
    expect(result?.lines[1]).toMatchObject({ amount: 8, included: true });
    expect(result?.totalAmount).toBe(15.5);
  });

  it('matches legacy totals when both funders share the same card gross', () => {
    const result = calculatePerFunderChargeAmounts([
      row({
        fundingId: 'a',
        funderName: 'Croydon Council',
        splitPercent: 60,
        splitPriority: 1,
        cardGrossAmount: 12.5,
      }),
      row({
        fundingId: 'b',
        funderName: 'Family Funded',
        splitPercent: 40,
        splitPriority: 2,
        cardGrossAmount: 12.5,
      }),
    ]);
    expect(result?.totalAmount).toBe(12.5);
  });
});
