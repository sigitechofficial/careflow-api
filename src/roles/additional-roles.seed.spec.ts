import {
  ACCOUNTANT_KEYS,
  ensureAdditionalRoles,
  isExcludedFromRegisteredManager,
  registeredManagerKeys,
} from '../../prisma/seeds/additional-roles.seed';

describe('Registered Manager permissions', () => {
  it('drops system setup, payroll, billing control and record deletes from Manager', () => {
    for (const key of [
      'roles.manage',
      'permissions.manage',
      'settings.company.update',
      'payroll.runs.read',
      'payroll.runs.manage',
      'billing.invoice_runs.manage',
      'service_users.documents.delete',
      'audit_logs.delete',
    ]) {
      expect(isExcludedFromRegisteredManager(key)).toBe(true);
    }
  });

  it('keeps day-to-day Manager work, billing read and un-allocating carers', () => {
    const keys = registeredManagerKeys([
      'service_users.read',
      'billing.invoice_runs.read',
      'job_allocations.delete',
      'payroll.runs.manage',
      'roles.manage',
    ]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'service_users.read',
        'billing.invoice_runs.read',
        'job_allocations.delete',
      ]),
    );
    expect(keys).not.toContain('payroll.runs.manage');
    expect(keys).not.toContain('roles.manage');
  });

  it('adds training, policy approval, compliance verification and safeguarding', () => {
    const keys = registeredManagerKeys([]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'learning.assignments.manage',
        'policies.approve',
        'employees.compliance.verify',
        'incidents.view_highly_confidential',
      ]),
    );
  });
});

describe('Accountant permissions', () => {
  it('is read-only finance with no clinical or management keys', () => {
    expect(ACCOUNTANT_KEYS.some((k) => k.endsWith('.manage'))).toBe(false);
    expect(
      ACCOUNTANT_KEYS.some((k) => /medic|care_plan|incidents|body_map/.test(k)),
    ).toBe(false);
    expect(ACCOUNTANT_KEYS).toEqual(
      expect.arrayContaining([
        'billing.invoice_runs.read',
        'payroll.runs.read',
      ]),
    );
  });
});

describe('ensureAdditionalRoles', () => {
  const makePrisma = (existingRoles: string[]) => {
    const created: { name: string; perms: number }[] = [];
    const prisma = {
      rolePermission: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ permission: { key: 'service_users.read' } }]),
      },
      role: {
        findFirst: jest.fn(({ where }: { where: { name: string } }) =>
          Promise.resolve(
            existingRoles.includes(where.name) ? { id: 'x' } : null,
          ),
        ),
      },
      permission: {
        findMany: jest.fn(({ where }: { where: { key: { in: string[] } } }) =>
          Promise.resolve(where.key.in.map((key, i) => ({ id: `p${i}`, key }))),
        ),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
        let name = '';
        await fn({
          role: {
            create: jest.fn(({ data }: { data: { name: string } }) => {
              name = data.name;
              return Promise.resolve({ id: 'r1' });
            }),
          },
          rolePermission: {
            createMany: jest.fn(({ data }: { data: unknown[] }) => {
              created.push({ name, perms: data.length });
              return Promise.resolve({ count: data.length });
            }),
          },
        });
      }),
    };
    return { prisma, created };
  };

  beforeEach(() =>
    jest.spyOn(console, 'log').mockImplementation(() => undefined),
  );
  afterEach(() => jest.restoreAllMocks());

  it('creates both roles with their permissions when missing', async () => {
    const { prisma, created } = makePrisma([]);
    await ensureAdditionalRoles(prisma as never);
    expect(created.map((c) => c.name)).toEqual([
      'Registered Manager',
      'Accountant',
    ]);
    expect(created[1].perms).toBe(ACCOUNTANT_KEYS.length);
  });

  it('never touches a role that already exists (office edits are kept)', async () => {
    const { prisma, created } = makePrisma([
      'Registered Manager',
      'Accountant',
    ]);
    await ensureAdditionalRoles(prisma as never);
    expect(created).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
