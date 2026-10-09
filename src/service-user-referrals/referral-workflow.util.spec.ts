import {
  canMoveReferral,
  formatReferenceNumber,
  isQuotationExpired,
  nextQuotationStatus,
  quotationLineTotals,
  quotationTotals,
} from './referral-workflow.util';

describe('referral-workflow.util', () => {
  it('calculates carer-hours and weekly cost for a line', () => {
    // 14 visits x 30 min x 2 carers = 14 carer-hours; x £25 = £350
    expect(
      quotationLineTotals({
        visitsPerWeek: 14,
        durationMinutes: 30,
        numberOfCarers: 2,
        hourlyRate: 25,
      }),
    ).toEqual({ weeklyHours: 14, weeklyCost: 350 });
  });

  it('totals lines and charges, spreading monthly charges weekly', () => {
    const t = quotationTotals(
      [
        {
          visitsPerWeek: 7,
          durationMinutes: 45,
          numberOfCarers: 1,
          hourlyRate: 28,
        },
        {
          visitsPerWeek: 7,
          durationMinutes: 30,
          numberOfCarers: 1,
          hourlyRate: 28,
        },
      ],
      [
        { amount: 10, frequency: 'WEEKLY' },
        { amount: 52, frequency: 'MONTHLY' },
        { amount: 75, frequency: 'ONE_OFF' },
      ],
    );
    // 5.25h + 3.5h = 8.75h; x £28 = £245
    expect(t.weeklyHours).toBe(8.75);
    expect(t.weeklyCareCost).toBe(245);
    expect(t.weeklyChargesCost).toBe(10);
    expect(t.monthlyChargesCost).toBe(52);
    expect(t.oneOffChargesCost).toBe(75);
    // 245 + 10 + 52 / (52/12) = 245 + 10 + 12 = 267
    expect(t.weeklyTotal).toBe(267);
    expect(t.monthlyTotal).toBe(1157);
  });

  it('only allows sensible referral moves', () => {
    expect(canMoveReferral('NEW', 'UNDER_REVIEW')).toBe(true);
    expect(canMoveReferral('UNDER_REVIEW', 'ACCEPTED')).toBe(true);
    expect(canMoveReferral('ON_HOLD', 'ASSESSMENT_BOOKED')).toBe(true);
    expect(canMoveReferral('UNDER_REVIEW', 'NEW')).toBe(false);
    expect(canMoveReferral('ACCEPTED', 'DECLINED')).toBe(false);
    expect(canMoveReferral('DECLINED', 'UNDER_REVIEW')).toBe(true);
    expect(canMoveReferral('NEW', 'NEW')).toBe(false);
  });

  it('follows the quotation lifecycle', () => {
    expect(nextQuotationStatus('DRAFT', 'SEND')).toBe('SENT');
    expect(nextQuotationStatus('SENT', 'ACCEPT')).toBe('ACCEPTED');
    expect(nextQuotationStatus('SENT', 'DECLINE')).toBe('DECLINED');
    expect(nextQuotationStatus('DRAFT', 'ACCEPT')).toBeNull();
    expect(nextQuotationStatus('ACCEPTED', 'WITHDRAW')).toBeNull();
  });

  it('flags sent quotations past their validity date', () => {
    const d = new Date('2026-10-01T00:00:00.000Z');
    expect(isQuotationExpired('SENT', d, '2026-10-09')).toBe(true);
    expect(isQuotationExpired('SENT', d, '2026-10-01')).toBe(false);
    expect(isQuotationExpired('ACCEPTED', d, '2026-10-09')).toBe(false);
  });

  it('formats reference numbers', () => {
    expect(formatReferenceNumber('REF', 2026, 3)).toBe('REF-2026-0003');
    expect(formatReferenceNumber('QUO', 2026, 12)).toBe('QUO-2026-0012');
  });
});
