/**
 * Enquiry quotations against the isolated local test database (same harness as the payroll
 * integration tests: `node scripts/payroll-test-db.mjs`, database name must end in _payroll_test).
 * Real CrmService + QuotationsService + OrgScopeService; mail and visit-plan creation are stubbed.
 */
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createAuditSpy, createTestPrisma } from './harness';
import { CrmService } from '../../src/crm/crm.service';
import { OrgScopeService } from '../../src/common/org-scope/org-scope.service';
import { QuotationsService } from '../../src/crm/quotations/quotations.service';
import type { QuoteDraftDto } from '../../src/crm/quotations/dto/quotation.dto';

const prisma = createTestPrisma();
const audit = createAuditSpy();
const orgScope = new OrgScopeService(prisma);
const crm = new CrmService(prisma, audit.service as never, orgScope);
const mailState = { mode: 'log', fail: false };
const mail = {
  isConfigured: () => true,
  send: jest.fn(async () => {
    if (mailState.fail) throw new Error('SMTP down');
    return { messageId: 'msg-1', mode: 'smtp' };
  }),
};
const config = { get: (key: string, fallback?: unknown) => (key === 'mail.mode' ? mailState.mode : fallback) };
const createdPlans: Array<{ serviceUserId: string; dto: any }> = [];
const visitPlans = {
  create: jest.fn(async (_userId: string, serviceUserId: string, dto: any) => {
    createdPlans.push({ serviceUserId, dto });
    const plan = await prisma.serviceUserVisitPlan.create({
      data: { serviceUserId, status: 'DRAFT', weeklyContractedHours: dto.weeklyContractedHours, notes: dto.notes },
    });
    return { message: 'Visit plan created', data: { id: plan.id } };
  }),
};
const service = new QuotationsService(
  prisma,
  audit.service as never,
  orgScope,
  crm,
  mail as never,
  config as never,
  { getOperationalTimezone: async () => 'Europe/London' } as never,
  visitPlans as never,
);

const tag = randomUUID().slice(0, 8);
const admin: any = { id: randomUUID(), roles: ['Super Admin'], permissions: [], assignedLocationIds: null };
let branchA: string;
let branchB: string;
let branchUser: any;
const enquiries: string[] = [];
const serviceUsers: string[] = [];
let cardId: string;
let sundayOnlyCardId: string;

const draft = (over: Partial<QuoteDraftDto> = {}): QuoteDraftDto => ({
  proposedStartDate: '2027-01-04',
  validUntil: '2027-12-31',
  internalNotes: 'INTERNAL: client can afford more',
  clientNotes: 'We look forward to supporting you.',
  patterns: [
    { label: 'Morning call', startTime: '08:00', endTime: '09:00', durationMinutes: 60, daysOfWeek: [1, 2, 3, 4, 5], frequency: 'WEEKLY', carersPerVisit: 1 },
    { label: 'Weekend double-up', startTime: '18:00', endTime: '18:30', durationMinutes: 30, daysOfWeek: [6], frequency: 'WEEKLY', carersPerVisit: 2 },
  ],
  ...over,
});

async function newEnquiry(stage: 'CONTACTED' | 'OFFER' = 'CONTACTED', locationId: string | null = null) {
  const e = await prisma.enquiry.create({
    data: {
      referenceNumber: `ENQ-T-${tag}-${enquiries.length}`,
      firstName: 'Quote',
      lastName: `Test${enquiries.length}`,
      stage,
      locationId,
      contactEmail: 'family@example.test',
      contactName: 'Daughter',
      recordedById: admin.id,
    },
  });
  enquiries.push(e.id);
  return e;
}

const key = () => randomUUID();

