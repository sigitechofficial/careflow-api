import { slaTargetsForCriticality } from './ecm-sla.util';

describe('ecm-sla.util', () => {
  it('returns standard SLA', () => {
    expect(slaTargetsForCriticality('STANDARD')).toEqual({
      responseTargetMinutes: 10,
      escalationMinutes: 20,
    });
  });

  it('returns priority SLA', () => {
    expect(slaTargetsForCriticality('PRIORITY').responseTargetMinutes).toBe(5);
  });

  it('returns immediate for time-critical', () => {
    expect(slaTargetsForCriticality('TIME_CRITICAL')).toEqual({
      responseTargetMinutes: 0,
      escalationMinutes: 0,
    });
  });
});
