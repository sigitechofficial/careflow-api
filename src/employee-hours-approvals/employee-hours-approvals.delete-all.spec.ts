import { BadRequestException } from '@nestjs/common';
import { EmployeeHoursApprovalStatus } from '@prisma/client';
import { EmployeeHoursApprovalsService } from './employee-hours-approvals.service';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

/** Delete All on the hours approvals page: one status at a time, audited with the deleted ids. */
describe('EmployeeHoursApprovalsService.deleteAll', () => {
  function build(ids: string[]) {
    const tx = {
      employeeHoursApproval: {
        findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
        deleteMany: jest.fn().mockResolvedValue({ count: ids.length }),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (t: typeof tx) => unknown) => work(tx)),
    };
    const audit = { logAudit: jest.fn() };
    const service = new EmployeeHoursApprovalsService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, tx, audit };
  }

  it('deletes the requests with that status and audits their ids in the same transaction', async () => {
    const { service, tx, audit } = build(['a', 'b']);
    await expect(
      service.deleteAll('user', EmployeeHoursApprovalStatus.PENDING),
    ).resolves.toEqual({
      message: '2 requests deleted',
      data: { count: 2 },
    });
    expect(tx.employeeHoursApproval.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
      select: { id: true },
    });
    expect(tx.employeeHoursApproval.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
    });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tx,
        action: AuditAction.EMPLOYEE_HOURS_APPROVALS_DELETED,
        oldValues: { status: 'PENDING', ids: ['a', 'b'] },
      }),
    );
  });

  it('does nothing when there are none', async () => {
    const { service, tx, audit } = build([]);
    await expect(
      service.deleteAll('user', EmployeeHoursApprovalStatus.REJECTED),
    ).resolves.toMatchObject({ data: { count: 0 } });
    expect(tx.employeeHoursApproval.deleteMany).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('refuses an unknown status', async () => {
    const { service } = build([]);
    await expect(
      service.deleteAll('user', 'ALL' as EmployeeHoursApprovalStatus),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