beforeAll(async () => {
  branchA = (await prisma.location.create({ data: { name: `Quote branch A ${tag}` } })).id;
  branchB = (await prisma.location.create({ data: { name: `Quote branch B ${tag}` } })).id;
  branchUser = { id: randomUUID(), roles: ['Manager'], permissions: [], assignedLocationIds: [branchA] };
  const card = await prisma.chargeCard.create({
    data: {
      name: `Quote card ${tag}`,
      code: `QT-${tag}`,
      assignmentLevel: 'BRANCH_REGION',
      assignmentTargetId: branchA,
      status: 'ACTIVE',
      effectiveFrom: new Date('2020-01-01'),
      taxTreatment: 'VAT exempt',
      rules: {
        create: [
          { label: 'Weekday', dayType: 'WEEKDAY', rateType: 'HOURLY', chargeMethod: 'HOURLY_PRO_RATA', amount: 30 },
          { label: 'Saturday', dayType: 'SATURDAY', rateType: 'HOURLY', chargeMethod: 'HOURLY_PRO_RATA', amount: 36, sortOrder: 1 },
          { label: 'Sunday', dayType: 'SUNDAY', rateType: 'HOURLY', chargeMethod: 'HOURLY_PRO_RATA', amount: 36, sortOrder: 2 },
        ],
      },
    },
  });
  cardId = card.id;
  sundayOnlyCardId = (
    await prisma.chargeCard.create({
      data: {
        name: `Sunday-only ${tag}`,
        code: `QT-SUN-${tag}`,
        status: 'ACTIVE',
        effectiveFrom: new Date('2020-01-01'),
        rules: { create: [{ dayType: 'SUNDAY', rateType: 'HOURLY', chargeMethod: 'HOURLY_PRO_RATA', amount: 36 }] },
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { id: { in: enquiries } } });
  await prisma.serviceUserVisitPlan.deleteMany({ where: { serviceUserId: { in: serviceUsers } } });
  await prisma.serviceUser.deleteMany({ where: { id: { in: serviceUsers } } });
  await prisma.chargeCard.deleteMany({ where: { id: { in: [cardId, sundayOnlyCardId] } } });
  await prisma.location.deleteMany({ where: { id: { in: [branchA, branchB] } } });
  await prisma.$disconnect();
});

describe('enquiry quotations (database)', () => {
  it('A: a draft is priced from the branch charge card and does not change the stage', async () => {
    const e = await newEnquiry('CONTACTED');
    const { data } = await service.create(admin, e.id, draft({ locationId: branchA }));
    expect(data.status).toBe('DRAFT');
    expect(data.quotationNumber).toMatch(/^EQ-\d{4}-\d{4}$/);
    expect(data.label).toBe(`${data.quotationNumber} V1`);
    // 5 × £30 weekday + 1 Saturday visit × 2 carers × £18 = £186.
    expect(data.totals.weekly).toBe(186);
    expect(data.totals.weeklyCoverageMinutes).toBe(330);
    expect(data.totals.weeklyCarerMinutes).toBe(360);
    expect(data.totals.monthlyAverage).toBe(806);
    const after = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.stage).toBe('CONTACTED');
    // The enquiry had no branch: it takes the quote's branch.
    expect(after.locationId).toBe(branchA);
  });

  it('J: a missing rate blocks issuing', async () => {
    const e = await newEnquiry('CONTACTED', branchB);
    // Branch B's card only has a Sunday rate: the weekday and Saturday visits have no rate.
    const { data } = await service.create(admin, e.id, draft({ chargeCardId: sundayOnlyCardId }));
    expect(data.pricing?.issues.join()).toMatch(/No visit rate on Sunday-only/);
    expect(data.totals.unresolvedCharges).toBeGreaterThan(0);
    await expect(service.submitForApproval(admin, e.id, data.quotationId, data.id)).rejects.toThrow(BadRequestException);
  });

  it('M/N: drafts cannot be sent; an external send moves to Quote sent; a repeated key is ignored', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v1 } = await service.create(admin, e.id, draft());
    await expect(
      service.send(admin, e.id, v1.quotationId, v1.id, { channel: 'POST', idempotencyKey: key() }),
    ).rejects.toThrow(ConflictException);
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } })).stage).toBe('CONTACTED');

    await service.approve(admin, e.id, v1.quotationId, v1.id, 'ok');
    const k = key();
    const sent = await service.send(admin, e.id, v1.quotationId, v1.id, { channel: 'POST', idempotencyKey: k, followUpDate: '2027-01-10T10:00:00.000Z' });
    expect(sent.data.status).toBe('SENT');
    expect(sent.data.communications[0]).toMatchObject({ channel: 'POST', status: 'RECORDED' });
    await service.send(admin, e.id, v1.quotationId, v1.id, { channel: 'POST', idempotencyKey: k });
    expect(await prisma.enquiryQuotationCommunication.count({ where: { versionId: v1.id } })).toBe(1);
    const enq = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(enq.stage).toBe('OFFER');
    // The send's follow-up is mirrored onto the enquiry's own follow-up.
    expect(enq.nextFollowUpAt?.toISOString()).toBe('2027-01-10T10:00:00.000Z');
  });

  it('M: an integrated email is refused in log mode, recorded as failed on error and retried', async () => {
    const e = await newEnquiry('ASSESSMENT' as never, branchA);
    const { data: v } = await service.create(admin, e.id, draft());
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    mailState.mode = 'log';
    await expect(service.send(admin, e.id, v.quotationId, v.id, { channel: 'EMAIL', idempotencyKey: key() })).rejects.toThrow(/not set up/);
    mailState.mode = 'smtp';
    mailState.fail = true;
    await expect(service.send(admin, e.id, v.quotationId, v.id, { channel: 'EMAIL', idempotencyKey: key() })).rejects.toThrow(BadRequestException);
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } })).stage).toBe('ASSESSMENT');
    const failed = await prisma.enquiryQuotationCommunication.findFirstOrThrow({ where: { versionId: v.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.failureReason).toBe('SMTP down');
    mailState.fail = false;
    const retried = await service.retrySend(admin, e.id, v.quotationId, failed.id);
    expect(retried.data.status).toBe('SENT');
    expect(retried.data.communications[0]).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } })).stage).toBe('OFFER');
    const attachment = (mail.send.mock.calls.at(-1) as any)[0].attachments[0];
    expect(attachment.content.subarray(0, 4).toString()).toBe('%PDF');
    mailState.mode = 'log';
  });

  it('PDF / preview: client-facing output has no internal notes; a draft has no PDF', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft());
    await expect(service.pdf(admin, e.id, v.quotationId, v.id)).rejects.toThrow(ConflictException);
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    const preview = await service.preview(admin, e.id, v.quotationId, v.id);
    expect(JSON.stringify(preview.data)).not.toContain('INTERNAL');
    expect(preview.data.clientNotes).toBe('We look forward to supporting you.');
    const pdf = await service.pdf(admin, e.id, v.quotationId, v.id);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('Q/V: issued versions are frozen; Changes Requested creates V2 and keeps V1; sending V2 supersedes V1', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v1 } = await service.create(admin, e.id, draft());
    await service.approve(admin, e.id, v1.quotationId, v1.id, undefined);
    await expect(service.approve(admin, e.id, v1.quotationId, v1.id, undefined)).rejects.toThrow(ConflictException);
    await expect(service.update(admin, e.id, v1.quotationId, v1.id, { clientNotes: 'x' })).rejects.toThrow(ConflictException);
    await service.send(admin, e.id, v1.quotationId, v1.id, { channel: 'HAND_DELIVERED', idempotencyKey: key() });
    const before = await prisma.enquiryQuotationVersion.findUniqueOrThrow({ where: { id: v1.id }, include: { patterns: true } });

    const res = await service.recordResponse(admin, e.id, v1.quotationId, v1.id, {
      responseType: 'CHANGES_REQUESTED',
      responderName: 'Ann',
      responderRelationship: 'Daughter',
      method: 'Phone',
      details: 'Drop the weekend visit',
    });
    const v2 = res.data;
    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe('DRAFT');
    expect(v2.revisedFromVersionId).toBe(v1.id);
    const v1After = await prisma.enquiryQuotationVersion.findUniqueOrThrow({ where: { id: v1.id }, include: { patterns: true } });
    expect(v1After.status).toBe('CHANGES_REQUESTED');
    expect(v1After.pricingSnapshot).toEqual(before.pricingSnapshot);
    expect(v1After.patterns.length).toBe(2);

    await service.update(admin, e.id, v2.quotationId, v2.id, { validUntil: '2027-12-31', patterns: [draft().patterns![0]] });
    await service.approve(admin, e.id, v2.quotationId, v2.id, undefined);
    await service.send(admin, e.id, v2.quotationId, v2.id, { channel: 'EXTERNAL_EMAIL', idempotencyKey: key() });
    expect((await prisma.enquiryQuotationVersion.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe('SUPERSEDED');
    const diff = await service.compare(admin, e.id, v2.quotationId, v2.id, v1.id);
    expect(diff.data.rows.some(r => r.field === 'Weekly total')).toBe(true);
    expect(diff.data.rows.some(r => r.field === 'Weekend double-up' && r.from === 'Removed')).toBe(true);
    // A superseded version cannot be accepted any more.
    await expect(
      service.recordResponse(admin, e.id, v1.quotationId, v1.id, { responseType: 'ACCEPTED' }),
    ).rejects.toThrow(ConflictException);
  });

  it('P/T: acceptance never marks Won; prerequisites stay pending; the care package is created once, as a draft', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft());
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    await service.send(admin, e.id, v.quotationId, v.id, { channel: 'POST', idempotencyKey: key() });
    const accepted = await service.recordResponse(admin, e.id, v.quotationId, v.id, {
      responseType: 'ACCEPTED',
      responderName: 'Ann',
      method: 'Email',
      evidence: 'Email of 5 Jan saved',
    });
    expect(accepted.data.status).toBe('ACCEPTED');
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } })).stage).toBe('OFFER');
    expect(accepted.data.prerequisites?.find(p => p.key === 'agreement')?.done).toBe(false);
    expect(accepted.data.prerequisites?.find(p => p.key === 'assessment')?.done).toBe(false);

    await expect(service.convertToCarePackage(admin, e.id, v.quotationId, v.id)).rejects.toThrow(/service user/);
    const su = await prisma.serviceUser.create({ data: { firstName: 'Quote', lastName: `SU-${tag}`, locationId: branchA } });
    serviceUsers.push(su.id);
    await crm.linkServiceUser(admin, e.id, { serviceUserId: su.id });
    // A second service user for the same enquiry is refused (no duplicates).
    await expect(crm.linkServiceUser(admin, e.id, { serviceUserId: randomUUID() })).rejects.toThrow();

    const first = await service.convertToCarePackage(admin, e.id, v.quotationId, v.id);
    const again = await service.convertToCarePackage(admin, e.id, v.quotationId, v.id);
    expect(first.data.created).toBe(true);
    expect(again.data).toMatchObject({ created: false, visitPlanId: first.data.visitPlanId });
    expect(visitPlans.create).toHaveBeenCalledTimes(1);
    const plan = await prisma.serviceUserVisitPlan.findUniqueOrThrow({ where: { id: first.data.visitPlanId } });
    expect(plan).toMatchObject({ status: 'DRAFT', sourceEnquiryQuotationId: v.quotationId, sourceEnquiryQuotationVersionId: v.id });
    const slots = createdPlans.at(-1)!.dto.slots;
    expect(slots.map((s: any) => [s.slotCode, s.requiredCarers, s.daysOfWeek, s.assignedEmployeeIds])).toEqual([
      ['Q1', 1, [1, 2, 3, 4, 5], []],
      ['Q2', 2, [6], []],
    ]);
    expect(createdPlans.at(-1)!.dto.weeklyContractedHours).toBe('5.5');
  });

  it('R: a decline needs a structured reason and applies the Lost rules', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft());
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    await service.send(admin, e.id, v.quotationId, v.id, { channel: 'POST', idempotencyKey: key() });
    await expect(service.recordResponse(admin, e.id, v.quotationId, v.id, { responseType: 'DECLINED' })).rejects.toThrow(/why/);
    await expect(
      service.recordResponse(admin, e.id, v.quotationId, v.id, { responseType: 'DECLINED', declineReasonCode: 'OTHER' }),
    ).rejects.toThrow(/Other/);
    await service.recordResponse(admin, e.id, v.quotationId, v.id, { responseType: 'DECLINED', declineReasonCode: 'PRICE', details: 'Too expensive' });
    const enq = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(enq).toMatchObject({ stage: 'LOST', lostReasonCode: 'PRICE', lostReason: 'Too expensive' });
  });

  it('S: follow-ups can be scheduled, rescheduled (with history) and completed', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft());
    await service.createFollowUp(admin, e.id, v.quotationId, { dueAt: '2027-02-01T09:00:00.000Z', method: 'Phone', note: 'Call Ann' });
    let enq = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(enq.nextFollowUpAt?.toISOString()).toBe('2027-02-01T09:00:00.000Z');
    expect(enq.nextAction).toMatch(/^Quote follow-up EQ-/);
    const [f] = await prisma.enquiryQuotationFollowUp.findMany({ where: { quotationId: v.quotationId } });
    await service.updateFollowUp(admin, e.id, v.quotationId, f.id, { action: 'RESCHEDULE', dueAt: '2027-02-03T09:00:00.000Z' });
    await expect(service.updateFollowUp(admin, e.id, v.quotationId, f.id, { action: 'COMPLETE' })).rejects.toThrow(ConflictException);
    const open = await prisma.enquiryQuotationFollowUp.findFirstOrThrow({ where: { quotationId: v.quotationId, status: 'OPEN' } });
    expect(open.rescheduledFromId).toBe(f.id);
    await service.updateFollowUp(admin, e.id, v.quotationId, open.id, { action: 'COMPLETE', outcome: 'Spoke to Ann' });
    enq = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(enq.nextFollowUpAt).toBeNull();
  });

  it('U: a branch user cannot quote for, or open a quote on, another branch', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    // Another branch is reported as not found (its existence is not revealed).
    await expect(service.create(branchUser, e.id, draft({ locationId: branchB }))).rejects.toThrow(NotFoundException);
    const other = await newEnquiry('CONTACTED', branchB);
    const { data: v } = await service.create(admin, other.id, draft());
    await expect(service.getVersion(branchUser, other.id, v.quotationId, v.id)).rejects.toThrow(NotFoundException);
    await expect(service.list(branchUser, other.id)).rejects.toThrow(NotFoundException);
  });

  it('legacy: a Quote sent enquiry with no quotation is flagged until reviewed; no amounts are invented', async () => {
    const e = await newEnquiry('OFFER', branchA);
    await prisma.enquiry.update({ where: { id: e.id }, data: { quoteWeeklyAmount: 250 } });
    let list = await service.list(admin, e.id);
    expect(list.data.legacy).toMatchObject({ unlinked: true, weeklyAmount: 250 });
    expect(list.data.quotations).toEqual([]);
    await service.reconcileLegacy(admin, e.id, { action: 'MOVE_STAGE', stage: 'ASSESSMENT', note: 'No quote was really sent' });
    list = await service.list(admin, e.id);
    expect(list.data.legacy.unlinked).toBe(false);
    expect(list.data.quotations).toEqual([]);
    expect((await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } })).stage).toBe('ASSESSMENT');
    await expect(service.reconcileLegacy(admin, e.id, { action: 'ACKNOWLEDGE', note: 'again' })).rejects.toThrow(ConflictException);
  });

  it('V: invalid transitions are refused', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft());
    await expect(service.rejectApproval(admin, e.id, v.quotationId, v.id, undefined)).rejects.toThrow(ConflictException);
    await service.cancel(admin, e.id, v.quotationId, v.id, 'not needed');
    await expect(service.approve(admin, e.id, v.quotationId, v.id, undefined)).rejects.toThrow(ConflictException);
    await expect(service.revise(admin, e.id, v.quotationId, v.id)).rejects.toThrow(ConflictException);
    expect(audit.calls.some(c => (c as any).action === 'enquiry_quote_status_changed')).toBe(true);
  });
});
