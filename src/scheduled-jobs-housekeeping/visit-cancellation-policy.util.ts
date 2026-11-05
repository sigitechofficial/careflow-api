import type { PrismaService } from '../prisma/prisma.service';
import type { DomJobCancellationRule } from '../organisation-general-settings/dom-care-settings.util';
import type { VisitCancellationReasonCode } from './visit-cancellation-reason.util';

export type VisitCancelledByParty = 'SERVICE_USER' | 'AGENCY' | 'OTHER';

export type VisitCancellationSuggestedDecision = 'CHARGE' | 'NO_CHARGE' | 'PENDING_REVIEW';

/** Reasons offered for each "Cancelled by" choice (plan-level cancellations are always planned stops). */
export const VISIT_CANCELLATION_REASONS_BY_PARTY: Record<VisitCancelledByParty, VisitCancellationReasonCode[]> = {
  SERVICE_USER: ['CLIENT_REQUEST', 'CLIENT_HOSPITAL_ADMISSION', 'SERVICE_NOT_REQUIRED', 'OTHER'],
  AGENCY: ['PROVIDER_UNABLE_TO_STAFF', 'PROVIDER_ROTA_ERROR', 'WEATHER_OR_EMERGENCY', 'DUPLICATE_ENTRY', 'OTHER'],
  OTHER: ['OTHER'],
};

/**
 * Funding where the provider's own late-cancellation terms do not apply automatically —
 * the commissioning contract decides, so finance must confirm before any charge.
 */
export const COMMISSIONED_FUNDING_TYPE_CODES = ['LOCAL_AUTHORITY', 'NHS', 'DIRECT_PAYMENT', 'MIXED'] as const;

/**
 * Marker saved in `policySnapshot.timebank` on every cancellation recorded since chargeable
 * cancellations stopped going into the timebank. Older cancellations have no marker and keep
 * their old timebank treatment.
 */
export const TIMEBANK_CHARGEABLE_NOT_BANKED = 'CHARGEABLE_NOT_BANKED';

/** True when a cancellation was charged under the rule that keeps it out of the timebank. */
export function isTimebankChargeableCancellation(cancellation: {
  chargeDecision: string | null;
  policySnapshot: unknown;
  reinstatedAt?: Date | null;
}): boolean {
  if (cancellation.reinstatedAt) return false;
  if (cancellation.chargeDecision !== 'CHARGE') return false;
  const snapshot = cancellation.policySnapshot;
  return (
    snapshot != null &&
    typeof snapshot === 'object' &&
    (snapshot as { timebank?: unknown }).timebank === TIMEBANK_CHARGEABLE_NOT_BANKED
  );
}

/** Who cancelled, read from the reason when nobody chose it (the rota dialog has no "Cancelled by"). */
export function cancelledByPartyFromReason(reasonCode: string): VisitCancelledByParty {
  if (reasonCode.startsWith('CLIENT_') || reasonCode === 'SERVICE_NOT_REQUIRED') return 'SERVICE_USER';
  if (reasonCode.startsWith('PROVIDER_')) return 'AGENCY';
  return 'OTHER';
}

/** Funding the cancellation policy looks at: a commissioned line first, else the primary one. */
export async function resolveCancellationFundingType(
  prisma: Pick<PrismaService, 'serviceUserFunding'>,
  serviceUserId: string,
): Promise<{ code: string; name: string } | null> {
  const lines = await prisma.serviceUserFunding.findMany({
    where: { serviceUserId, deletedAt: null, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { splitPriority: 'asc' }],
    select: { fundingType: { select: { code: true, name: true } } },
  });
  if (!lines.length) return null;
  const commissioned = lines.find((l) =>
    (COMMISSIONED_FUNDING_TYPE_CODES as readonly string[]).includes(l.fundingType.code),
  );
  return (commissioned ?? lines[0]!).fundingType;
}

export type VisitCancellationPolicyInput = {
  cancelledBy: VisitCancelledByParty;
  reasonCode: VisitCancellationReasonCode;
  /** Hours between recording the cancellation and the visit's planned start (never negative). */
  noticeHours: number;
  /** Settings → Dom Care Settings → Job Cancellation. */
  rules: DomJobCancellationRule[];
  hospitalExemption: boolean;
  /** Primary active funding type code for the service user, when known. */
  fundingTypeCode?: string | null;
};

