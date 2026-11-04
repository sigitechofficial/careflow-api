import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OnCallCallStatus, OnCallTier } from '@prisma/client';
import {
  locationScopeWhere,
  OnCallService,
  validateShiftWindow,
} from './on-call.service';

describe('validateShiftWindow', () => {
  const at = (iso: string) => new Date(iso);

  it('accepts an evening-to-morning shift', () => {
    expect(() =>
      validateShiftWindow(
        at('2026-10-24T16:00:00Z'),
        at('2026-10-25T08:00:00Z'),
      ),
    ).not.toThrow();
  });

  it('rejects a shift that ends before or when it starts', () => {
    expect(() =>
      validateShiftWindow(
        at('2026-10-24T16:00:00Z'),
        at('2026-10-24T16:00:00Z'),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateShiftWindow(
        at('2026-10-24T16:00:00Z'),
        at('2026-10-24T15:00:00Z'),
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a shift longer than 96 hours', () => {
    expect(() =>
      validateShiftWindow(
        at('2026-10-20T00:00:00Z'),
        at('2026-10-24T00:00:01Z'),
      ),
    ).toThrow(BadRequestException);
  });
});

describe('locationScopeWhere', () => {
  it('no limit for users who see every branch', () => {
    expect(locationScopeWhere(null)).toBeUndefined();
  });

  it('branch users see their branches and rows covering every branch', () => {
    expect(locationScopeWhere(['b1'])).toEqual({
      OR: [{ locationId: null }, { locationId: { in: ['b1'] } }],
    });
  });
});

describe('OnCallService rules', () => {
  const companyUser = { id: 'u1', roles: ['Super Admin'] } as never;
  const branchUser = {
    id: 'u2',
    roles: ['Care Coordinator'],
    assignedLocationIds: ['b1'],
  } as never;

  function make(overrides: Record<string, unknown> = {}) {
    const prisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue({ id: 'e1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      location: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      serviceUser: {
        findFirst: jest.fn().mockResolvedValue({ id: 's1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      onCallShift: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: 'sh1',
          employeeId: 'e1',
          locationId: null,
          tier: OnCallTier.FIRST_LINE,
        }),
      },
      onCallCall: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      ...overrides,
    };
    const audit = { logAudit: jest.fn() };
    const orgScope = {
      fromRequestUser: (u: {
        roles: string[];
        assignedLocationIds?: string[];
      }) => ({
        companyWide: u.roles.includes('Super Admin'),
        locationIds: u.assignedLocationIds ?? null,
      }),
    };
    return {
      service: new OnCallService(
        prisma as never,
        audit as never,
        orgScope as never,
      ),
      prisma,
      audit,
    };
  }

  const shift = {
    employeeId: 'e1',
    tier: OnCallTier.FIRST_LINE,
    startsAt: '2026-10-24T16:00:00Z',
    endsAt: '2026-10-25T08:00:00Z',
  };

  it('creates a shift and writes an audit entry', async () => {
    const { service, prisma, audit } = make();
    await service.createShift(companyUser, shift, {} as never);
    expect(prisma.onCallShift.create).toHaveBeenCalled();
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'on_call_shift_created' }),
    );
  });

  it('refuses a shift that overlaps the same person’s other shift', async () => {
    const { service, prisma } = make();
    prisma.onCallShift.findFirst.mockResolvedValue({ id: 'other' });
    await expect(
      service.createShift(companyUser, shift, {} as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.onCallShift.create).not.toHaveBeenCalled();
  });

  it('a branch user must pick one of their own branches', async () => {
    const { service } = make();
    await expect(
      service.createShift(branchUser, shift, {} as never),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.createShift(
        branchUser,
        { ...shift, locationId: 'b9' },
        {} as never,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('a closed call cannot be closed again or changed', async () => {
    const { service, prisma } = make();
    prisma.onCallCall.findFirst.mockResolvedValue({
      id: 'c1',
      status: OnCallCallStatus.CLOSED,
      locationId: null,
    });
    await expect(
      service.closeCall(
        companyUser,
        'c1',
        { closingNote: 'done' },
        {} as never,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateCall(companyUser, 'c1', { summary: 'x y z' }, {} as never),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.onCallCall.update).not.toHaveBeenCalled();
  });

  it('a call cannot be logged in the future', async () => {
    const { service } = make();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    await expect(
      service.createCall(
        companyUser,
        {
          receivedAt: future,
          callerType: 'CARER',
          callerName: 'A',
          category: 'OTHER',
          summary: 'test call',
        } as never,
        {} as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
