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
  carerHomeUiStatus,
  isVisitCheckOutEvent,
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

  it('no lead flagged: earliest allocatedAt is lead regardless of row order', () => {
    const first = {
      id: 'alloc-2',
      employeeId: 'first',
      status: 'CONFIRMED',
      isLeadCarer: false,
      allocatedAt: new Date('2026-10-01T09:00:00.000Z'),
    };
    const second = {
      id: 'alloc-1',
      employeeId: 'second',
      status: 'CONFIRMED',
      isLeadCarer: false,
      allocatedAt: new Date('2026-10-01T09:05:00.000Z'),
    };
    // Row order changes after an UPDATE (e.g. clock-in) must not flip the lead.
    expect(resolveLeadEmployeeId(2, [second, first])).toBe('first');
    expect(resolveLeadEmployeeId(2, [first, second])).toBe('first');
    expect(resolveCarerRole('second', 2, [second, first])).toBe('support');
  });

  it('no lead flagged and same allocatedAt: tie-break by allocation id', () => {
    const at = '2026-10-01T09:00:00.000Z';
    const x = { id: 'b-id', employeeId: 'x', status: 'ALLOCATED', allocatedAt: at };
    const y = { id: 'a-id', employeeId: 'y', status: 'ALLOCATED', allocatedAt: at };
    expect(resolveLeadEmployeeId(2, [x, y])).toBe('y');
  });

  it('explicit lead wins over earlier allocatedAt; inactive rows ignored', () => {
    const early = {
      id: '1',
      employeeId: 'early',
      status: 'CONFIRMED',
      isLeadCarer: false,
      allocatedAt: '2026-10-01T08:00:00.000Z',
    };
    const flagged = {
      id: '2',
      employeeId: 'flagged',
      status: 'CONFIRMED',
      isLeadCarer: true,
      allocatedAt: '2026-10-01T09:00:00.000Z',
    };
    const removed = {
      id: '0',
      employeeId: 'removed',
      status: 'UNALLOCATED',
      isLeadCarer: true,
      allocatedAt: '2026-10-01T07:00:00.000Z',
    };
    expect(resolveLeadEmployeeId(2, [early, flagged, removed])).toBe('flagged');
    expect(isLeadCarerOnVisit('early', 2, [early, flagged, removed])).toBe(false);
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

describe('carerHomeUiStatus (support part done)', () => {
  it('support who clocked out is done even while the visit is in progress', () => {
    expect(
      carerHomeUiStatus('in_progress', { role: 'support', myActualEndDateTime: new Date() }),
    ).toBe('completed');
  });
  it('support still on site, lead, and single-carer are unchanged', () => {
    expect(carerHomeUiStatus('in_progress', { role: 'support', myActualEndDateTime: null })).toBe(
      'in_progress',
    );
    expect(carerHomeUiStatus('in_progress', { role: 'lead', myActualEndDateTime: new Date() })).toBe(
      'in_progress',
    );
    expect(carerHomeUiStatus('in_progress', { role: null, myActualEndDateTime: new Date() })).toBe(
      'in_progress',
    );
    expect(carerHomeUiStatus('cancelled', { role: 'support', myActualEndDateTime: new Date() })).toBe(
      'cancelled',
    );
  });
});

describe('isVisitCheckOutEvent (ECM)', () => {
  const out = (employeeId: string) => ({ eventType: 'CHECK_OUT', employeeId });
  it('multi-carer: only the lead check-out counts', () => {
    expect(isVisitCheckOutEvent(out('support'), 'lead')).toBe(false);
    expect(isVisitCheckOutEvent(out('lead'), 'lead')).toBe(true);
    expect(isVisitCheckOutEvent({ eventType: 'CHECK_IN', employeeId: 'lead' }, 'lead')).toBe(false);
  });
  it('single-carer: any check-out counts', () => {
    expect(isVisitCheckOutEvent(out('anyone'), null)).toBe(true);
  });
});
