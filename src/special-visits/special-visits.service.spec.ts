import { SpecialVisitsService } from './special-visits.service';

/**
 * A special visit and the carer's weekly hours (Settings → Dom Rules "Carer weekly hours limit"):
 * no contracted hours or above the carer's maximum (not allowed) is refused; otherwise it waits
 * for a manager (approval Yes) or the carer goes on with a warning (approval No).
 */
describe('SpecialVisitsService.create — carer weekly hours', () => {
  const dto = {
    employeeId: 'emp-1',
    serviceUserId: 'su-1',
    title: 'Hospital visit',
    startDateTime: '2026-11-02T09:00:00.000Z',
    endDateTime: '2026-11-02T11:00:00.000Z',
  };

  function build(
    rule: { behavior: 'MANAGER_APPROVAL' | 'REQUEST_CONFIRMATION'; allowOverMax: 'NO' | 'YES' },
    opts: { overMax?: boolean; noContractedHours?: boolean } = {},
  ) {
    const { overMax = true, noContractedHours = false } = opts;
    const tx = {
      scheduledJob: { create: jest.fn().mockResolvedValue({ id: 'job-1' }) },
      jobAllocation: { create: jest.fn() },
    };
    const prisma = {
      employee: { findFirst: jest.fn().mockResolvedValue({ id: 'emp-1' }) },
      serviceUser: { findFirst: jest.fn().mockResolvedValue({ id: 'su-1' }) },
      scheduleBatch: { findFirst: jest.fn().mockResolvedValue({ id: 'batch-1' }) },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const weeklyHours = { checkSpecialVisit: jest.fn().mockResolvedValue(null) };
    const carerHours = {
      rule: jest.fn().mockResolvedValue({ graceMinutes: 0, ...rule }),
      checkNewVisits: jest.fn().mockResolvedValue({
        limitMinutes: noContractedHours ? null : 40 * 60,
        over: noContractedHours ? [] : [0],
        maxMinutes: 60 * 60,
        noContractedHours,
        overMax: overMax ? [0] : [],
        weeks: [{ weekStart: '2026-11-02', minutes: 61 * 60, limitMinutes: 40 * 60, extraMinutes: 0 }],
      }),
      requestRotaVisitApproval: jest.fn().mockResolvedValue({ id: 'req-1' }),
      weekStartOf: jest.fn().mockResolvedValue('2026-11-02'),
    };
    const service = new SpecialVisitsService(prisma as never, weeklyHours as never, carerHours as never);
    return { service, tx, carerHours };
  }

  it('no contracted hours: refused with a code the admin opens a dialog for', async () => {
    const { service, tx } = build({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'YES' }, { noContractedHours: true });
    await expect(service.create('user-1', dto as never)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CARER_NO_CONTRACTED_HOURS', employeeId: 'emp-1' }),
    });
    expect(tx.scheduledJob.create).not.toHaveBeenCalled();
  });

  it("allowOverMax NO: refused above the carer's maximum (both approval choices)", async () => {
    for (const behavior of ['MANAGER_APPROVAL', 'REQUEST_CONFIRMATION'] as const) {
      const { service, tx } = build({ behavior, allowOverMax: 'NO' });
      await expect(service.create('user-1', dto as never)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'CARER_OVER_MAX_WEEKLY_HOURS' }),
      });
      expect(tx.scheduledJob.create).not.toHaveBeenCalled();
    }
  });

  it('allowOverMax YES + approval: created without the carer and sent to a manager', async () => {
    const { service, tx, carerHours } = build({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'YES' });
    const result = await service.create('user-1', dto as never);
    expect(tx.scheduledJob.create.mock.calls[0][0].data.status).toBe('UNALLOCATED');
    expect(tx.jobAllocation.create).not.toHaveBeenCalled();
    expect(carerHours.requestRotaVisitApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ employeeId: 'emp-1', scheduledJobId: 'job-1', source: 'SPECIAL_VISIT', weekMinutes: 61 * 60 }),
    );
    expect(result.data.carerHoursApprovalRequested).toMatch(/so a manager must approve/);
  });

  it('allowOverMax YES + no approval: the carer goes on with a warning', async () => {
    const { service, tx, carerHours } = build({ behavior: 'REQUEST_CONFIRMATION', allowOverMax: 'YES' });
    const result = await service.create('user-1', dto as never);
    expect(tx.jobAllocation.create).toHaveBeenCalled();
    expect(carerHours.requestRotaVisitApproval).not.toHaveBeenCalled();
    expect(result.data.carerHoursWarning).toMatch(/weekly maximum/);
  });

  it('under the maximum + approval: waits for a manager', async () => {
    const { service, carerHours } = build({ behavior: 'MANAGER_APPROVAL', allowOverMax: 'NO' }, { overMax: false });
    await service.create('user-1', dto as never);
    expect(carerHours.requestRotaVisitApproval).toHaveBeenCalled();
  });

  it('under the maximum + no approval: the carer goes on to be confirmed, with a warning', async () => {
    const { service, tx, carerHours } = build({ behavior: 'REQUEST_CONFIRMATION', allowOverMax: 'NO' }, { overMax: false });
    const result = await service.create('user-1', dto as never);
    expect(tx.jobAllocation.create.mock.calls[0][0].data.status).toBe('PENDING_CONFIRMATION');
    expect(carerHours.requestRotaVisitApproval).not.toHaveBeenCalled();
    expect(result.data.carerHoursWarning).toMatch(/contracted weekly hours/);
  });
});
