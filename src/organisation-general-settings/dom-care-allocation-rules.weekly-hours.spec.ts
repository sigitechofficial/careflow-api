import { parseDomCareAllocationRules, WEEKLY_HOURS_RULE_KEY } from './dom-care-allocation-rules.util';

/** Carer weekly hours settings saved before 30 Oct 2026 are read as the two-choice settings. */
describe('parseDomCareAllocationRules — carer weekly hours', () => {
  const weekly = (row: Record<string, unknown>) =>
    parseDomCareAllocationRules([{ key: WEEKLY_HOURS_RULE_KEY, label: 'x', minutes: 15, ...row }] as never).find(
      (r) => r.key === WEEKLY_HOURS_RULE_KEY,
    )!;

  it('defaults: approval, not over the maximum, called-off counted, contracted change approval, extra hours without', () => {
    const r = parseDomCareAllocationRules(null).find((x) => x.key === WEEKLY_HOURS_RULE_KEY)!;
    expect(r.behavior).toBe('MANAGER_APPROVAL');
    expect(r.minutes).toBe(0);
    expect(r.weeklyHours).toEqual({
      allowOverMax: 'NO',
      countCalledOff: true,
      contractedChangeNeedsApproval: true,
      extraHoursNeedApproval: false,
    });
  });

  it.each([
    ['MANAGER_APPROVAL', 'MANAGER_APPROVAL'],
    ['DONT_ALLOW', 'MANAGER_APPROVAL'],
    ['REQUEST_CONFIRMATION', 'REQUEST_CONFIRMATION'],
    ['ALWAYS_ALLOW', 'MANAGER_APPROVAL'],
  ])('saved behaviour %s is read as %s', (saved, expected) => {
    expect(weekly({ behavior: saved }).behavior).toBe(expected);
  });

  it('old "Yes, with manager approval" over the maximum is read as Yes; grace minutes kept', () => {
    const r = weekly({
      behavior: 'REQUEST_CONFIRMATION',
      weeklyHours: { allowOverMax: 'MANAGER_APPROVAL', rejectAction: 'REMOVE_FROM_PLAN', maxApprovableHours: 48 },
    });
    expect(r.minutes).toBe(15);
    expect(r.weeklyHours).toEqual({
      allowOverMax: 'YES',
      countCalledOff: true,
      contractedChangeNeedsApproval: true,
      extraHoursNeedApproval: false,
    });
  });

  it('keeps the new settings as saved', () => {
    const r = weekly({
      behavior: 'MANAGER_APPROVAL',
      weeklyHours: { allowOverMax: 'YES', countCalledOff: false, contractedChangeNeedsApproval: false, extraHoursNeedApproval: true },
    });
    expect(r.weeklyHours).toEqual({
      allowOverMax: 'YES',
      countCalledOff: false,
      contractedChangeNeedsApproval: false,
      extraHoursNeedApproval: true,
    });
  });
});
