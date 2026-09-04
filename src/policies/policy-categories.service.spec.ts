import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyCategoriesService } from './policy-categories.service';

describe('PolicyCategoriesService', () => {
  const category = {
    id: 'cat-1',
    name: 'Safeguarding',
    code: 'SAFEGUARDING',
    description: null,
    displayOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('creates a category and writes an audit event', async () => {
    const prisma = {
      policyCategory: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(category),
      },
    } as unknown as PrismaService;
    const audit = { logAudit: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogsService;
    const service = new PolicyCategoriesService(prisma, audit);

    const created = await service.create('user-1', { name: 'Safeguarding', code: 'SAFEGUARDING' });
    expect(created.code).toBe('SAFEGUARDING');
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'policy_category_created', module: 'POLICY' }),
    );
  });

  it('rejects duplicate codes', async () => {
    const prisma = {
      policyCategory: { findFirst: jest.fn().mockResolvedValue(category) },
    } as unknown as PrismaService;
    const service = new PolicyCategoriesService(prisma, {
      logAudit: jest.fn(),
    } as unknown as AuditLogsService);
    await expect(service.create('user-1', { name: 'Safeguarding', code: 'SAFEGUARDING' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('blocks delete when the category is still assigned', async () => {
    const prisma = {
      policyCategory: {
        findFirst: jest.fn().mockResolvedValue(category),
      },
      policyDocument: { count: jest.fn().mockResolvedValue(2) },
    } as unknown as PrismaService;
    const service = new PolicyCategoriesService(prisma, {
      logAudit: jest.fn(),
    } as unknown as AuditLogsService);
    await expect(service.softDelete('cat-1', 'user-1')).rejects.toThrow(BadRequestException);
  });
});
