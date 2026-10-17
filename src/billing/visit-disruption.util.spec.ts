import { DisruptionRule, NOT_DECIDED, proposeDisruptionPay, ruleForEvent } from './visit-disruption.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
let seq = 0;
const rule = (over: Partial<DisruptionRule>): DisruptionRule => ({
  id: `r-${++seq}`,
  eventType: 'LATE_CANCELLATION',
  noticeBelowMinutes: null,
  outcome: 'NO_PAY',
  percent: null,
  fixedAmount: null,
  effectiveFrom: d('2026-01-01'),
  effectiveTo: null,
  status: 'ACTIVE',
  ...over,
});
const event = (over: Record<string, unknown> = {}) => ({
  eventType: 'LATE_CANCELLATION',
  eventAt: new Date('2026-11-03T09:00:00Z'),
  noticeMinutes: 90 as number | null,
  ...over,
});
const known = { hourlyRate: 14, scheduledMinutes: 60, affectedMinutes: 30 };

describe('pay for a visit that did not go ahead as planned (Q13, synthetic rules)', () => {
  it('with no rule nothing is assumed: the event is not decided, and it is not zero', () => {
    expect(ruleForEvent([], event())).toBeNull();
    const proposal = proposeDisruptionPay(null, known);
    expect(proposal).toMatchObject({ outcome: NOT_DECIDED, amount: null });
  });

  it('only an approved rule in date for that event applies', () => {
    const draft = rule({ status: 'DRAFT', outcome: 'FULL_SCHEDULED' });
    const retired = rule({ status: 'RETIRED', outcome: 'FULL_SCHEDULED' });
    const otherEvent = rule({ eventType: 'NOBODY_HOME', outcome: 'FULL_SCHEDULED' });
    const ended = rule({ outcome: 'FULL_SCHEDULED', effectiveTo: d('2026-10-31') });
    const future = rule({ outcome: 'FULL_SCHEDULED', effectiveFrom: d('2027-01-01') });
    expect(ruleForEvent([draft, retired, otherEvent, ended, future], event())).toBeNull();
    const current = rule({ outcome: 'FULL_SCHEDULED', effectiveFrom: d('2026-11-01') });
    expect(ruleForEvent([ended, current], event())?.id).toBe(current.id);
  });

  it('rules that depend on notice: the shortest limit the notice falls under', () => {
    const under2h = rule({ noticeBelowMinutes: 120, outcome: 'FULL_SCHEDULED' });
    const under24h = rule({ noticeBelowMinutes: 1440, outcome: 'PERCENT_OF_SCHEDULED', percent: 50 });
    const anyNotice = rule({ outcome: 'NO_PAY' });
    const rules = [anyNotice, under24h, under2h];
    expect(ruleForEvent(rules, event({ noticeMinutes: 90 }))?.id).toBe(under2h.id);
    expect(ruleForEvent(rules, event({ noticeMinutes: 600 }))?.id).toBe(under24h.id);
    expect(ruleForEvent(rules, event({ noticeMinutes: 3000 }))?.id).toBe(anyNotice.id);
    // Notice not known: only a rule for any notice can apply.
    expect(ruleForEvent(rules, event({ noticeMinutes: null }))?.id).toBe(anyNotice.id);
    expect(ruleForEvent([under2h, under24h], event({ noticeMinutes: null }))).toBeNull();
  });

  it('works out each outcome from the pay card rate and the visit', () => {
    expect(proposeDisruptionPay(rule({ outcome: 'NO_PAY' }), known).amount).toBe(0);
    expect(proposeDisruptionPay(rule({ outcome: 'FULL_SCHEDULED' }), known).amount).toBe(14);
    expect(proposeDisruptionPay(rule({ outcome: 'PERCENT_OF_SCHEDULED', percent: 50 }), known).amount).toBe(7);
    expect(proposeDisruptionPay(rule({ outcome: 'FIXED_AMOUNT', fixedAmount: 5 }), known).amount).toBe(5);
    expect(proposeDisruptionPay(rule({ outcome: 'HOURLY_FOR_AFFECTED_MINUTES' }), known).amount).toBe(7);
    expect(proposeDisruptionPay(rule({ outcome: 'PERCENT_OF_SCHEDULED', percent: 50 }), known).explanation).toBe(
      'Rule: 50% of 1h scheduled × £14.00.',
    );
  });

  it('a rule that cannot be worked out is left to a person, not paid as zero', () => {
    const full = rule({ outcome: 'FULL_SCHEDULED' });
    expect(proposeDisruptionPay(full, { ...known, hourlyRate: null })).toMatchObject({ outcome: 'FULL_SCHEDULED', amount: null });
    expect(proposeDisruptionPay(full, { ...known, scheduledMinutes: null }).explanation).toMatch(/scheduled length of the visit/);
    expect(proposeDisruptionPay(rule({ outcome: 'HOURLY_FOR_AFFECTED_MINUTES' }), { ...known, affectedMinutes: null }).amount).toBeNull();
    expect(proposeDisruptionPay(rule({ outcome: 'PERCENT_OF_SCHEDULED' }), known).amount).toBeNull();
  });
});
