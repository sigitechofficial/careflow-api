import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  SafeguardingService,
  checkScore,
  safeguardingAlerts,
  safeguardingChecks,
} from './safeguarding.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';

const admin: any = { id: 'u1', roles: ['Super Admin'], permissions: [], assignedLocationIds: null };
const branchUser: any = { id: 'u3', roles: ['Manager'], permissions: [], assignedLocationIds: ['loc-a'] };

function baseRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'sg1',
    referenceNumber: 'SG-2026-0001',
    status: 'INVESTIGATING',
    category: 'NEGLECT',
    riskLevel: 'MEDIUM',
    aboutServiceUserId: null,
    personDescription: null,
    locationId: null,
    handlerEmployeeId: null,
    leadUserId: null,
    raisedByRole: null,
    raisedAt: now,
    description: 'x',
    immediateAction: null,
    laReferral: 'MADE',
    laReference: null,
    laReferredAt: null,
    cqcNotified: 'MADE',
    cqcReference: null,
    outcome: null,
    lessonsLearned: null,
    closedAt: null,
    reviewDate: null,
    reportedToManagerAt: null,
    personSafe: null,
    safetyMeasures: null,
    personWords: null,
    evidence: null,
    personWants: null,
    capacity: null,
    agencies: [],
    agenciesOther: null,
    meetingHeld: null,
    meetingDate: null,
    protectionPlan: null,
    recordedById: 'u1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    events: [],
    ...overrides,
  } as any;
}

