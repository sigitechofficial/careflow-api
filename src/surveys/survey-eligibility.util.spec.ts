import {
  FORMER_PERSON_WINDOW_DAYS,
  careEndedAllowed,
  forLeavers,
  formerPeopleNeedNoReason,
  formerServiceUsersWhere,
  chosenServiceUsersWhere,
  formerStaffAllowed,
  formerStaffWhere,
  ineligibleRecipientIds,
  noAutomaticContactIds,
  outsideContactBlocks,
  complaintFromContact,
  organisationDomains,
  personalEmail,
} from './survey-eligibility.util';
import { recipientStatusCounts } from './surveys.service';

const db = (opts: { sus?: any[]; emps?: any[]; exts?: any[]; contacts?: any[]; complaints?: any[] } = {}) =>
  ({
    serviceUser: { findMany: jest.fn(async () => opts.sus ?? []) },
    employee: { findMany: jest.fn(async () => opts.emps ?? []) },
    surveyExternalContact: { findMany: jest.fn(async () => opts.exts ?? []) },
    serviceUserContact: { findMany: jest.fn(async () => opts.contacts ?? []) },
    feedbackRecord: { findMany: jest.fn(async () => opts.complaints ?? []) },
  }) as any;
const su = (id: string, code: string | null, over: any = {}) => ({ id, deletedAt: null, dateOfDeath: null, status: code ? { code } : null, ...over });
const r = (id: string, over: any) => ({ id, employeeId: null, serviceUserId: null, externalContactId: null, ...over });

describe('who can still be sent a survey (the same rules as sending)', () => {
  it('people we support: died, inactive or not started never; care ended only when chosen by name or the survey is about care ending', async () => {
    const people = [
      r('r-active', { serviceUserId: 'a' }),
      r('r-died', { serviceUserId: 'd' }),
      r('r-died-date', { serviceUserId: 'dd' }),
      r('r-inactive', { serviceUserId: 'i' }),
      r('r-pending', { serviceUserId: 'p' }),
      r('r-pre', { serviceUserId: 'pa' }),
      r('r-ended', { serviceUserId: 'e' }),
      r('r-gone', { serviceUserId: 'missing' }),
    ];
    const prisma = db({
      sus: [su('a', 'ACTIVE'), su('d', 'DECEASED'), su('dd', 'ACTIVE', { dateOfDeath: new Date() }), su('i', 'INACTIVE'), su('p', 'PENDING'), su('pa', 'PRE_ADMISSION'), su('e', 'DISCHARGED')],
    });
    const out = await ineligibleRecipientIds(prisma, {}, {}, people);
    expect([...out].sort()).toEqual(['r-died', 'r-died-date', 'r-ended', 'r-gone', 'r-inactive', 'r-pending', 'r-pre'].sort());
    // Chosen by name (the care-ended survey): discharged is still allowed; died never.
    const chosen = await ineligibleRecipientIds(prisma, { audienceServiceUserIds: ['e', 'd'] }, {}, people);
    expect(chosen.has('r-ended')).toBe(false);
    expect(chosen.has('r-died')).toBe(true);
    // A survey sent after care ends (or a complaint follow-up still due): discharged allowed.
    expect(careEndedAllowed({}, { eventTrigger: { event: 'CARE_ENDED', delayDays: 14, windowDays: 7, since: '2026-11-01' } }, 'e')).toBe(true);
    expect(careEndedAllowed({}, { eventTrigger: { event: 'HOSPITAL_DISCHARGE', delayDays: 10, windowDays: 4, since: '2026-11-01' } }, 'e')).toBe(false);
  });

  it('staff: deleted or inactive no longer, except on surveys for leavers', async () => {
    const prisma = db({ emps: [{ id: 'on', deletedAt: null, isActive: true }, { id: 'off', deletedAt: null, isActive: false }, { id: 'del', deletedAt: new Date(), isActive: false }] });
    const people = [r('r-on', { employeeId: 'on' }), r('r-off', { employeeId: 'off' }), r('r-del', { employeeId: 'del' })];
    expect([...(await ineligibleRecipientIds(prisma, {}, {}, people))].sort()).toEqual(['r-del', 'r-off']);
    expect([...(await ineligibleRecipientIds(prisma, { libraryReference: 'SUR-STF-015' }, {}, people))]).toEqual(['r-del']);
    expect(forLeavers({ audienceGroup: 'LEAVERS' }, {})).toBe(true);
    expect(forLeavers({}, { eventTrigger: { event: 'NOTICE_GIVEN', delayDays: 1, windowDays: 3, since: '2026-11-01' } })).toBe(true);
    expect(forLeavers({ libraryReference: 'SUR-STF-001' }, {})).toBe(false);
  });

  it('outside people: removed contacts no longer', async () => {
    const prisma = db({ exts: [{ id: 'x', deletedAt: null }, { id: 'y', deletedAt: new Date() }] });
    const out = await ineligibleRecipientIds(prisma, {}, {}, [r('r-x', { externalContactId: 'x' }), r('r-y', { externalContactId: 'y' })]);
    expect([...out]).toEqual(['r-y']);
  });

  it('anonymous surveys never show lapsed invitations apart (they stay among those not started)', () => {
    const groups = [
      { status: 'SENT', _count: { _all: 3 } },
      { status: 'LAPSED', _count: { _all: 1 } },
      { status: 'COMPLETED', _count: { _all: 2 } },
    ];
    expect(recipientStatusCounts(groups, { anonymous: true })).toEqual({ total: 6, notStarted: 4, opened: 0, completed: 2, lapsed: null });
    expect(recipientStatusCounts(groups)).toEqual({ total: 6, notStarted: 3, opened: 0, completed: 2, lapsed: 1 });
  });
});

