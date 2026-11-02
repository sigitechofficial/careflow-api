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
// Not used here: only startInitialAssessment needs the initial assessments service.
const crm = new CrmService(prisma, audit.service as never, orgScope, {} as never);
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
const templates: string[] = [];

const draft = (over: Partial<QuoteDraftDto> = {}): QuoteDraftDto => ({
  proposedStartDate: '2027-01-04',
  validUntil: '2027-12-31',
  hourlyRate: 30,
  internalNotes: 'INTERNAL: client can afford more',
  clientNotes: 'We look forward to supporting you.',
  patterns: [
    { label: 'Morning call', startTime: '08:00', endTime: '09:00', durationMinutes: 60, daysOfWeek: [1, 2, 3, 4, 5], frequency: 'WEEKLY', carersPerVisit: 1 },
    { label: 'Weekend double-up', startTime: '18:00', endTime: '18:30', durationMinutes: 30, daysOfWeek: [6], frequency: 'WEEKLY', carersPerVisit: 2 },
  ],
  ...over,
});

async function newEnquiry(stage: 'NEW' | 'CONTACTED' | 'OFFER' = 'CONTACTED', locationId: string | null = null) {
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
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { id: { in: enquiries } } });
  await prisma.serviceUserVisitPlan.deleteMany({ where: { serviceUserId: { in: serviceUsers } } });
  await prisma.initialAssessmentSubmission.deleteMany({ where: { serviceUserId: { in: serviceUsers } } });
  await prisma.serviceUserAssignment.deleteMany({ where: { serviceUserId: { in: serviceUsers } } });
  await prisma.serviceUserAddress.deleteMany({ where: { serviceUserId: { in: serviceUsers } } });
  await prisma.serviceUserContact.deleteMany({ where: { serviceUserId: { in: serviceUsers } } });
  await prisma.initialAssessmentTemplate.deleteMany({ where: { id: { in: templates } } });
  await prisma.serviceUser.deleteMany({ where: { id: { in: serviceUsers } } });
  await prisma.location.deleteMany({ where: { id: { in: [branchA, branchB] } } });
  await prisma.$disconnect();
});

