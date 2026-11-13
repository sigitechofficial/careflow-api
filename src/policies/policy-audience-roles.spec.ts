import { PoliciesService } from './policies.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';

describe('PoliciesService.audienceRoles', () => {
  it('lists active sign-in roles (the ones saving and acknowledgement use), marking those that are not staff', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'r-cqc', name: 'CQC Inspector' },
      { id: 'r-hr', name: 'HR' },
      { id: 'r-ir', name: 'Independent reviewer' },
      { id: 'r-carer', name: 'Carer/Domestic' },
      { id: 'r-sa', name: 'Super Admin' },
    ]);
    const service = new PoliciesService({ role: { findMany } } as unknown as PrismaService, {} as AuditLogsService);

    expect(await service.audienceRoles()).toEqual([
      { id: 'r-cqc', name: 'CQC Inspector', staff: false },
      { id: 'r-hr', name: 'HR', staff: true },
      { id: 'r-ir', name: 'Independent reviewer', staff: false },
      { id: 'r-carer', name: 'Carer/Domestic', staff: true },
      { id: 'r-sa', name: 'Super Admin', staff: false },
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null, isActive: true } }));
  });
});
