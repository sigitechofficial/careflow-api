import { VisitPlanDateChangesService } from './visit-plan-date-changes.service';

/**
 * A longer extra visit that puts both a carer and the service user over their weekly hours: the
 * carer is approved first, then the service user. Approving the service user replays the edit
 * with the carers already approved, so it is made (no new carer request, no loop).
 */
describe('VisitPlanDateChangesService.createHeldServiceUserVisit — longer extra visit', () => {
  function build() {
    const prisma = { scheduledJob: { findFirst: jest.fn().mockResolvedValue({ id: 'job-1' }) } };
    const service = new VisitPlanDateChangesService(
      prisma as never,
      ...(Array.from({ length: 12 }, () => ({}) as never) as []),
    );
    const edit = jest.spyOn(service, 'editExtraVisit').mockResolvedValue({} as never);
    return { service, edit };
  }

  const dto = { startTime: '14:00', durationMinutes: 45, requiredCarers: 1, employeeIds: ['emp-1'], reason: 'r' };

  it('passes the carers approved earlier for the edit, with the service user approved', async () => {
    const { service, edit } = build();
    const res = await service.createHeldServiceUserVisit('user-1', 'su-1', 'plan-1', {
      kind: 'EXTRA_EDIT',
      pendingEdit: { planId: 'plan-1', exceptionId: 'ex-1', dto, approvedEmployeeIds: ['emp-1'] },
    });
    expect(edit).toHaveBeenCalledWith(
      { id: 'user-1' },
      'su-1',
      'plan-1',
      'ex-1',
      dto,
      undefined,
      ['emp-1'],
      true,
    );
    expect(res).toEqual({ scheduledJobId: 'job-1' });
  });

  it('a request saved before this change (no approved carers) still replays as before', async () => {
    const { service, edit } = build();
    await service.createHeldServiceUserVisit('user-1', 'su-1', 'plan-1', {
      kind: 'EXTRA_EDIT',
      pendingEdit: { planId: 'plan-1', exceptionId: 'ex-1', dto },
    });
    expect(edit.mock.calls[0]?.[6]).toEqual([]);
    expect(edit.mock.calls[0]?.[7]).toBe(true);
  });
});