export type VisitCancellationPolicyResult = {
  decision: VisitCancellationSuggestedDecision;
  chargePercent: number;
  explanation: string;
  /** Copy of what was applied, stored with the cancellation so later setting changes never rewrite history. */
  snapshot: {
    basis: 'AGENCY' | 'OTHER_PARTY' | 'HOSPITAL_EXEMPTION' | 'NOTICE_RULE' | 'NO_MATCHING_RULE' | 'COMMISSIONED_FUNDING';
    noticeHours: number;
    rule: { hoursFrom: number; hoursTo: number | null; chargeServiceUserPercent: number } | null;
    fundingTypeCode: string | null;
  };
};

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} hour${rounded === 1 ? '' : 's'}`;
}

/**
 * Pick the notice band for a cancellation. Bands are `[hoursFrom, hoursTo)`; the band with the
 * highest `hoursFrom` is open-ended so a cancellation days ahead still matches a rule.
 */
export function matchCancellationNoticeRule(
  rules: DomJobCancellationRule[],
  noticeHours: number,
): { rule: DomJobCancellationRule; openEnded: boolean } | null {
  const sorted = [...rules].sort((a, b) => a.hoursFrom - b.hoursFrom);
  if (!sorted.length) return null;
  const last = sorted[sorted.length - 1]!;
  if (noticeHours >= last.hoursFrom) return { rule: last, openEnded: true };
  const hit = sorted.find((r) => noticeHours >= r.hoursFrom && noticeHours < r.hoursTo);
  return hit ? { rule: hit, openEnded: false } : null;
}

export function evaluateVisitCancellationPolicy(input: VisitCancellationPolicyInput): VisitCancellationPolicyResult {
  const noticeHours = Math.max(0, input.noticeHours);
  const fundingTypeCode = input.fundingTypeCode?.trim().toUpperCase() || null;
  const base = { noticeHours, rule: null, fundingTypeCode } as const;

  if (input.cancelledBy === 'AGENCY') {
    return {
      decision: 'NO_CHARGE',
      chargePercent: 0,
      explanation: 'Cancelled by our agency — the service user is not charged.',
      snapshot: { ...base, basis: 'AGENCY' },
    };
  }

  if (input.cancelledBy === 'OTHER') {
    return {
      decision: 'PENDING_REVIEW',
      chargePercent: 0,
      explanation: 'Cancelled by another party — finance to confirm whether to charge.',
      snapshot: { ...base, basis: 'OTHER_PARTY' },
    };
  }

  if (input.hospitalExemption && input.reasonCode === 'CLIENT_HOSPITAL_ADMISSION') {
    return {
      decision: 'NO_CHARGE',
      chargePercent: 0,
      explanation: 'Hospital admission — no charge under the cancellation policy.',
      snapshot: { ...base, basis: 'HOSPITAL_EXEMPTION' },
    };
  }

  const matched = matchCancellationNoticeRule(input.rules, noticeHours);
  if (!matched) {
    return {
      decision: 'PENDING_REVIEW',
      chargePercent: 0,
      explanation: `No cancellation rule covers ${formatHours(noticeHours)} notice — finance to confirm.`,
      snapshot: { ...base, basis: 'NO_MATCHING_RULE' },
    };
  }

  const percent = Math.min(100, Math.max(0, Math.round(matched.rule.chargeServiceUserPercent)));
  const rule = {
    hoursFrom: matched.rule.hoursFrom,
    hoursTo: matched.openEnded ? null : matched.rule.hoursTo,
    chargeServiceUserPercent: percent,
  };
  const band = matched.openEnded
    ? `${matched.rule.hoursFrom} hours or more`
    : `under ${matched.rule.hoursTo} hours`;

  if (percent <= 0) {
    return {
      decision: 'NO_CHARGE',
      chargePercent: 0,
      explanation: `${formatHours(noticeHours)} notice (${band}) — no charge.`,
      snapshot: { ...base, rule, basis: 'NOTICE_RULE' },
    };
  }

  if (fundingTypeCode && (COMMISSIONED_FUNDING_TYPE_CODES as readonly string[]).includes(fundingTypeCode)) {
    return {
      decision: 'PENDING_REVIEW',
      chargePercent: percent,
      explanation: `${formatHours(noticeHours)} notice (${band}) would be charged at ${percent}%, but this care is commissioned — finance to confirm against the contract.`,
      snapshot: { ...base, rule, basis: 'COMMISSIONED_FUNDING' },
    };
  }

  return {
    decision: 'CHARGE',
    chargePercent: percent,
    explanation: `${formatHours(noticeHours)} notice (${band}) — charge ${percent}% of the visit fee.`,
    snapshot: { ...base, rule, basis: 'NOTICE_RULE' },
  };
}
