import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SpecialistPathwaysService, riskLevel, sanitizePlanContent } from './specialist-pathways.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';

const admin: any = { id: 'user-1', roles: ['Super Admin'], permissions: [], assignedLocationIds: null };
const admin2: any = { id: 'user-2', roles: ['Super Admin'], permissions: [], assignedLocationIds: null };
const branchUser: any = { id: 'user-3', roles: ['Manager'], permissions: [], assignedLocationIds: ['loc-a'] };
const noBranchUser: any = { id: 'user-4', roles: ['Manager'], permissions: [], assignedLocationIds: [] };

function fullCase(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'c1',
    serviceUserId: 'su-1',
    pathwayType: 'DEMENTIA',
    ref: 'DEM-2026001',
    status: 'ACTIVE',
    reviewDueDate: null,
    sections: {},
    closedReason: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    serviceUser: { id: 'su-1', firstName: 'Ann', lastName: 'Lee' },
    plans: [],
    risks: [],
    reviews: [],
    events: [],
    professionals: [],
    documents: [],
    ...overrides,
  };
}

describe('SpecialistPathwaysService', () => {
  let service: SpecialistPathwaysService;
  const audit = { logAudit: jest.fn() };

  // tx === prisma: the $transaction callback receives the same mock object.
  const prisma: any = {
    serviceUser: { findFirst: jest.fn() },
    user: { findMany: jest.fn() },
    specialistPathwayCase: {
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    specialistPathwayCarePlan: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    specialistPathwayRisk: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    specialistPathwayReview: { create: jest.fn() },
    specialistPathwayEvent: { create: jest.fn() },
    specialistPathwayProfessional: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    specialistPathwayDocument: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.specialistPathwayCase.findFirst.mockResolvedValue(fullCase());
    prisma.specialistPathwayCase.findFirstOrThrow.mockResolvedValue(fullCase());
    prisma.specialistPathwayCase.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));

    const moduleRef = await Test.createTestingModule({
      providers: [
        SpecialistPathwaysService,
        OrgScopeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(SpecialistPathwaysService);
  });

  /* ─── approvals (unchanged behaviour) ─── */

  it('forbids the submitter from approving their own care plan', async () => {
    prisma.specialistPathwayCarePlan.findFirst.mockResolvedValue({
      id: 'p1', caseId: 'c1', status: 'SUBMITTED', submittedById: 'user-1', deletedAt: null,
    });
    await expect(service.decidePlan(admin, 'c1', 'p1', { decision: 'APPROVE' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.specialistPathwayCarePlan.update).not.toHaveBeenCalled();
  });

  it('lets a different user approve, superseding the prior approved plan, and logs an event', async () => {
    prisma.specialistPathwayCarePlan.findFirst.mockResolvedValue({
      id: 'p2', caseId: 'c1', version: 2, status: 'SUBMITTED', submittedById: 'user-1', deletedAt: null,
    });
    prisma.specialistPathwayCarePlan.update.mockResolvedValue({
      id: 'p2', caseId: 'c1', version: 2, status: 'APPROVED', content: {}, comment: null,
      submittedById: 'user-1', submittedAt: new Date(), decidedById: 'user-2', decidedAt: new Date(),
      createdById: 'user-1', createdAt: new Date(), updatedAt: new Date(),
    });
    await service.decidePlan(admin2, 'c1', 'p2', { decision: 'APPROVE' });
    expect(prisma.specialistPathwayCarePlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'SUPERSEDED' } }),
    );
    expect(prisma.specialistPathwayEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'Care plan v2 approved' }) }),
    );
  });

  it('new draft copies the latest version content when none is supplied', async () => {
    prisma.specialistPathwayCarePlan.findFirst.mockResolvedValue({ version: 2, content: { summary: 'Keep me' } });
    prisma.specialistPathwayCarePlan.create.mockResolvedValue({
      id: 'p3', caseId: 'c1', version: 3, status: 'DRAFT', content: { summary: 'Keep me' }, comment: null,
      submittedById: null, submittedAt: null, decidedById: null, decidedAt: null,
      createdById: 'user-1', createdAt: new Date(), updatedAt: new Date(),
    });
    await service.createPlan(admin, 'c1', {});
    expect(prisma.specialistPathwayCarePlan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 3, content: { summary: 'Keep me' } }) }),
    );
  });

  /* ─── care-plan content ─── */

  it('sanitizes structured plan content and drops empty need rows', () => {
    const out = sanitizePlanContent({
      summary: '  Hello ',
      needs: [{ area: 'Mobility', need: 'Falls', outcome: 'Stay safe', support: 'Frame', whoHelps: 'Carer', frequency: 'Daily' }, {}],
      consent: { agreed: true, agreedBy: 'Ann' },
      junk: 'x',
    }) as any;
    expect(out.summary).toBe('Hello');
    expect(out.needs).toHaveLength(1);
    expect(out.consent).toEqual(expect.objectContaining({ agreed: true, agreedBy: 'Ann' }));
    expect(out.junk).toBeUndefined();
  });

  /* ─── branch scoping ─── */

  it('scopes a branch user through the service user relation', async () => {
    await service.list(branchUser, {} as any);
    const where = JSON.stringify(prisma.specialistPathwayCase.findMany.mock.calls[0][0].where);
    expect(where).toContain('"serviceUser"');
    expect(where).toContain('"loc-a"');
  });

  it('returns nothing for a user with no branches (filter on the case, not the relation)', async () => {
    await service.list(noBranchUser, {} as any);
    const where = prisma.specialistPathwayCase.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('{"id":{"in":[]}}');
    expect(JSON.stringify(where)).not.toContain('"serviceUser"');
  });

  it('returns not found for a case outside the scope', async () => {
    prisma.specialistPathwayCase.findFirst.mockResolvedValue(null);
    await expect(service.getById(branchUser, 'c9')).rejects.toBeInstanceOf(NotFoundException);
  });

  /* ─── risks ─── */

  it('scores risks into bands', () => {
    expect(riskLevel(4)).toBe('LOW');
    expect(riskLevel(5)).toBe('MEDIUM');
    expect(riskLevel(12)).toBe('HIGH');
    expect(riskLevel(20)).toBe('VERY_HIGH');
  });

  it('adds a risk and writes a timeline event with the score', async () => {
    prisma.specialistPathwayRisk.create.mockResolvedValue({ id: 'r1', title: 'Wandering', likelihood: 5, impact: 4 });
    await service.addRisk(admin, 'c1', { title: 'Wandering', likelihood: 5, impact: 4 } as any);
    expect(prisma.specialistPathwayEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'Risk added: Wandering', note: 'Score 20 (very high)' }),
      }),
    );
  });

  /* ─── reviews / close / reopen ─── */

  it('a review sets the next review date', async () => {
    await service.addReview(admin, 'c1', {
      reviewedAt: '2026-10-21', outcome: 'NO_CHANGE', nextReviewDate: '2027-01-21',
    } as any);
    const data = prisma.specialistPathwayCase.update.mock.calls[0][0].data;
    expect(data.reviewDueDate).toEqual(new Date('2027-01-21'));
    expect(data.status).toBeUndefined();
  });

  it('a CASE_CLOSED review closes the case', async () => {
    await service.addReview(admin, 'c1', { reviewedAt: '2026-10-21', outcome: 'CASE_CLOSED', notes: 'Moved away' } as any);
    const data = prisma.specialistPathwayCase.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ status: 'CLOSED', closedReason: 'Moved away' }));
  });

  it('closing requires a reason', async () => {
    await expect(service.close(admin, 'c1', { reason: '  ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reopen clears the closed reason', async () => {
    prisma.specialistPathwayCase.findFirst.mockResolvedValue(fullCase({ status: 'CLOSED', closedReason: 'x' }));
    await service.reopen(admin, 'c1');
    expect(prisma.specialistPathwayCase.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'ACTIVE', closedReason: null }),
    );
  });

  /* ─── summary ─── */

  it('summarises open cases, overdue reviews, plans awaiting approval and very-high risks', async () => {
    const past = new Date(Date.now() - 86_400_000);
    prisma.specialistPathwayCase.findMany.mockResolvedValue([
      { pathwayType: 'DEMENTIA', status: 'ACTIVE', reviewDueDate: past, plans: [{ status: 'SUBMITTED' }], risks: [{ likelihood: 5, impact: 4 }] },
      { pathwayType: 'DEMENTIA', status: 'CLOSED', reviewDueDate: past, plans: [], risks: [] },
    ]);
    const res = await service.summary(admin);
    expect(res.data.byPathway.DEMENTIA).toEqual({
      open: 1, closed: 1, reviewsOverdue: 1, plansAwaitingApproval: 1, highRisks: 1,
    });
  });

  /* ─── professionals & documents ─── */

  it('adds a professional and writes a timeline event', async () => {
    prisma.specialistPathwayProfessional.create.mockResolvedValue({
      id: 'pr1', name: 'Dr Khan', role: 'GP', organisation: 'High St Surgery',
    });
    await service.addProfessional(admin, 'c1', { name: ' Dr Khan ', role: 'GP', organisation: 'High St Surgery' });
    expect(prisma.specialistPathwayProfessional.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ caseId: 'c1', name: 'Dr Khan', role: 'GP' }) }),
    );
    expect(prisma.specialistPathwayEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'Professional added: Dr Khan (GP)' }) }),
    );
  });

  it('removing a professional soft-deletes it', async () => {
    prisma.specialistPathwayProfessional.findFirst.mockResolvedValue({ id: 'pr1', name: 'Dr Khan', role: 'GP' });
    await service.removeProfessional(admin, 'c1', 'pr1');
    expect(prisma.specialistPathwayProfessional.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pr1' }, data: { deletedAt: expect.any(Date) } }),
    );
  });

  it('rejects an upload with no accepted file', async () => {
    await expect(service.addDocument(admin, 'c1', undefined, { title: 'DNACPR' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.specialistPathwayDocument.create).not.toHaveBeenCalled();
  });

  it('rejects a file whose content does not match its type and deletes it from disk', async () => {
    const path = join(tmpdir(), `pathway-doc-${Date.now()}.pdf`);
    writeFileSync(path, 'not really a pdf');
    const file = { path, mimetype: 'application/pdf', filename: 'x.pdf', originalname: 'x.pdf', size: 16 } as any;
    await expect(service.addDocument(admin, 'c1', file, { title: 'DNACPR' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(existsSync(path)).toBe(false);
    expect(prisma.specialistPathwayDocument.create).not.toHaveBeenCalled();
  });

  it('does not serve a document from a case outside the scope', async () => {
    prisma.specialistPathwayCase.findFirst.mockResolvedValue(null);
    await expect(service.getDocumentForDownload(branchUser, 'c9', 'd1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.specialistPathwayDocument.findFirst).not.toHaveBeenCalled();
  });
});
