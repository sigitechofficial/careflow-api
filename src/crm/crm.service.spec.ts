import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CrmService } from './crm.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { OrgScopeService } from '../common/org-scope/org-scope.service';

function row(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'e1',
    referenceNumber: 'ENQ-2026-0001',
    stage: 'CONTACTED',
    firstName: 'Jo',
    lastName: 'Bloggs',
    dateOfBirth: null,
    contactName: null,
    contactRelationship: null,
    contactPhone: null,
    contactEmail: null,
    source: 'GP',
    sourceDetail: null,
    enquiryType: null,
    urgency: 'ROUTINE',
    needs: null,
    carePlanFormIds: [],
    ownerId: null,
    locationId: null,
    assessorId: null,
    lostReasonCode: null,
    lostReason: null,
    convertedServiceUserId: null,
    recordedById: 'u1',
    stageChangedAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    events: [],
    ...overrides,
  };
}

/** Super Admin style: no branch restriction. */
const admin: any = { id: 'u1', roles: ['Super Admin'], permissions: [], assignedLocationIds: null };
/** Branch-restricted user. */
const branchUser: any = { id: 'u2', roles: ['Manager'], permissions: [], assignedLocationIds: ['loc-a'] };

describe('CrmService', () => {
  let service: CrmService;
  const audit = { logAudit: jest.fn() };

  const prisma: any = {
    enquiry: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    user: { findMany: jest.fn() },
    serviceUserFundingType: { findMany: jest.fn() },
    location: { findMany: jest.fn() },
    carePathwayForm: { findMany: jest.fn() },
    serviceUser: { findFirst: jest.fn(), findMany: jest.fn() },
    enquiryNumberSequence: { upsert: jest.fn() },
    enquiryEvent: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.serviceUserFundingType.findMany.mockResolvedValue([]);
    prisma.location.findMany.mockResolvedValue([]);
    prisma.carePathwayForm.findMany.mockResolvedValue([]);
    prisma.enquiry.findMany.mockResolvedValue([]);
    prisma.serviceUser.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
    const moduleRef = await Test.createTestingModule({
      providers: [
        CrmService,
        OrgScopeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(CrmService);
  });

  /* ─── stage moves ─── */

  it('rejects a LOST move without a reason code', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row());
    await expect(service.move(admin, 'e1', { stage: 'LOST' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.enquiry.update).not.toHaveBeenCalled();
  });

  it('requires details when the lost reason is OTHER', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row());
    await expect(
      service.move(admin, 'e1', { stage: 'LOST', lostReasonCode: 'OTHER' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores the lost reason code and labels the timeline note', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row());
    prisma.enquiry.update.mockResolvedValue(row({ stage: 'LOST', lostReasonCode: 'PRICE' }));
    await service.move(admin, 'e1', { stage: 'LOST', lostReasonCode: 'PRICE' } as any);
    const data = prisma.enquiry.update.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({ stage: 'LOST', lostReasonCode: 'PRICE' }));
    expect(data.events.create.note).toBe('Price / cost');
  });

  it('moves between open stages and to WON', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row({ stage: 'OFFER' }));
    prisma.enquiry.update.mockResolvedValue(row({ stage: 'WON' }));
    await service.move(admin, 'e1', { stage: 'WON' } as any);
    expect(prisma.enquiry.update.mock.calls[0][0].data.stage).toBe('WON');
  });

  /* ─── update events ─── */

  it('stores care requirements and funding on update', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row());
    prisma.enquiry.update.mockResolvedValue(row({ hoursPerWeek: 14 }));
    await service.update(admin, 'e1', { hoursPerWeek: 14, fundingTypeId: 'ft-1' } as any);
    const call = prisma.enquiry.update.mock.calls[0][0];
    expect(call.data).toEqual(expect.objectContaining({ hoursPerWeek: 14, fundingTypeId: 'ft-1' }));
    expect(call.data.events.create).toEqual([expect.objectContaining({ action: 'Details updated' })]);
  });

  it('stores the chosen care plans and returns their names', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row());
    prisma.enquiry.update.mockResolvedValue(row({ carePlanFormIds: ['cp-1', 'cp-gone'] }));
    prisma.carePathwayForm.findMany.mockResolvedValue([{ id: 'cp-1', name: 'Mobility' }]);
    const res = await service.update(admin, 'e1', { carePlanFormIds: ['cp-1', 'cp-gone'] } as any);
    const call = prisma.enquiry.update.mock.calls[0][0];
    expect(call.data.carePlanFormIds).toEqual(['cp-1', 'cp-gone']);
    expect(call.data.events.create).toEqual([expect.objectContaining({ action: 'Details updated' })]);
    // A care plan that no longer exists is left out of the named list.
    expect(res.data.carePlans).toEqual([{ id: 'cp-1', name: 'Mobility' }]);
  });

  it('treats the same care plans in another order as no change', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row({ carePlanFormIds: ['cp-1', 'cp-2'] }));
    prisma.enquiry.update.mockResolvedValue(row({ carePlanFormIds: ['cp-2', 'cp-1'] }));
    await service.update(admin, 'e1', { carePlanFormIds: ['cp-2', 'cp-1'] } as any);
    const call = prisma.enquiry.update.mock.calls[0]?.[0];
    expect(call?.data?.events?.create ?? []).toEqual([]);
  });

  it('writes an "Assigned to" event when the owner changes', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row({ ownerId: null }));
    prisma.user.findMany.mockResolvedValue([{ id: 'owner-1', firstName: 'Ayesha', lastName: 'Khan' }]);
    prisma.enquiry.update.mockResolvedValue(row({ ownerId: 'owner-1' }));
    await service.update(admin, 'e1', { ownerId: 'owner-1' } as any);
    const events = prisma.enquiry.update.mock.calls[0][0].data.events.create;
    expect(events).toEqual([expect.objectContaining({ action: 'Assigned to Ayesha Khan' })]);
  });

  it('writes "Assessment booked" and "Quote recorded" events', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row());
    prisma.enquiry.update.mockResolvedValue(row());
    await service.update(admin, 'e1', {
      assessmentAt: '2026-11-02T10:00:00.000Z',
      assessmentLocation: 'Home',
      quoteWeeklyAmount: 420,
    } as any);
    const events = prisma.enquiry.update.mock.calls[0][0].data.events.create;
    expect(events).toEqual([
      expect.objectContaining({ action: 'Assessment booked' }),
      expect.objectContaining({ action: 'Quote recorded', note: '£420.00/week' }),
    ]);
  });

  it('writes no event when nothing changed', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row({ firstName: 'Jo' }));
    prisma.enquiry.update.mockResolvedValue(row());
    await service.update(admin, 'e1', { firstName: 'Jo' } as any);
    expect(prisma.enquiry.update.mock.calls[0][0].data.events).toBeUndefined();
  });

  /* ─── branch scoping ─── */

  it('limits a branch user to their branches plus enquiries they recorded', async () => {
    await service.list(branchUser, {} as any);
    const where = prisma.enquiry.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"locationId":{"in":["loc-a"]}');
    expect(JSON.stringify(where)).toContain('"recordedById":"u2"');
  });

  it('does not restrict a company-wide user', async () => {
    await service.list(admin, {} as any);
    const where = prisma.enquiry.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('locationId');
  });

  it('returns not found for an enquiry outside the branch scope', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(null);
    await expect(service.getById(branchUser, 'e9')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('defaults a new enquiry to the user\'s only branch', async () => {
    prisma.enquiryNumberSequence.upsert.mockResolvedValue({ lastValue: 9 });
    prisma.enquiry.create = jest.fn().mockResolvedValue(row({ locationId: 'loc-a' }));
    await service.create(branchUser, { firstName: 'A', lastName: 'B' } as any);
    expect(prisma.enquiry.create.mock.calls[0][0].data.locationId).toBe('loc-a');
  });

  it('rejects a branch the user cannot access', async () => {
    await expect(
      service.create(branchUser, { firstName: 'A', lastName: 'B', locationId: 'loc-z' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires the branch that received the enquiry', async () => {
    await expect(service.create(admin, { firstName: 'A', lastName: 'B' } as any)).rejects.toThrow(
      'Choose the branch that received this enquiry',
    );
    await expect(service.update(admin, 'e1', { locationId: null } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  /* ─── link + duplicates ─── */

  it('links the created service user and marks the enquiry Won', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row({ stage: 'OFFER' }));
    prisma.serviceUser.findFirst.mockResolvedValue({ firstName: 'Jo', lastName: 'Bloggs' });
    prisma.enquiry.update.mockResolvedValue(row({ stage: 'WON', convertedServiceUserId: 'su-1' }));
    await service.linkServiceUser(admin, 'e1', { serviceUserId: 'su-1' });
    expect(prisma.enquiry.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ convertedServiceUserId: 'su-1', stage: 'WON' }),
    );
  });

  it('refuses to relink an enquiry to a different service user', async () => {
    prisma.enquiry.findFirst.mockResolvedValue(row({ convertedServiceUserId: 'su-old' }));
    prisma.serviceUser.findFirst.mockResolvedValue({ firstName: 'Jo', lastName: 'Bloggs' });
    await expect(
      service.linkServiceUser(admin, 'e1', { serviceUserId: 'su-new' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('finds duplicates by name + date of birth and by phone, ignoring a different DOB', async () => {
    prisma.enquiry.findMany.mockResolvedValue([
      { id: 'a', referenceNumber: 'ENQ-1', firstName: 'Jo', lastName: 'Bloggs', stage: 'NEW', dateOfBirth: new Date('1940-05-02'), contactPhone: null },
      { id: 'b', referenceNumber: 'ENQ-2', firstName: 'Jo', lastName: 'Bloggs', stage: 'NEW', dateOfBirth: new Date('1950-01-01'), contactPhone: null },
    ]);
    prisma.serviceUser.findMany.mockResolvedValue([
      { id: 's1', firstName: 'Other', lastName: 'Person', dateOfBirth: null, phone: '07700 900 123', mobile: null },
    ]);
    const res = await service.duplicates(admin, {
      firstName: 'jo', lastName: 'BLOGGS', dateOfBirth: '1940-05-02', phone: '07700900123',
    });
    expect(res.data.enquiries.map(e => e.id)).toEqual(['a']);
    expect(res.data.serviceUsers.map(s => s.id)).toEqual(['s1']);
  });

  it('counts only open, overdue follow-ups as due', async () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    prisma.enquiry.findMany.mockResolvedValue([
      { stage: 'CONTACTED', nextFollowUpAt: past, lostReasonCode: null },
      { stage: 'ASSESSMENT', nextFollowUpAt: future, lostReasonCode: null },
      { stage: 'WON', nextFollowUpAt: past, lostReasonCode: null },
      { stage: 'LOST', nextFollowUpAt: null, lostReasonCode: 'PRICE' },
    ]);
    const res = await service.summary(admin);
    expect(res.data.followUpsDue).toBe(1);
    expect(res.data.lostByReason).toEqual({ PRICE: 1 });
  });
});
