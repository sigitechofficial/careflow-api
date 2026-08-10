import { employeeAppUnableToStartReasons } from './employee-app-unable-to-start.util';
import {
  isLeadCarerOnVisit,
  isMultiCarerVisit,
  mapTwoPersonTaskFlags,
  resolveCarerRole,
  resolveLeadEmployeeId,
} from './employee-app-multi-carer.util';

describe('employee-app-multi-carer.util', () => {
  const lead = {
    employeeId: 'lead-1',
    status: 'ALLOCATED',
    isLeadCarer: true,
  };
  const support = {
    employeeId: 'support-1',
    status: 'ALLOCATED',
    isLeadCarer: false,
  };

  it('treats single allocation + requiredCarers 1 as not multi-carer', () => {
    expect(isMultiCarerVisit(1, [lead])).toBe(false);
    expect(resolveCarerRole('lead-1', 1, [lead])).toBeNull();
    expect(isLeadCarerOnVisit('lead-1', 1, [lead])).toBe(true);
  });

  it('resolves lead/support on double-up', () => {
    expect(isMultiCarerVisit(2, [lead, support])).toBe(true);
    expect(resolveLeadEmployeeId(2, [lead, support])).toBe('lead-1');
    expect(resolveCarerRole('lead-1', 2, [lead, support])).toBe('lead');
    expect(resolveCarerRole('support-1', 2, [lead, support])).toBe('support');
    expect(isLeadCarerOnVisit('support-1', 2, [lead, support])).toBe(false);
  });

  it('falls back to first active as lead when none flagged', () => {
    const a = { employeeId: 'a', status: 'CONFIRMED', isLeadCarer: false };
    const b = { employeeId: 'b', status: 'CONFIRMED', isLeadCarer: false };
    expect(resolveLeadEmployeeId(2, [a, b])).toBe('a');
    expect(resolveCarerRole('b', 2, [a, b])).toBe('support');
  });

  it('maps twoPerson from requiresMultipleCarers', () => {
    expect(mapTwoPersonTaskFlags(false)).toEqual({
      twoPerson: false,
      requiresSupport: false,
      requiredForRoles: null,
    });
    expect(mapTwoPersonTaskFlags(true).twoPerson).toBe(true);
    expect(mapTwoPersonTaskFlags(true).requiresSupport).toBe(true);
    expect(mapTwoPersonTaskFlags(true).requiredForRoles).toEqual(['lead', 'support']);
  });

  it('unable-to-start catalogue still available for lead path', () => {
    expect(employeeAppUnableToStartReasons().length).toBeGreaterThan(0);
  });
});