describe('former staff, chosen by name (one rule, one window)', () => {
  it('only leavers’ surveys, and only people who left in about the last 3 months', () => {
    // Any survey by name (decision, November 2026); leavers' and care-ended surveys need no reason.
    expect(formerStaffAllowed({ libraryReference: 'SUR-STF-001' }, {})).toBe(true);
    expect(formerPeopleNeedNoReason({ libraryReference: 'SUR-STF-015' }, {}, 'EMPLOYEE')).toBe(true);
    expect(formerPeopleNeedNoReason({ libraryReference: 'SUR-STF-001' }, {}, 'EMPLOYEE')).toBe(false);
    expect(formerPeopleNeedNoReason({ libraryReference: 'SUR-PWS-008' }, {}, 'SERVICE_USER')).toBe(true);
    expect(formerPeopleNeedNoReason({ libraryReference: 'SUR-PWS-003' }, {}, 'SERVICE_USER')).toBe(false);
    expect(FORMER_PERSON_WINDOW_DAYS).toBe(92);
    const now = new Date('2026-11-06T12:00:00Z');
    const where = formerStaffWhere(now) as any;
    expect(where).toMatchObject({ deletedAt: null, isActive: false });
    const since = where.OR[0].leavingRecords.some.leavingDate.gte as Date;
    expect(Math.round((now.getTime() - since.getTime()) / 86_400_000)).toBe(92);
  });

  it('people whose care ended: by name within 3 months (never died, never a guessed end date), or any time on a care-ended survey', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(formerServiceUsersWhere(now)).toMatchObject({ dateOfDeath: null, status: { is: { code: 'DISCHARGED' } }, serviceEndDate: { lte: now } });
    expect(JSON.stringify(chosenServiceUsersWhere(now, false))).toMatch(/serviceEndDate/);
    expect(JSON.stringify(chosenServiceUsersWhere(now, true))).not.toMatch(/serviceEndDate/);
    expect(JSON.stringify(chosenServiceUsersWhere(now, true))).toMatch(/DECEASED/);
  });

  it('a personal email only: never an address on the organisation’s own domains', () => {
    const domains = organisationDomains({ email: 'office@sunrise-care.co.uk', companyWebsite: 'https://www.sunrise-care.co.uk/about' });
    expect(domains).toEqual(['sunrise-care.co.uk']);
    expect(personalEmail('zara@sunrise-care.co.uk', domains)).toBeNull();
    expect(personalEmail('zara@mail.sunrise-care.co.uk', domains)).toBeNull();
    expect(personalEmail('zara.ali@example.com', domains)).toBe('zara.ali@example.com');
    expect(personalEmail('', domains)).toBeNull();
  });

  it('family members lapse when consent is withdrawn, their record is removed, or the person has died (not the bereaved-family survey)', async () => {
    const ext = (id: string, sourceId: string) => ({ id, deletedAt: null, sourceType: 'SERVICE_USER_CONTACT', sourceId, serviceUserId: sourceId === 'c-died' ? 'su-died' : 'su1' });
    const prisma = db({
      exts: [ext('ok', 'c-ok'), ext('withdrawn', 'c-no'), ext('gone', 'c-gone'), ext('bereaved', 'c-died'), { id: 'typed', deletedAt: null, sourceType: 'TYPED', sourceId: null, serviceUserId: null }],
      contacts: [
        { id: 'c-ok', deletedAt: null, isActive: true, canReceiveUpdates: true, serviceUserId: 'su1' },
        { id: 'c-no', deletedAt: null, isActive: true, canReceiveUpdates: false, serviceUserId: 'su1' },
        { id: 'c-died', deletedAt: null, isActive: true, canReceiveUpdates: true, serviceUserId: 'su-died' },
      ],
      sus: [su('su1', 'ACTIVE'), su('su-died', 'DECEASED', { dateOfDeath: new Date('2026-11-01') })],
    });
    const people = ['ok', 'withdrawn', 'gone', 'bereaved', 'typed'].map((x) => r(`r-${x}`, { externalContactId: x }));
    expect([...(await ineligibleRecipientIds(prisma, {}, {}, people))].sort()).toEqual(['r-bereaved', 'r-gone', 'r-withdrawn']);
    expect([...(await ineligibleRecipientIds(prisma, { libraryReference: 'SUR-FAM-002' }, {}, people))].sort()).toEqual(['r-gone', 'r-withdrawn']);
  });

  describe('after a death (decisions 1 and 2)', () => {
    const famExt = (id: string, sourceId: string) => ({ id, deletedAt: null, sourceType: 'SERVICE_USER_CONTACT', sourceId, serviceUserId: 'su-d' });
    const record = (id: string, over: any = {}) => ({ id, deletedAt: null, isActive: true, canReceiveUpdates: true, serviceUserId: 'su-d', email: null, mobile: null, phone: null, ...over });
    const died = [su('su-d', 'DECEASED', { dateOfDeath: new Date('2026-11-01') })];
    const prof = { id: 'gp', deletedAt: null, sourceType: 'TYPED', sourceId: null, serviceUserId: null };

    it('the complaint follow-up (SUR-FAM-005) reaches only the family member who complained, and never automatically', async () => {
      const prisma = db({
        exts: [famExt('ann', 'c-ann'), famExt('bob', 'c-bob')],
        contacts: [record('c-ann', { email: 'Ann@Example.com', mobile: '07700 900123' }), record('c-bob', { email: 'bob@example.com' })],
        sus: died,
        complaints: [{ aboutServiceUserId: 'su-d', fromContact: 'Daughter, ann@example.com, 07700 900123' }],
      });
      const fam005 = { libraryReference: 'SUR-FAM-005' };
      const rows = [famExt('ann', 'c-ann'), famExt('bob', 'c-bob')];
      expect(Object.fromEntries(await outsideContactBlocks(prisma, fam005, {}, rows, 'STAFF'))).toEqual({ bob: 'DIED' });
      expect(Object.fromEntries(await outsideContactBlocks(prisma, fam005, {}, rows, 'AUTO'))).toEqual({ ann: 'NO_AUTO', bob: 'DIED' });
      expect(Object.fromEntries(await outsideContactBlocks(prisma, fam005, {}, rows, 'LINK'))).toEqual({ bob: 'DIED' });
      const people = [r('r-ann', { externalContactId: 'ann' }), r('r-bob', { externalContactId: 'bob' })];
      // Lapsed: only the family member who did not complain. Not chased: the one who did.
      expect([...(await ineligibleRecipientIds(prisma, fam005, {}, people))]).toEqual(['r-bob']);
      expect([...(await noAutomaticContactIds(prisma, fam005, {}, people))]).toEqual(['r-ann']);
      // Any other family survey: neither.
      expect([...(await ineligibleRecipientIds(prisma, { libraryReference: 'SUR-FAM-001' }, {}, people))].sort()).toEqual(['r-ann', 'r-bob']);
    });

    it('a complaint matches a contact by email or phone only, never by name', () => {
      expect(complaintFromContact('ann@example.com', { email: 'ANN@example.com' })).toBe(true);
      expect(complaintFromContact('Tel: +44 7700 900123', { mobile: '07700900123' })).toBe(true);
      expect(complaintFromContact('Ann Lee', { email: 'ann@example.com' })).toBe(false);
      expect(complaintFromContact('ann@example.com.au', { email: 'ann@example.com' })).toBe(false);
      expect(complaintFromContact(null, { email: 'ann@example.com' })).toBe(false);
    });

    it('a survey about one person who has died: others never automatically, by name only with a reason; links already sent still work', async () => {
      const prisma = db({ exts: [prof], sus: died });
      const about = { aboutServiceUserId: 'su-d' };
      expect((await outsideContactBlocks(prisma, about, {}, [prof], 'AUTO')).get('gp')).toBe('NO_AUTO');
      expect((await outsideContactBlocks(prisma, about, {}, [prof], 'STAFF')).get('gp')).toBe('NEEDS_REASON');
      expect((await outsideContactBlocks(prisma, about, {}, [prof], 'LINK')).has('gp')).toBe(false);
      const people = [r('r-gp', { externalContactId: 'gp' })];
      expect((await ineligibleRecipientIds(prisma, about, {}, people)).size).toBe(0);
      expect([...(await noAutomaticContactIds(prisma, {}, about, people))]).toEqual(['r-gp']);
      // While the person is alive: nothing.
      const alive = db({ exts: [prof], sus: [su('su-d', 'ACTIVE')] });
      expect((await noAutomaticContactIds(alive, about, {}, people)).size).toBe(0);
    });
  });
});