describe('SafeguardingService', () => {
  let service: SafeguardingService;
  const audit = { logAudit: jest.fn() };

  const prisma: any = {
    serviceUser: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    location: { findMany: jest.fn() },
    safeguardingCase: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    safeguardingNumberSequence: { upsert: jest.fn() },
    safeguardingEvent: { create: jest.fn() },
    safeguardingInvestigation: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
    prisma.user.findMany.mockResolvedValue([]);
    prisma.serviceUser.findMany.mockResolvedValue([]);
    prisma.location.findMany.mockResolvedValue([]);
    prisma.safeguardingCase.findMany.mockResolvedValue([]);
    prisma.safeguardingInvestigation.findUnique.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        SafeguardingService,
        OrgScopeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(SafeguardingService);
  });

  /* ─── workflow (unchanged behaviour) ─── */

  it('rejects an illegal transition (SCREEN on a CLOSED case)', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow({ status: 'CLOSED' }));
    await expect(service.transition(admin, 'sg1', { action: 'SCREEN' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.safeguardingCase.update).not.toHaveBeenCalled();
  });

  it('blocks CLOSE until an outcome is recorded', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow({ outcome: null }));
    await expect(service.transition(admin, 'sg1', { action: 'CLOSE' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.safeguardingCase.update).not.toHaveBeenCalled();
  });

  it('blocks CLOSE while a referral decision is still PENDING', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow({ laReferral: 'PENDING' }));
    await expect(
      service.transition(admin, 'sg1', { action: 'CLOSE', outcome: 'Resolved' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.safeguardingCase.update).not.toHaveBeenCalled();
  });

  it('closes a case when outcome and referral decisions are set', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow());
    prisma.safeguardingCase.update.mockResolvedValue(
      baseRow({ status: 'CLOSED', outcome: 'Resolved', closedAt: new Date() }),
    );
    await service.transition(admin, 'sg1', { action: 'CLOSE', outcome: 'Resolved' });
    expect(prisma.safeguardingCase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sg1' },
        data: expect.objectContaining({ status: 'CLOSED', outcome: 'Resolved' }),
      }),
    );
  });

  it('blocks CLOSE while a started investigation is not completed', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow());
    prisma.safeguardingInvestigation.findUnique.mockResolvedValue({ investigationStatus: 'IN_PROGRESS' });
    await expect(
      service.transition(admin, 'sg1', { action: 'CLOSE', outcome: 'Resolved' }),
    ).rejects.toThrow('Complete the investigation before closing the case');
    expect(prisma.safeguardingCase.update).not.toHaveBeenCalled();
  });

  it('closes a case whose investigation is completed', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow());
    prisma.safeguardingInvestigation.findUnique.mockResolvedValue({ investigationStatus: 'COMPLETED' });
    prisma.safeguardingCase.update.mockResolvedValue(baseRow({ status: 'CLOSED', outcome: 'Resolved' }));
    await service.transition(admin, 'sg1', { action: 'CLOSE', outcome: 'Resolved' });
    expect(prisma.safeguardingCase.update).toHaveBeenCalled();
  });

  it('screens a raised case (RAISED -> SCREENING)', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow({ status: 'RAISED' }));
    prisma.safeguardingCase.update.mockResolvedValue(baseRow({ status: 'SCREENING' }));
    await service.transition(admin, 'sg1', { action: 'SCREEN' });
    expect(prisma.safeguardingCase.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SCREENING' }) }),
    );
  });

  /* ─── branch scoping ─── */

  it('limits a branch user to their branches plus cases they recorded', async () => {
    await service.list(branchUser, {});
    const where = prisma.safeguardingCase.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"locationId":{"in":["loc-a"]}');
    expect(JSON.stringify(where)).toContain('"recordedById":"u3"');
  });

  it('does not filter a company-wide user without a header branch', async () => {
    await service.list(admin, {});
    const where = JSON.stringify(prisma.safeguardingCase.findMany.mock.calls[0][0].where);
    expect(where).not.toContain('locationId');
    expect(where).not.toContain('recordedById');
  });

  it('returns not found for a case outside the scope', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(null);
    await expect(service.getById(branchUser, 'sg9')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a concern about a service user takes their branch', async () => {
    prisma.serviceUser.findFirst.mockResolvedValue({ id: 'su-1', locationId: 'loc-b' });
    prisma.safeguardingNumberSequence.upsert.mockResolvedValue({ lastValue: 7 });
    prisma.safeguardingCase.create.mockResolvedValue(baseRow({ locationId: 'loc-b' }));
    await service.create(admin, { category: 'NEGLECT', description: 'x', aboutServiceUserId: 'su-1' } as any);
    expect(prisma.safeguardingCase.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ locationId: 'loc-b' }) }),
    );
  });

  /* ─── alerts & records checklist ─── */

  it('flags pending decisions, missing lead and missing review date on an open case', () => {
    const alerts = safeguardingAlerts(baseRow({ laReferral: 'PENDING', cqcNotified: 'PENDING' }));
    expect(alerts.map(a => a.text)).toEqual([
      'Local Authority referral decision pending',
      'CQC notification decision pending',
      'No case lead allocated',
      'No review date set',
    ]);
  });

  it('flags an overdue review', () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const alerts = safeguardingAlerts(baseRow({ leadUserId: 'u1', reviewDate: past }));
    expect(alerts).toEqual([{ text: 'Review date has passed', tone: 'warn' }]);
  });

  it('scores a complete open record at 100%', () => {
    const raisedAt = new Date();
    const row = baseRow({
      personDescription: 'A.B.',
      raisedByRole: 'Care worker',
      raisedAt,
      laReferredAt: raisedAt,
      laReference: 'LA-1',
      cqcReference: 'CQC-1',
      leadUserId: 'u1',
      personSafe: 'YES',
      safetyMeasures: 'Moved to a safe room',
      personWants: 'To stay at home',
      capacity: 'YES',
      reviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(checkScore(safeguardingChecks(row))).toEqual({ passed: 10, of: 10, pct: 100 });
  });

  it('fails the prompt-referral check when the LA referral was made days later', () => {
    const raisedAt = new Date('2026-10-01T10:00:00Z');
    const checks = safeguardingChecks(baseRow({ raisedAt, laReferredAt: new Date('2026-10-05T10:00:00Z') }));
    expect(checks.find(c => c.key === 'laPrompt')?.ok).toBe(false);
  });

  it('summary counts open-case gaps and collects alerts', async () => {
    prisma.safeguardingCase.findMany.mockResolvedValue([
      baseRow({ id: 'a', riskLevel: 'HIGH', laReferral: 'PENDING' }),
      baseRow({ id: 'b', status: 'CLOSED', outcome: 'Done', lessonsLearned: 'Train staff', leadUserId: 'u1' }),
    ]);
    const res = await service.summary(admin);
    expect(res.data).toEqual(
      expect.objectContaining({ total: 2, open: 1, highRisk: 1, laPending: 1, cqcPending: 0, noLead: 1 }),
    );
    expect(res.data.alerts.map(a => a.caseId)).toEqual(['a', 'a', 'a']);
  });

  it('records which sections changed on the timeline', async () => {
    prisma.safeguardingCase.findFirst.mockResolvedValue(baseRow());
    prisma.safeguardingCase.update.mockResolvedValue(baseRow());
    await service.update(admin, 'sg1', { personWants: 'Stay home', capacity: 'YES', agencies: ['Police', 'GP'] } as any);
    const data = prisma.safeguardingCase.update.mock.calls[0][0].data;
    expect(data.agencies).toEqual(['Police', 'GP']);
    expect(data.events.create).toEqual([
      expect.objectContaining({ action: 'Details updated', note: 'Voice of the person, Multi-agency' }),
    ]);
  });
});
