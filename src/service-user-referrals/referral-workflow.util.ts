import type { CareQuotationStatus, ReferralStatus } from '@prisma/client';

export const WEEKS_PER_MONTH = 52 / 12;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type QuotationLineInput = {
  visitsPerWeek: number;
  durationMinutes: number;
  numberOfCarers: number;
  hourlyRate: number;
};

export type QuotationChargeInput = {
  amount: number;
  frequency: 'ONE_OFF' | 'WEEKLY' | 'MONTHLY';
};

/** Carer-hours and cost per week for one proposed service. */
export function quotationLineTotals(line: QuotationLineInput) {
  const weeklyHours =
    (line.visitsPerWeek * line.durationMinutes * line.numberOfCarers) / 60;
  return {
    weeklyHours: round2(weeklyHours),
    weeklyCost: round2(weeklyHours * line.hourlyRate),
  };
}

/** Weekly / monthly totals. Monthly charges count towards the weekly total pro rata; one-off charges are shown separately. */
export function quotationTotals(
  lines: QuotationLineInput[],
  charges: QuotationChargeInput[],
) {
  let weeklyHours = 0;
  let weeklyCareCost = 0;
  for (const l of lines) {
    const t = quotationLineTotals(l);
    weeklyHours += t.weeklyHours;
    weeklyCareCost += t.weeklyCost;
  }
  const sum = (f: QuotationChargeInput['frequency']) =>
    charges.filter((c) => c.frequency === f).reduce((s, c) => s + c.amount, 0);
  const weeklyChargesCost = sum('WEEKLY');
  const monthlyChargesCost = sum('MONTHLY');
  const oneOffChargesCost = sum('ONE_OFF');
  const weeklyTotal =
    weeklyCareCost + weeklyChargesCost + monthlyChargesCost / WEEKS_PER_MONTH;
  return {
    weeklyHours: round2(weeklyHours),
    weeklyCareCost: round2(weeklyCareCost),
    weeklyChargesCost: round2(weeklyChargesCost),
    monthlyChargesCost: round2(monthlyChargesCost),
    oneOffChargesCost: round2(oneOffChargesCost),
    weeklyTotal: round2(weeklyTotal),
    monthlyTotal: round2(weeklyTotal * WEEKS_PER_MONTH),
  };
}

const OPEN_REFERRAL: ReferralStatus[] = [
  'NEW',
  'UNDER_REVIEW',
  'ASSESSMENT_BOOKED',
  'ON_HOLD',
];

/** Allowed referral status moves. Closed referrals can only be reopened to Under review. */
export function canMoveReferral(
  from: ReferralStatus,
  to: ReferralStatus,
): boolean {
  if (from === to) return false;
  if (OPEN_REFERRAL.includes(from)) return to !== 'NEW';
  return to === 'UNDER_REVIEW';
}

export function isReferralDecision(status: ReferralStatus): boolean {
  return status === 'ACCEPTED' || status === 'DECLINED';
}

export function isReferralOpen(status: ReferralStatus): boolean {
  return OPEN_REFERRAL.includes(status);
}

export type QuotationAction = 'SEND' | 'ACCEPT' | 'DECLINE' | 'WITHDRAW';

const QUOTATION_RULES: Record<
  QuotationAction,
  { from: CareQuotationStatus[]; to: CareQuotationStatus }
> = {
  SEND: { from: ['DRAFT'], to: 'SENT' },
  ACCEPT: { from: ['SENT'], to: 'ACCEPTED' },
  DECLINE: { from: ['SENT'], to: 'DECLINED' },
  WITHDRAW: { from: ['DRAFT', 'SENT'], to: 'WITHDRAWN' },
};

export function nextQuotationStatus(
  current: CareQuotationStatus,
  action: QuotationAction,
): CareQuotationStatus | null {
  const rule = QUOTATION_RULES[action];
  return rule.from.includes(current) ? rule.to : null;
}

/** Sent quotation past its validity date (date strings YYYY-MM-DD). */
export function isQuotationExpired(
  status: CareQuotationStatus,
  validUntil: Date | null,
  today: string,
): boolean {
  return (
    status === 'SENT' &&
    Boolean(validUntil) &&
    validUntil!.toISOString().slice(0, 10) < today
  );
}

export function formatReferenceNumber(
  prefix: 'REF' | 'QUO',
  year: number,
  sequence: number,
): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}
