import { employeeAppUnableToStartReasons } from './employee-app-unable-to-start.util';
import {
  allocationPresenceView,
  isLeadCarerOnVisit,
  isMultiCarerVisit,
  mapTwoPersonTaskFlags,
  readCoCarerPresenceMap,
  readEmployeeAppMeta,
  resolveCarerRole,
  resolveLeadEmployeeId,
  buildSupportClockedOutBeforeLeadComplete,
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

  it('builds supportClockedOutBeforeLeadComplete when support left and lead has not', () => {
    const block = buildSupportClockedOutBeforeLeadComplete({
      requiredCarers: 2,
      visitStatus: 'STARTED',
      viewingEmployeeId: 'lead-1',
      allocations: [
        {
          employeeId: 'lead-1',
          status: 'CONFIRMED',
          isLeadCarer: true,
          actualStartDateTime: '2026-08-10T10:00:00.000Z',
          actualEndDateTime: null,
          employee: { personalDetail: { firstName: 'Jane', lastName: 'Lead' } },
        },
        {
          employeeId: 'support-1',
          status: 'CONFIRMED',
          isLeadCarer: false,
          actualStartDateTime: '2026-08-10T10:05:00.000Z',
          actualEndDateTime: '2026-08-10T10:45:00.000Z',
          employee: { personalDetail: { firstName: 'Sam', lastName: 'Support' } },
        },
      ],
    });
    expect(block?.occurred).toBe(true);
    expect(block?.carers).toHaveLength(1);
    expect(block?.carers[0].name).toBe('Sam Support');
    expect(block?.carers[0].isYou).toBe(false);
    expect(block?.visitRemainsOpenForLead).toBe(true);
  });

  it('unable-to-start catalogue still available for lead path', () => {
    expect(employeeAppUnableToStartReasons().length).toBeGreaterThan(0);
  });

  it('maps partner presence with marker name for admin workspace', () => {
    const ea = readEmployeeAppMeta({
      employeeApp: {
        coCarerPresence: {
          'support-1': {
            present: true,
            arrivedAt: '2026-09-16T09:08:00.000Z',
            leftAt: null,
            markedByEmployeeId: 'lead-1',
            updatedAt: '2026-09-16T09:08:01.000Z',
          },
        },
      },
    });
    const map = readCoCarerPresenceMap(ea);
    expect(allocationPresenceView('support-1', map, { 'lead-1': 'Ali Khan' })).toEqual({
      present: true,
      arrivedAt: '2026-09-16T09:08:00.000Z',
      leftAt: null,
      markedByEmployeeId: 'lead-1',
      markedByName: 'Ali Khan',
      updatedAt: '2026-09-16T09:08:01.000Z',
    });
    expect(allocationPresenceView('lead-1', map, { 'lead-1': 'Ali Khan' })).toBeNull();
  });
});
