import { BadRequestException } from '@nestjs/common';
import { EmployeeHoursApprovalStatus } from '@prisma/client';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';
import {
  runInRequestContext,
  trackHoursRequest,
  trackedHoursRequests,
} from '../common/request-context/super-admin-context';

/** "Approve now": a manager approves requests they just sent, each as on Hours approvals. */
describe('EmployeeHoursApprovalsService.approveOwn', () => {
  function build(own: string[], statusNow: Record<string, EmployeeHoursApprovalStatus> = {}) {
    const prisma = {
      employeeHoursApproval: {
        findMany: jest.fn().mockResolvedValue(own.map((id) => ({ id }))),
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ status: statusNow[where.id] ?? EmployeeHoursApprovalStatus.PENDING }),
        ),
      },
    };
    const audit = { logAudit: jest.fn() };
    const hook = { dismissWaiting: jest.fn() };
    const service = new EmployeeHoursApprovalsService(
      prisma as never,
      audit as never,
      {} as never,
      hook as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const approve = jest.spyOn(service, 'approve');
    return { service, prisma, audit, hook, approve };
  }

  it('only looks at the pending requests this user sent', async () => {
    const { service, prisma, approve } = build([]);
    approve.mockResolvedValue({ message: 'ok' } as never);
    await expect(service.approveOwn('me', ['a', 'b'])).resolves.toEqual({
      message: 'Nothing left to approve — already decided on Hours approvals',
      data: { results: [] },
    });
    expect(prisma.employeeHoursApproval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['a', 'b'] }, requestedById: 'me', status: EmployeeHoursApprovalStatus.PENDING },
      }),
    );
    expect(approve).not.toHaveBeenCalled();
  });

  it('approves each, notes the optional reason, audits it and clears the waiting notifications', async () => {
    const { service, audit, hook, approve } = build(['a', 'b']);
    approve.mockResolvedValue({ message: 'Approved' } as never);
    const res = await service.approveOwn('me', ['a', 'b'], '  short staffed ');
    expect(approve).toHaveBeenCalledWith('me', 'a', 'Approved when sent: short staffed', undefined);
    expect(approve).toHaveBeenCalledWith('me', 'b', 'Approved when sent: short staffed', undefined);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EMPLOYEE_HOURS_APPROVED_BY_REQUESTER,
        recordId: 'a',
        newValues: { status: 'APPROVED', approvedWhenSent: true, reason: 'short staffed' },
      }),
    );
    expect(hook.dismissWaiting).toHaveBeenCalledWith(['a', 'b'], expect.any(Date));
    expect(res.message).toBe('2 requests approved');
  });

  it('without a reason the note just says it was approved when sent', async () => {
    const { service, approve } = build(['a']);
    approve.mockResolvedValue({ message: 'Approved' } as never);
    await service.approveOwn('me', ['a']);
    expect(approve).toHaveBeenCalledWith('me', 'a', 'Approved when sent', undefined);
  });

  it('keeps a request it could not approve on Hours approvals (and its notification)', async () => {
    const { service, hook, approve } = build(['a', 'b']);
    approve
      .mockRejectedValueOnce(new BadRequestException('This request has expired'))
      .mockResolvedValueOnce({ message: 'Approved' } as never);
    const res = await service.approveOwn('me', ['a', 'b']);
    expect(res.data.results).toEqual([
      { id: 'a', approved: false, message: 'This request has expired' },
      { id: 'b', approved: true, message: 'Approved' },
    ]);
    expect(hook.dismissWaiting).toHaveBeenCalledWith(['b'], expect.any(Date));
    expect(res.message).toBe('1 approved, 1 could not be approved — see Hours approvals');
  });

  it('skips a request an earlier approval already settled', async () => {
    const { service, approve } = build(['a', 'b'], { b: EmployeeHoursApprovalStatus.APPROVED });
    approve.mockResolvedValue({ message: 'Approved' } as never);
    const res = await service.approveOwn('me', ['a', 'b']);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(res.data.results.map((r) => r.approved)).toEqual([true, true]);
  });
});

describe('trackHoursRequest', () => {
  it('collects the requests sent during one request only', () => {
    trackHoursRequest('outside');
    expect(trackedHoursRequests()).toEqual([]);
    runInRequestContext(null, null, () => {
      trackHoursRequest('a');
      trackHoursRequest('a');
      trackHoursRequest('b');
      expect(trackedHoursRequests()).toEqual(['a', 'b']);
    });
  });
});
