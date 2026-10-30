import { VisitPlanDateChangesService } from './visit-plan-date-changes.service';

/**
 * Extra visits and the carer's weekly hours: no contracted hours, or above the carer's maximum
 * when "Allow over a carer's maximum weekly hours" is No, is refused; otherwise the carer waits
 * for a manager (approval Yes) or goes on with a warning (approval No).
 */
describe('VisitPlanDateChangesService.carerHoursForExtras — carer weekly hours', () => {
  const visit = {
    date: '2026-11-02',
    start: new Date('2026-11-02T09:00:00.000Z'),
    end: new Date('2026-11-02T11:00:00.000Z'),
  };
  const key = '2026-11-02|emp-1';

  type Helper = (
    employeeIds: string[],
    visits: (typeof visit)[],
    serviceUserId: string,
    excludeAllocationIds?: string[],
    throwOnBlock?: boolean,
  ) => Promise<{
    behavior: string;
    over: Map<string, string>;
    overMax: Map<string, string>;
    overMaxApproval: Map<string, string>;
    waitsForManager: (key: string) => boolean;
  }>;

  function build(
    rule: { behavior: 'MANAGER_APPROVAL' | 'REQUEST_CONFIRMATION'; allowOverMax: 'NO' | 'YES' },
    opts: { overContract?: boolean; overMax?: boolean; noContractedHours?: boolean } = {},
  ) {
    const { overContract = true, overMax = true, noContractedHours = false } = opts;
    const prisma = {
      employeePersonalDetail: { findFirst: jest.fn().mockResolvedValue({ firstName: 'John', lastName: 'Smith' }) },
    };
    const orgSettings = {
      getOperationalDisplaySettings: jest.fn().mockResolvedValue({ dateDisplayFormat: 'DD/MM/YYYY' }),
    };
    const carerHours = {
      rule: jest.fn().mockResolvedValue({ graceMinutes: 0, ...rule }),
      checkNewVisits: jest.fn().mockResolvedValue({
        limitMinutes: noContractedHours ? null : 40 * 60,
        over: overContract && !noContractedHours ? [0] : [],
        maxMinutes: 60 * 60,
        noContractedHours,
        overMax: overMax ? [0] : [],
        weeks: [{ weekStart: '2026-11-02', minutes: 61 * 60, limitMinutes: 40 * 60, extraMinutes: 0 }],
      }),
      weekStartOf: jest.fn().mockResolvedValue('2026-11-02'),
    };
    const service = new VisitPlanDateChangesService(
      prisma as never,
      {} as never,
      orgSettings as never,
      {} as never,
      {} as never,
      carerHours as never,
      {} as never,
    );
    const helper = (
      service as unknown as { carerHoursForExtras: Helper }
    ).carerHoursForExtras.bind(service) as Helper;
    return { helper };
  }

  it('no contracted hours: refused on save, blocked in the preview', async () => {
    const { helper } = build({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'YES' }, { noContractedHours: true });
    await expect(helper(['emp-1'], [visit], 'su-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CARER_NO_CONTRACTED_HOURS', employeeId: 'emp-1' }),
    });
    const preview = await helper(['emp-1'], [visit], 'su-1', [], false);
    expect(preview.overMax.has(key)).toBe(true);
  });

  it("allowOverMax NO: refused on save, blocked in the preview (both approval choices)", async () => {
    for (const behavior of ['MANAGER_APPROVAL', 'REQUEST_CONFIRMATION'] as const) {
      const { helper } = build({ behavior, allowOverMax: 'NO' });
      await expect(helper(['emp-1'], [visit], 'su-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CARER_OVER_MAX_WEEKLY_HOURS' }),
      });
      const preview = await helper(['emp-1'], [visit], 'su-1', [], false);
      expect(preview.overMax.has(key)).toBe(true);
      expect(preview.overMaxApproval.size).toBe(0);
    }
  });

  it('allowOverMax YES + approval: the carer waits for a manager', async () => {
    const { helper } = build({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'YES' });
    const check = await helper(['emp-1'], [visit], 'su-1');
    expect(check.overMax.size).toBe(0);
    expect(check.overMaxApproval.get(key)).toMatch(/so a manager must approve/);
    expect(check.waitsForManager(key)).toBe(true);
  });

  it('allowOverMax YES + no approval: goes on with a warning, nobody waits', async () => {
    const { helper } = build({ behavior: 'REQUEST_CONFIRMATION', allowOverMax: 'YES' });
    const check = await helper(['emp-1'], [visit], 'su-1');
    expect(check.overMax.size).toBe(0);
    expect(check.overMaxApproval.size).toBe(0);
    expect(check.over.get(key)).toMatch(/weekly maximum/);
    expect(check.waitsForManager(key)).toBe(false);
  });

  it('over the contracted hours only: approval waits, no approval warns', async () => {
    const withApproval = await build({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'NO' }, { overMax: false }).helper(
      ['emp-1'],
      [visit],
      'su-1',
    );
    expect(withApproval.waitsForManager(key)).toBe(true);
    const noApproval = await build({ behavior: 'REQUEST_CONFIRMATION', allowOverMax: 'NO' }, { overMax: false }).helper(
      ['emp-1'],
      [visit],
      'su-1',
    );
    expect(noApproval.over.has(key)).toBe(true);
    expect(noApproval.waitsForManager(key)).toBe(false);
  });
});
