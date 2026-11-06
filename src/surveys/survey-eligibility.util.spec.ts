import {
  FORMER_PERSON_WINDOW_DAYS,
  careEndedAllowed,
  forLeavers,
  formerStaffAllowed,
  formerStaffWhere,
  ineligibleRecipientIds,
  organisationDomains,
  personalEmail,
} from './survey-eligibility.util';
import { recipientStatusCounts } from './surveys.service';

const db = (opts: { sus?: any[]; emps?: any[]; exts?: any[] } = {}) =>
  ({
    serviceUser: { findMany: jest.fn(async () => opts.sus ?? []) },
    employee: { findMany: jest.fn(async () => opts.emps ?? []) },
    surveyExternalContact: { findMany: jest.fn(async () => opts.exts ?? []) },
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
    expect(formerStaffAllowed({ libraryReference: 'SUR-STF-015' }, {})).toBe(true);
    expect(formerStaffAllowed({}, { libraryReference: 'SUR-STF-015' })).toBe(true);
    expect(formerStaffAllowed({ libraryReference: 'SUR-STF-001' }, {})).toBe(false);
    expect(FORMER_PERSON_WINDOW_DAYS).toBe(92);
    const now = new Date('2026-11-06T12:00:00Z');
    const where = formerStaffWhere(now) as any;
    expect(where).toMatchObject({ deletedAt: null, isActive: false });
    const since = where.OR[0].leavingRecords.some.leavingDate.gte as Date;
    expect(Math.round((now.getTime() - since.getTime()) / 86_400_000)).toBe(92);
  });

  it('a personal email only: never an address on the organisation’s own domains', () => {
    const domains = organisationDomains({ email: 'office@sunrise-care.co.uk', companyWebsite: 'https://www.sunrise-care.co.uk/about' });
    expect(domains).toEqual(['sunrise-care.co.uk']);
    expect(personalEmail('zara@sunrise-care.co.uk', domains)).toBeNull();
    expect(personalEmail('zara@mail.sunrise-care.co.uk', domains)).toBeNull();
    expect(personalEmail('zara.ali@example.com', domains)).toBe('zara.ali@example.com');
    expect(personalEmail('', domains)).toBeNull();
  });
});
