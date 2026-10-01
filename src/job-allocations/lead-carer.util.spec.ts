import {
  clockedInRemovalBlockMessage,
  compareByAssignedOrder,
  fullVisitMessage,
  pickPromotedLead,
  planLeadChangePushes,
  visitAssignPushBody,
  sortByAssignedOrder,
  teamCompositionError,
} from './lead-carer.util';

describe('lead-carer.util', () => {
  describe('assigned order', () => {
    it('orders by allocatedAt then id', () => {
      const rows = [
        { id: 'c', allocatedAt: '2026-10-01T10:00:00.000Z' },
        { id: 'b', allocatedAt: '2026-10-01T09:00:00.000Z' },
        { id: 'a', allocatedAt: '2026-10-01T10:00:00.000Z' },
      ];
      expect(sortByAssignedOrder(rows).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    });

    it('accepts Date and string and puts missing timestamps last', () => {
      const rows = [
        { id: 'x', allocatedAt: null },
        { id: 'y', allocatedAt: new Date('2026-10-01T08:00:00.000Z') },
      ];
      expect(sortByAssignedOrder(rows).map((r) => r.id)).toEqual(['y', 'x']);
      expect(compareByAssignedOrder(rows[1]!, rows[0]!)).toBeLessThan(0);
    });

    it('does not mutate the input', () => {
      const rows = [
        { id: 'b', allocatedAt: '2026-10-01T10:00:00.000Z' },
        { id: 'a', allocatedAt: '2026-10-01T09:00:00.000Z' },
      ];
      sortByAssignedOrder(rows);
      expect(rows[0]!.id).toBe('b');
    });
  });

  describe('pickPromotedLead', () => {
    it('promotes the earliest-assigned remaining carer', () => {
      const remaining = [
        { id: '2', employeeId: 'liam', allocatedAt: '2026-10-01T09:05:00.000Z' },
        { id: '1', employeeId: 'ava', allocatedAt: '2026-10-01T09:00:00.000Z' },
      ];
      expect(pickPromotedLead(remaining)?.employeeId).toBe('ava');
    });

    it('tie-breaks by allocation id', () => {
      const at = '2026-10-01T09:00:00.000Z';
      const remaining = [
        { id: 'bbb', employeeId: 'b', allocatedAt: at },
        { id: 'aaa', employeeId: 'a', allocatedAt: at },
      ];
      expect(pickPromotedLead(remaining)?.employeeId).toBe('a');
    });

    it('returns null when nobody remains', () => {
      expect(pickPromotedLead([])).toBeNull();
    });
  });

  describe('teamCompositionError', () => {
    const base = { existingEmployeeIds: [] as string[] };

    it('accepts a full double with a lead', () => {
      expect(
        teamCompositionError({
          ...base,
          requiredCarers: 2,
          newEmployeeIds: ['a', 'b'],
          leadEmployeeId: 'b',
        }),
      ).toBeNull();
    });

    it('accepts a full triple with a lead', () => {
      expect(
        teamCompositionError({
          ...base,
          requiredCarers: 3,
          newEmployeeIds: ['a', 'b', 'c'],
          leadEmployeeId: 'a',
        }),
      ).toBeNull();
    });

    it('rejects single-carer visits', () => {
      expect(
        teamCompositionError({
          ...base,
          requiredCarers: 1,
          newEmployeeIds: ['a'],
          leadEmployeeId: 'a',
        }),
      ).toMatch(/2 or more carers/);
    });

    it('rejects the wrong number of carers on a new visit', () => {
      expect(
        teamCompositionError({
          ...base,
          requiredCarers: 3,
          newEmployeeIds: ['a', 'b'],
          leadEmployeeId: 'a',
        }),
      ).toBe('This visit needs 3 carers — 2 selected.');
    });

    it('rejects a missing lead', () => {
      expect(
        teamCompositionError({
          ...base,
          requiredCarers: 2,
          newEmployeeIds: ['a', 'b'],
          leadEmployeeId: '',
        }),
      ).toBe('Choose a lead carer.');
    });

    it('rejects a lead outside the team', () => {
      expect(
        teamCompositionError({
          ...base,
          requiredCarers: 2,
          newEmployeeIds: ['a', 'b'],
          leadEmployeeId: 'z',
        }),
      ).toMatch(/must be one of the carers/);
    });

    it('rejects duplicates and carers already on the visit', () => {
      expect(
        teamCompositionError({
          ...base,
          requiredCarers: 2,
          newEmployeeIds: ['a', 'a'],
          leadEmployeeId: 'a',
        }),
      ).toMatch(/only be selected once/);
      expect(
        teamCompositionError({
          requiredCarers: 3,
          existingEmployeeIds: ['a'],
          newEmployeeIds: ['a', 'b'],
          leadEmployeeId: 'a',
        }),
      ).toMatch(/already assigned/);
    });

    it('gap fill: only the missing carers, lead may be an existing carer', () => {
      expect(
        teamCompositionError({
          requiredCarers: 3,
          existingEmployeeIds: ['a'],
          newEmployeeIds: ['b', 'c'],
          leadEmployeeId: 'a',
        }),
      ).toBeNull();
      expect(
        teamCompositionError({
          requiredCarers: 3,
          existingEmployeeIds: ['a'],
          newEmployeeIds: ['b'],
          leadEmployeeId: 'a',
        }),
      ).toBe('This visit needs 2 more carers — 1 selected.');
    });

    it('rejects when the visit is already full', () => {
      expect(
        teamCompositionError({
          requiredCarers: 2,
          existingEmployeeIds: ['a', 'b'],
          newEmployeeIds: ['c'],
          leadEmployeeId: 'a',
        }),
      ).toMatch(/already has 2 carers/);
    });
  });
});

describe('lead-carer.util missing timestamps', () => {
  it('falls back to id order when both timestamps are missing', () => {
    const rows = [
      { id: 'b', allocatedAt: null },
      { id: 'a', allocatedAt: undefined },
    ];
    expect(sortByAssignedOrder(rows).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('planLeadChangePushes', () => {
  it('no push when the lead did not change or there was no lead before', () => {
    expect(
      planLeadChangePushes({
        previousLeadEmployeeId: 'a',
        currentLeadEmployeeId: 'a',
        activeEmployeeIds: ['a', 'b'],
      }),
    ).toEqual({ newLeadEmployeeId: null, informEmployeeIds: [] });
    expect(
      planLeadChangePushes({
        previousLeadEmployeeId: null,
        currentLeadEmployeeId: 'a',
        activeEmployeeIds: ['a', 'b'],
        newlyAssignedEmployeeIds: ['a', 'b'],
      }),
    ).toEqual({ newLeadEmployeeId: null, informEmployeeIds: [] });
  });

  it('set lead on a triple: new lead + previous lead + third carer', () => {
    expect(
      planLeadChangePushes({
        previousLeadEmployeeId: 'a',
        currentLeadEmployeeId: 'b',
        activeEmployeeIds: ['a', 'b', 'c'],
      }),
    ).toEqual({ newLeadEmployeeId: 'b', informEmployeeIds: ['a', 'c'] });
  });

  it('lead removed and auto-promoted: promoted carer + others', () => {
    expect(
      planLeadChangePushes({
        previousLeadEmployeeId: 'a',
        currentLeadEmployeeId: 'b',
        activeEmployeeIds: ['b', 'c'],
      }),
    ).toEqual({ newLeadEmployeeId: 'b', informEmployeeIds: ['c'] });
  });

  it('replace / drag of the lead: new carer only gets the assign push', () => {
    expect(
      planLeadChangePushes({
        previousLeadEmployeeId: 'a',
        currentLeadEmployeeId: 'n',
        activeEmployeeIds: ['b', 'n'],
        newlyAssignedEmployeeIds: ['n'],
      }),
    ).toEqual({ newLeadEmployeeId: null, informEmployeeIds: ['b'] });
  });

  it('gap fill switching lead to an existing carer skips the new carers', () => {
    expect(
      planLeadChangePushes({
        previousLeadEmployeeId: 'a',
        currentLeadEmployeeId: 'b',
        activeEmployeeIds: ['a', 'b', 'n'],
        newlyAssignedEmployeeIds: ['n'],
      }),
    ).toEqual({ newLeadEmployeeId: 'b', informEmployeeIds: ['a'] });
  });
});

describe('visitAssignPushBody', () => {
  it('adds the role on multi-carer visits only', () => {
    expect(visitAssignPushBody('Morning', ' (09:00–10:00)', 'lead')).toBe(
      'You have been allocated to "Morning" (09:00–10:00) — you are Lead.',
    );
    expect(visitAssignPushBody('Morning', '', 'support')).toBe(
      'You have been allocated to "Morning" — you are Support.',
    );
    expect(visitAssignPushBody('Morning', ' (09:00–10:00)', null)).toBe(
      'You have been allocated to "Morning" (09:00–10:00).',
    );
  });
});

describe('fullVisitMessage (single allocate cap)', () => {
  it('allows while places are free and blocks when full', () => {
    expect(fullVisitMessage(0, 2)).toBeNull();
    expect(fullVisitMessage(1, 2)).toBeNull();
    expect(fullVisitMessage(2, 2)).toBe(
      'This visit already has 2 of 2 carers assigned. Remove or change a carer before adding another.',
    );
    expect(fullVisitMessage(1, 1)).toMatch(/1 of 1 carer assigned/);
  });
});

describe('clockedInRemovalBlockMessage', () => {
  const base = { carerName: 'Amina Yusuf', jobStatus: 'IN_PROGRESS' };
  it('blocks a carer clocked in on an open visit', () => {
    expect(
      clockedInRemovalBlockMessage({ ...base, actualStartDateTime: new Date(), actualEndDateTime: null }),
    ).toBe("Amina Yusuf is clocked in on this visit and can't be removed. Ask them to clock out first.");
  });
  it('allows removal before clock-in, after clock-out, or once the visit is closed', () => {
    expect(clockedInRemovalBlockMessage({ ...base, actualStartDateTime: null })).toBeNull();
    expect(
      clockedInRemovalBlockMessage({
        ...base,
        actualStartDateTime: new Date(),
        actualEndDateTime: new Date(),
      }),
    ).toBeNull();
    expect(
      clockedInRemovalBlockMessage({
        ...base,
        jobStatus: 'COMPLETED',
        actualStartDateTime: new Date(),
      }),
    ).toBeNull();
  });
});
