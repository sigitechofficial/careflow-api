/**
 * Pay for a visit that did not go ahead as planned (Q13): cancelled by the client, cancelled
 * late, the carer already travelling, nobody home, a replacement worker, an emergency visit, a
 * visit cut short or ended early, additional waiting.
 *
 * What is paid in each case is the employer's policy. This file holds no policy: it applies the
 * rules the organisation has recorded and approved. Where no rule covers an event, nothing is
 * assumed — in particular the event is not treated as "no pay" — and it waits for a person.
 */

export const DISRUPTION_EVENTS = [
  'CLIENT_CANCELLED',
  'LATE_CANCELLATION',
  'CARER_ALREADY_TRAVELLING',
  'NOBODY_HOME',
  'REPLACEMENT_WORKER',
  'EMERGENCY_VISIT',
  'SHORTENED_VISIT',
  'ENDED_EARLY',
  'ADDITIONAL_WAITING',
] as const;
export type DisruptionEvent = (typeof DISRUPTION_EVENTS)[number];

export const DISRUPTION_OUTCOMES = [
  'NO_PAY',
  'PERCENT_OF_SCHEDULED',
  'FULL_SCHEDULED',
  'FIXED_AMOUNT',
  'HOURLY_FOR_AFFECTED_MINUTES',
] as const;
export type DisruptionOutcome = (typeof DISRUPTION_OUTCOMES)[number];

export const NOT_DECIDED = 'NOT_DECIDED';

export const DISRUPTION_EVENT_LABELS: Record<DisruptionEvent, string> = {
  CLIENT_CANCELLED: 'Cancelled by the client',
  LATE_CANCELLATION: 'Late cancellation',
  CARER_ALREADY_TRAVELLING: 'Cancelled while the carer was travelling',
  NOBODY_HOME: 'Nobody home / no access',
  REPLACEMENT_WORKER: 'Replacement worker',
  EMERGENCY_VISIT: 'Emergency visit',
  SHORTENED_VISIT: 'Visit shortened',
  ENDED_EARLY: 'Visit ended early',
  ADDITIONAL_WAITING: 'Additional waiting',
};

export type DisruptionRule = {
  id: string;
  eventType: string;
  noticeBelowMinutes: number | null;
  outcome: string;
  percent: number | null;
  fixedAmount: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: string;
};

const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The rule in force for an event: active and in date. Where rules depend on the notice given,
 * the one with the shortest limit the notice falls under; otherwise the rule for any notice.
 * Null when none applies (including a notice-dependent rule when the notice is not known).
 */
export function ruleForEvent(
  rules: DisruptionRule[],
  event: { eventType: string; eventAt: Date; noticeMinutes: number | null },
): DisruptionRule | null {
  const day = dayOf(event.eventAt);
  const inForce = rules.filter(
    (r) =>
      r.status === 'ACTIVE' &&
      r.eventType === event.eventType &&
      dayOf(r.effectiveFrom) <= day &&
      (!r.effectiveTo || dayOf(r.effectiveTo) >= day),
  );
  const latestFirst = (a: DisruptionRule, b: DisruptionRule) => dayOf(b.effectiveFrom) - dayOf(a.effectiveFrom);
  if (event.noticeMinutes != null) {
    const byNotice = inForce
      .filter((r) => r.noticeBelowMinutes != null && event.noticeMinutes! < r.noticeBelowMinutes)
      .sort((a, b) => a.noticeBelowMinutes! - b.noticeBelowMinutes! || latestFirst(a, b));
    if (byNotice.length) return byNotice[0];
  }
  return inForce.filter((r) => r.noticeBelowMinutes == null).sort(latestFirst)[0] ?? null;
}

export type DisruptionProposal = {
  outcome: string;
  /** Null when the rule cannot be worked out from what is known: a person then decides. */
  amount: number | null;
  explanation: string;
};

/** What a rule pays for an event. No rule means not decided — never zero. */
export function proposeDisruptionPay(
  rule: DisruptionRule | null,
  input: { hourlyRate: number | null; scheduledMinutes: number | null; affectedMinutes: number | null },
): DisruptionProposal {
  if (!rule) {
    return { outcome: NOT_DECIDED, amount: null, explanation: 'No approved rule covers this event. A person decides what is paid.' };
  }
  const rate = input.hourlyRate != null && input.hourlyRate > 0 ? input.hourlyRate : null;
  const needs = (what: string): DisruptionProposal => ({
    outcome: rule.outcome,
    amount: null,
    explanation: `The rule (${rule.outcome.replace(/_/g, ' ').toLowerCase()}) needs ${what}, which is not known. A person decides what is paid.`,
  });
  const hours = (minutes: number) => `${(minutes / 60).toFixed(2).replace(/\.00$/, '')}h`;
  switch (rule.outcome) {
    case 'NO_PAY':
      return { outcome: rule.outcome, amount: 0, explanation: 'Rule: nothing is paid for this event.' };
    case 'FIXED_AMOUNT':
      if (rule.fixedAmount == null) return needs('a fixed amount');
      return { outcome: rule.outcome, amount: round2(rule.fixedAmount), explanation: `Rule: fixed amount £${rule.fixedAmount.toFixed(2)}.` };
    case 'FULL_SCHEDULED':
    case 'PERCENT_OF_SCHEDULED': {
      if (rate == null) return needs('an hourly rate on the pay card');
      if (!(input.scheduledMinutes && input.scheduledMinutes > 0)) return needs('the scheduled length of the visit');
      const percent = rule.outcome === 'FULL_SCHEDULED' ? 100 : rule.percent;
      if (percent == null) return needs('a percentage');
      const amount = round2((rate * input.scheduledMinutes * percent) / 60 / 100);
      return {
        outcome: rule.outcome,
        amount,
        explanation: `Rule: ${percent}% of ${hours(input.scheduledMinutes)} scheduled × £${rate.toFixed(2)}.`,
      };
    }
    case 'HOURLY_FOR_AFFECTED_MINUTES': {
      if (rate == null) return needs('an hourly rate on the pay card');
      if (!(input.affectedMinutes && input.affectedMinutes > 0)) return needs('the minutes waited or lost');
      return {
        outcome: rule.outcome,
        amount: round2((rate * input.affectedMinutes) / 60),
        explanation: `Rule: ${hours(input.affectedMinutes)} × £${rate.toFixed(2)}.`,
      };
    }
    default:
      return needs('an outcome this version understands');
  }
}
