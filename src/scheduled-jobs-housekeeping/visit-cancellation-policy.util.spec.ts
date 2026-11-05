import { DEFAULT_DOM_JOB_CANCELLATION_RULES } from '../organisation-general-settings/dom-care-settings.util';
import {
  TIMEBANK_CHARGEABLE_NOT_BANKED,
  cancelledByPartyFromReason,
  evaluateVisitCancellationPolicy,
  isTimebankChargeableCancellation,
  matchCancellationNoticeRule,
} from './visit-cancellation-policy.util';

const rules = DEFAULT_DOM_JOB_CANCELLATION_RULES;

describe('visit cancellation policy', () => {
  it('charges the full visit when the service user cancels under 24 hours', () => {
    const result = evaluateVisitCancellationPolicy({
      cancelledBy: 'SERVICE_USER',
      reasonCode: 'CLIENT_REQUEST',
      noticeHours: 8,
      rules,
      hospitalExemption: true,
    });
    expect(result.decision).toBe('CHARGE');
    expect(result.chargePercent).toBe(100);
  });

  it('does not charge at exactly 24 hours or days ahead (last band is open-ended)', () => {
    for (const noticeHours of [24, 25, 72, 400]) {
      const result = evaluateVisitCancellationPolicy({
        cancelledBy: 'SERVICE_USER',
        reasonCode: 'CLIENT_REQUEST',
        noticeHours,
        rules,
        hospitalExemption: true,
      });
      expect(result.decision).toBe('NO_CHARGE');
    }
    expect(matchCancellationNoticeRule(rules, 72)?.openEnded).toBe(true);
  });

  it('never charges when our agency cancels', () => {
    const result = evaluateVisitCancellationPolicy({
      cancelledBy: 'AGENCY',
      reasonCode: 'PROVIDER_UNABLE_TO_STAFF',
      noticeHours: 1,
      rules,
      hospitalExemption: true,
    });
    expect(result.decision).toBe('NO_CHARGE');
  });

  it('exempts hospital admission at any notice, unless the exemption is switched off', () => {
    const input = {
      cancelledBy: 'SERVICE_USER' as const,
      reasonCode: 'CLIENT_HOSPITAL_ADMISSION' as const,
      noticeHours: 4,
      rules,
    };
    expect(evaluateVisitCancellationPolicy({ ...input, hospitalExemption: true }).decision).toBe('NO_CHARGE');
    expect(evaluateVisitCancellationPolicy({ ...input, hospitalExemption: false }).decision).toBe('CHARGE');
  });

  it('sends "other" cancellations to finance review', () => {
    const result = evaluateVisitCancellationPolicy({
      cancelledBy: 'OTHER',
      reasonCode: 'OTHER',
      noticeHours: 2,
      rules,
      hospitalExemption: true,
    });
    expect(result.decision).toBe('PENDING_REVIEW');
  });

  it('sends a chargeable late cancellation to finance review for commissioned funding only', () => {
    const input = {
      cancelledBy: 'SERVICE_USER' as const,
      reasonCode: 'CLIENT_REQUEST' as const,
      rules,
      hospitalExemption: true,
    };
    expect(
      evaluateVisitCancellationPolicy({ ...input, noticeHours: 3, fundingTypeCode: 'LOCAL_AUTHORITY' }).decision,
    ).toBe('PENDING_REVIEW');
    expect(evaluateVisitCancellationPolicy({ ...input, noticeHours: 3, fundingTypeCode: 'PRIVATE' }).decision).toBe(
      'CHARGE',
    );
    expect(
      evaluateVisitCancellationPolicy({ ...input, noticeHours: 48, fundingTypeCode: 'LOCAL_AUTHORITY' }).decision,
    ).toBe('NO_CHARGE');
  });
});

describe('timebank chargeable cancellation', () => {
  const marked = { timebank: TIMEBANK_CHARGEABLE_NOT_BANKED };
  it('only a Charge decision recorded with the timebank marker, not reinstated, counts', () => {
    expect(isTimebankChargeableCancellation({ chargeDecision: 'CHARGE', policySnapshot: marked })).toBe(true);
    expect(isTimebankChargeableCancellation({ chargeDecision: 'CHARGE', policySnapshot: null })).toBe(false);
    expect(isTimebankChargeableCancellation({ chargeDecision: 'CHARGE', policySnapshot: { basis: 'NOTICE_RULE' } })).toBe(false);
    for (const d of ['NO_CHARGE', 'WAIVE', 'PENDING_REVIEW']) {
      expect(isTimebankChargeableCancellation({ chargeDecision: d, policySnapshot: marked })).toBe(false);
    }
    expect(
      isTimebankChargeableCancellation({ chargeDecision: 'CHARGE', policySnapshot: marked, reinstatedAt: new Date() }),
    ).toBe(false);
  });

  it('reads who cancelled from the rota reason', () => {
    expect(cancelledByPartyFromReason('CLIENT_REQUEST')).toBe('SERVICE_USER');
    expect(cancelledByPartyFromReason('CLIENT_UNAVAILABLE')).toBe('SERVICE_USER');
    expect(cancelledByPartyFromReason('SERVICE_NOT_REQUIRED')).toBe('SERVICE_USER');
    expect(cancelledByPartyFromReason('PROVIDER_UNABLE_TO_STAFF')).toBe('AGENCY');
    expect(cancelledByPartyFromReason('WEATHER_OR_EMERGENCY')).toBe('OTHER');
  });
});
