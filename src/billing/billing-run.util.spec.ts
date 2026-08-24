import { buildFunderSplitPreview, buildFundingSplits, type FundingSplitLine } from './billing-run.util';
import { FundingStatus } from '@prisma/client';

function fundingLine(overrides: Partial<FundingSplitLine> & { id: string }): FundingSplitLine {
  return {
    funderId: null,
    funderName: 'Funder',
    splitPercent: null,
    splitPriority: 1,
    isPrimary: false,
    ...overrides,
  };
}

describe('buildFunderSplitPreview', () => {
  it('returns null for a single funder', () => {
    expect(buildFunderSplitPreview(12.5, [fundingLine({ id: 'a', funderName: 'LA' })])).toBeNull();
  });

  it('splits across funders with configured percentages', () => {
    const preview = buildFunderSplitPreview(12.5, [
      fundingLine({ id: 'a', funderName: 'Croydon Council', splitPercent: 60, splitPriority: 1 }),
      fundingLine({ id: 'b', funderName: 'Family Funded', splitPercent: 40, splitPriority: 2 }),
    ]);
    expect(preview?.lines).toHaveLength(2);
    expect(preview?.lines[0]).toMatchObject({ funderName: 'Croydon Council', amount: 7.5, included: true });
    expect(preview?.lines[1]).toMatchObject({ funderName: 'Family Funded', amount: 5, included: true });
  });

  it('explains when only one funder has split %', () => {
    const preview = buildFunderSplitPreview(10, [
      fundingLine({ id: 'a', funderName: 'Croydon Council', splitPercent: 60, splitPriority: 1 }),
      fundingLine({ id: 'b', funderName: 'Family Funded', splitPercent: null, splitPriority: 2 }),
    ]);
    expect(preview?.lines[1]).toMatchObject({ included: false, amount: 0 });
    expect(preview?.lines[1]?.reason).toContain('No split %');
    expect(preview?.note).toContain('100%');
  });

  it('notes when funders have different charge cards', () => {
    const fundingChargeCardById = new Map([
      ['a', { id: 'card-la', name: 'Local Authority — Croydon Council' }],
      ['b', { id: 'card-family', name: 'charge card 2' }],
    ]);
    const preview = buildFunderSplitPreview(
      12.5,
      [
        fundingLine({ id: 'a', funderName: 'Croydon Council', splitPercent: 60, splitPriority: 1, isPrimary: true }),
        fundingLine({ id: 'b', funderName: 'Family Funded', splitPercent: 40, splitPriority: 2 }),
      ],
      {
        visitChargeCardId: 'card-la',
        visitChargeCardName: 'Local Authority — Croydon Council',
        fundingChargeCardById,
      },
    );
    expect(preview?.note).toContain('one gross charge');
    expect(preview?.lines[1]?.pricingNote).toContain('charge card 2');
    expect(preview?.lines[1]?.pricedWithVisitCard).toBe(false);
    expect(preview?.lines[0]?.pricedWithVisitCard).toBe(true);
  });
});

describe('buildFundingSplits', () => {
  it('ignores ended fundings', () => {
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
        status: FundingStatus.ENDED,
        funder: { name: 'Family' },
      },
    ]);
    expect(splits).toHaveLength(1);
  });
});