describe('enquiry quotations (database)', () => {
  it('A: a draft is priced from its hourly rate and does not change the stage', async () => {
    const e = await newEnquiry('CONTACTED');
    const { data } = await service.create(admin, e.id, draft({ locationId: branchA }));
    expect(data.status).toBe('DRAFT');
    expect(data.quotationNumber).toMatch(/^EQ-\d{4}-\d{4}$/);
    expect(data.label).toBe(`${data.quotationNumber} V1`);
    // £30/hour: 5 × 60 min = £150, plus 1 Saturday visit × 30 min × 2 carers = £30.
    expect(data.totals.weekly).toBe(180);
    expect(data.totals.weeklyCoverageMinutes).toBe(330);
    expect(data.totals.weeklyCarerMinutes).toBe(360);
    expect(data.totals.monthlyAverage).toBe(780);
    const after = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.stage).toBe('CONTACTED');
    // The enquiry had no branch: it takes the quote's branch.
    expect(after.locationId).toBe(branchA);
  });

  it('A2: creating a quotation for a New enquiry marks it Contacted', async () => {
    const e = await newEnquiry('NEW', branchA);
    const { data } = await service.create(admin, e.id, draft({ locationId: branchA }));
    const after = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id }, include: { events: true } });
    expect(after.stage).toBe('CONTACTED');
    expect(after.events).toContainEqual(
      expect.objectContaining({ action: 'Moved to CONTACTED', note: `${data.quotationNumber} created` }),
    );
  });

  it('J: a missing hourly rate blocks issuing', async () => {
    const e = await newEnquiry('CONTACTED', branchB);
    const { data } = await service.create(admin, e.id, draft({ hourlyRate: null }));
    expect(data.pricing?.issues).toEqual(['Set the hourly rate for this quote']);
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
    // In plain words: £ amounts with the difference, and the removed visit by name.
    const weekly = diff.data.rows.find(r => r.field === 'Weekly total')!;
    expect(weekly).toMatchObject({ section: 'Price', from: '£180.00', to: '£150.00', delta: -30 });
    expect(diff.data.rows).toContainEqual(
      expect.objectContaining({ section: 'Visits', item: 'Visit 2 · Weekend double-up', change: 'removed', from: 'Removed' }),
    );
    expect(diff.data.from).toMatchObject({ versionNumber: 1, weeklyTotal: 180 });
    expect(diff.data.to).toMatchObject({ versionNumber: 2, weeklyTotal: 150 });
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

    // The service user's full initial assessment counts once it is submitted, not while a draft.
    const template = await prisma.initialAssessmentTemplate.create({ data: { name: `Quote test ${tag}`, isActive: false } });
    templates.push(template.id);
    const ia = await prisma.initialAssessmentSubmission.create({
      data: { serviceUserId: su.id, templateId: template.id, status: 'DRAFT' },
    });
    const assessmentCheck = async () =>
      (await service.getVersion(admin, e.id, v.quotationId, v.id)).data.prerequisites?.find(p => p.key === 'assessment');
    expect(await assessmentCheck()).toMatchObject({ done: false, detail: 'Initial assessment in progress, not yet submitted' });
    await prisma.initialAssessmentSubmission.update({ where: { id: ia.id }, data: { status: 'SUBMITTED' } });
    expect(await assessmentCheck()).toMatchObject({ done: true, detail: 'Initial assessment submitted · awaiting manager review' });

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

  it('P2: a funder confirmed after acceptance clears the funding check without changing the price', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft({
      fundingCategory: 'LOCAL_AUTHORITY',
      fundings: [{ payerType: 'LOCAL_AUTHORITY', payerName: 'Croydon Council', method: 'PERCENTAGE', amount: 100 }],
    }));
    const fundingId = v.fundings[0]!.id;
    // Not on a draft: there it is changed in Who pays.
    await expect(service.confirmFunding(admin, e.id, v.quotationId, v.id, fundingId, {})).rejects.toThrow(ConflictException);

    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    await service.send(admin, e.id, v.quotationId, v.id, { channel: 'POST', idempotencyKey: key() });
    const accepted = await service.recordResponse(admin, e.id, v.quotationId, v.id, { responseType: 'ACCEPTED' });
    expect(accepted.data.prerequisites?.find(p => p.key === 'funding')).toMatchObject({ done: false });

    const confirmed = await service.confirmFunding(admin, e.id, v.quotationId, v.id, fundingId, { reference: 'CC-PKG-77' });
    expect(confirmed.data.prerequisites?.find(p => p.key === 'funding')).toMatchObject({ done: true, detail: 'Confirmed' });
    expect(confirmed.data.fundings[0]).toMatchObject({ status: 'CONFIRMED', reference: 'CC-PKG-77' });
    expect(confirmed.data.pricing?.weeklyTotal).toBeGreaterThan(0);
    expect(confirmed.data.pricing?.weeklyTotal).toBe(accepted.data.pricing?.weeklyTotal);
    const events = await prisma.enquiryEvent.findMany({ where: { enquiryId: e.id, action: 'Funding confirmed' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.note).toContain('Croydon Council · ref CC-PKG-77');
  });

  it('P3: other rates are saved, priced, frozen on issue, copied on revise and shown to the client', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const rates = { shortVisits: [{ upToMinutes: 30, pricePerVisit: 15 }], weekend: { mode: 'PERCENT' as const, value: 20 } };
    const { data: v } = await service.create(admin, e.id, draft({ rates }));
    expect(v.rates).toMatchObject(rates);
    // Weekdays 5 × £30 (60 min) + Saturday double-up 30 min short visit £15 + 20% = £18 × 2 carers = £36.
    expect(v.pricing?.visitsWeekly).toBe(186);

    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    const view = (await service.preview(admin, e.id, v.quotationId, v.id)).data;
    expect(view.rates).toEqual([
      { label: 'Standard visits', value: '£30.00 per carer per hour' },
      { label: 'Short visits (up to 30 min)', value: '£15.00 per visit per carer' },
      { label: 'Weekends (Saturday and Sunday)', value: '+20% on the visit price' },
    ]);
    const revised = await service.revise(admin, e.id, v.quotationId, v.id, undefined);
    expect(revised.data.rates).toMatchObject(rates);
  });

  it('P4: a total amount quote is priced at its typed total and shows the client only the visits by time of day', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft({
      clientLayout: 'SUMMARY',
      manualWeeklyTotal: 250,
      hourlyRate: null,
      patterns: [
        { label: 'Morning visit', startTime: '08:00', endTime: '08:30', durationMinutes: 30, daysOfWeek: [1, 2, 3, 4, 5], frequency: 'WEEKLY', carersPerVisit: 1 },
        { label: 'Evening visit', startTime: '18:00', endTime: '18:30', durationMinutes: 30, daysOfWeek: [6], frequency: 'WEEKLY', carersPerVisit: 2 },
      ],
    }));
    expect(v.clientLayout).toBe('SUMMARY');
    expect(v.manualWeeklyTotal).toBe(250);
    expect(v.pricing).toMatchObject({ manual: true, visitsWeekly: 250, issues: [] });
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    const view = (await service.preview(admin, e.id, v.quotationId, v.id)).data;
    expect(view.layout).toBe('SUMMARY');
    expect(view.visits.map((x) => [x.label, x.days, x.time, x.duration, x.perVisit, x.weekly])).toEqual([
      ['Morning visit', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], '', '', null, ''],
      ['Evening visit', ['Sat'], '', '', null, ''],
    ]);
    expect(view.rates).toEqual([]);
    expect(view.totals[0]).toMatchObject({ amount: '£250.00', method: 'The agreed weekly price' });
    const revised = await service.revise(admin, e.id, v.quotationId, v.id, undefined);
    expect(revised.data).toMatchObject({ clientLayout: 'SUMMARY', manualWeeklyTotal: 250 });
  });

  it('P5: after acceptance the person becomes an active service user, the enquiry is Won and the care package is made', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    await prisma.enquiry.update({
      where: { id: e.id },
      data: { addressLine: '1 High St', postcode: 'CR0 1AA', latitude: 51.3727, longitude: -0.1099 },
    });
    const { data: v } = await service.create(admin, e.id, draft({ locationId: branchA }));
    // Not before the client accepts.
    await expect(service.createServiceUserFromQuote(admin, e.id, v.quotationId, v.id, { createCarePackage: true })).rejects.toThrow(ConflictException);
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    await service.send(admin, e.id, v.quotationId, v.id, { channel: 'POST', idempotencyKey: key() });
    await service.recordResponse(admin, e.id, v.quotationId, v.id, { responseType: 'ACCEPTED' });

    const res = await service.createServiceUserFromQuote(admin, e.id, v.quotationId, v.id, { createCarePackage: true });
    serviceUsers.push(res.data.serviceUserId);
    expect(res.data).toMatchObject({ created: true, carePackage: { created: true, error: null } });
    const su = await prisma.serviceUser.findUniqueOrThrow({ where: { id: res.data.serviceUserId }, include: { address: true } });
    const active = await prisma.serviceUserStatus.findFirst({ where: { code: 'ACTIVE' } });
    expect(su).toMatchObject({ firstName: 'Quote', locationId: branchA, statusId: active?.id ?? null });
    expect(su.serviceStartDate?.toISOString().slice(0, 10)).toBe('2027-01-04');
    expect(su.address).toMatchObject({ addressLine1: '1 High St', postcode: 'CR0 1AA' });
    // The map position picked on the enquiry goes with the address.
    expect([Number(su.address?.latitude), Number(su.address?.longitude)]).toEqual([51.3727, -0.1099]);
    const enq = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id } });
    expect(enq).toMatchObject({ stage: 'WON', convertedServiceUserId: su.id });

    // The enquiry's contact is on the service user's contacts.
    const contacts = await prisma.serviceUserContact.findMany({ where: { serviceUserId: su.id } });
    expect(contacts).toEqual([expect.objectContaining({ firstName: 'Daughter', email: 'family@example.test', isPrimary: true })]);

    // Repeating it makes no second service user, package or contact.
    const again = await service.createServiceUserFromQuote(admin, e.id, v.quotationId, v.id, { createCarePackage: true });
    expect(again.data).toMatchObject({ serviceUserId: su.id, created: false, carePackage: { created: false } });
    expect(await prisma.serviceUserContact.count({ where: { serviceUserId: su.id } })).toBe(1);
  });

  it('P8: a Pre-admission record made to add details has no assessment, and becomes the active service user', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const pre = await crm.createPreAdmissionServiceUser(admin, e.id);
    serviceUsers.push(pre.data.serviceUserId);
    const preStatus = await prisma.serviceUserStatus.findFirst({ where: { code: 'PRE_ADMISSION' } });
    const su = await prisma.serviceUser.findUniqueOrThrow({ where: { id: pre.data.serviceUserId } });
    expect(su.statusId).toBe(preStatus?.id ?? null);
    expect(await prisma.initialAssessmentSubmission.count({ where: { serviceUserId: su.id } })).toBe(0);
    const linked = await prisma.enquiry.findUniqueOrThrow({ where: { id: e.id }, include: { events: true } });
    expect(linked).toMatchObject({ stage: 'CONTACTED', convertedServiceUserId: su.id });
    expect(linked.events.map((x) => x.action)).toContain('Pre-admission service user created');
    // Asking again keeps the same record.
    expect((await crm.createPreAdmissionServiceUser(admin, e.id)).data.serviceUserId).toBe(su.id);

    const { data: v } = await service.create(admin, e.id, draft({ locationId: branchA }));
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    await service.send(admin, e.id, v.quotationId, v.id, { channel: 'POST', idempotencyKey: key() });
    await service.recordResponse(admin, e.id, v.quotationId, v.id, { responseType: 'ACCEPTED' });
    const res = await service.createServiceUserFromQuote(admin, e.id, v.quotationId, v.id, { createCarePackage: false });
    expect(res.data).toMatchObject({ serviceUserId: su.id, created: false });
  });

  it('P7: the contact keeps its relationship; a referral team is kept whole as a professional', async () => {
    for (const [code, name] of [['DAUGHTER', 'Daughter'], ['OTHER', 'Other']]) {
      await prisma.relationshipType.upsert({ where: { code }, update: { isActive: true }, create: { code, name } });
    }
    const accept = async (enquiryId: string) => {
      const { data: v } = await service.create(admin, enquiryId, draft({ locationId: branchA }));
      await service.approve(admin, enquiryId, v.quotationId, v.id, undefined);
      await service.send(admin, enquiryId, v.quotationId, v.id, { channel: 'POST', idempotencyKey: key() });
      await service.recordResponse(admin, enquiryId, v.quotationId, v.id, { responseType: 'ACCEPTED' });
      const res = await service.createServiceUserFromQuote(admin, enquiryId, v.quotationId, v.id, { createCarePackage: false });
      serviceUsers.push(res.data.serviceUserId);
      return prisma.serviceUserContact.findFirstOrThrow({
        where: { serviceUserId: res.data.serviceUserId },
        include: { relationshipType: true },
      });
    };

    const family = await newEnquiry('CONTACTED', branchA);
    await prisma.enquiry.update({
      where: { id: family.id },
      data: { contactName: 'Ann Bloggs', contactRelationship: 'daughter', contactPhone: '07700 900123' },
    });
    expect(await accept(family.id)).toMatchObject({
      firstName: 'Ann',
      lastName: 'Bloggs',
      phone: '07700 900123',
      relationshipType: { code: 'DAUGHTER' },
    });

    const referral = await newEnquiry('CONTACTED', branchA);
    await prisma.enquiry.update({
      where: { id: referral.id },
      data: { kind: 'REFERRAL', contactName: "St Mary's Discharge Team", contactRelationship: 'Discharge coordinator' },
    });
    expect(await accept(referral.id)).toMatchObject({
      firstName: "St Mary's Discharge Team",
      lastName: null,
      relationshipType: { code: 'OTHER' },
      notes: expect.stringContaining('relationship: Discharge coordinator'),
    });
  });

  it('P6: a total amount quote also becomes a draft care package, contracted for its visits', async () => {
    const e = await newEnquiry('CONTACTED', branchA);
    const { data: v } = await service.create(admin, e.id, draft({
      locationId: branchA,
      clientLayout: 'SUMMARY',
      manualWeeklyTotal: 250,
      hourlyRate: null,
      patterns: [
        { label: 'Morning visit', startTime: '08:00', endTime: '08:30', durationMinutes: 30, daysOfWeek: [1, 2, 3, 4, 5], frequency: 'WEEKLY', carersPerVisit: 1 },
      ],
    }));
    await service.approve(admin, e.id, v.quotationId, v.id, undefined);
    await service.send(admin, e.id, v.quotationId, v.id, { channel: 'POST', idempotencyKey: key() });
    await service.recordResponse(admin, e.id, v.quotationId, v.id, { responseType: 'ACCEPTED' });
    const res = await service.createServiceUserFromQuote(admin, e.id, v.quotationId, v.id, { createCarePackage: true });
    serviceUsers.push(res.data.serviceUserId);
    expect(res.data.carePackage).toEqual({ created: true, error: null });
    const plan = await prisma.serviceUserVisitPlan.findFirstOrThrow({ where: { serviceUserId: res.data.serviceUserId } });
    expect(Number(plan.weeklyContractedHours)).toBe(2.5);
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
