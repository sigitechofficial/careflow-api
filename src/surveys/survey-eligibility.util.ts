import { Prisma, SurveyRecipientStatus, type PrismaClient } from '@prisma/client';
import { readEventTrigger } from './survey-event-triggers.util';

/**
 * Who may be sent a survey: one set of rules for sending (SurveysService.resolveTargets) and for everything
 * after it (reminders, texts, call lists, personal links). An unanswered invitation whose person no longer
 * passes is LAPSED: nothing more is sent, the link says the survey is closed for them, and answers already
 * given are kept.
 */

/**
 * People we support who are not receiving care are never surveyed by branch, nor by a repeating
 * survey: care ended (discharged), died, inactive, or not started yet (pending, pre-admission).
 */
export const SURVEY_EXCLUDED_SERVICE_USER_STATUSES = ['DISCHARGED', 'DECEASED', 'INACTIVE', 'PENDING', 'PRE_ADMISSION'] as const;

/**
 * Chosen by name (a send, a one-off schedule, or Record response): someone whose care has ended
 * (discharged) can be asked once more — the "When your care ends" survey. Never someone who has
 * died (the family's bereavement survey is the route), is inactive or has not started care.
 */
export const CHOSEN_EXCLUDED_SERVICE_USER_STATUSES = ['DECEASED', 'INACTIVE', 'PENDING', 'PRE_ADMISSION'] as const;
export const CARE_ENDED_STATUS = 'DISCHARGED';

export const notWithStatus = (codes: readonly string[]): Prisma.ServiceUserWhereInput => ({
  NOT: { status: { is: { code: { in: [...codes] } } } },
});

/** Staff who may be sent surveys (as resolveTargets). */
export const ELIGIBLE_EMPLOYEE_WHERE: Prisma.EmployeeWhereInput = { deletedAt: null, isActive: true };

/** Statuses an invitation can lapse from (never COMPLETED: answers are kept). */
export const LAPSABLE_STATUSES: SurveyRecipientStatus[] = [SurveyRecipientStatus.PENDING, SurveyRecipientStatus.SENT, SurveyRecipientStatus.STARTED];

/** The survey (and, for a period or month copy, the survey it was copied from). */
export type EligibilitySurvey = {
  audienceServiceUserIds?: string[] | null;
  audienceEmployeeIds?: string[] | null;
  audienceGroup?: string | null;
  libraryReference?: string | null;
  eventTrigger?: unknown;
  /** A survey about one person we support (A1 #3). */
  aboutServiceUserId?: string | null;
};

/** Surveys about care ending (a complaint follow-up still due) may still go to someone discharged. */
export function careEndedAllowed(survey: EligibilitySurvey, owner: EligibilitySurvey, serviceUserId: string): boolean {
  if ((survey.audienceServiceUserIds ?? []).includes(serviceUserId) || (owner.audienceServiceUserIds ?? []).includes(serviceUserId)) return true;
  const event = readEventTrigger(owner.eventTrigger)?.event;
  return event === 'CARE_ENDED' || event === 'COMPLAINT_CLOSED';
}

/** Surveys for leavers (SUR-STF-015, "Leavers", the notice-given event) still go to staff who have left. */
export function forLeavers(survey: EligibilitySurvey, owner: EligibilitySurvey): boolean {
  const refs = [survey.libraryReference, owner.libraryReference];
  return (
    refs.includes('SUR-STF-015') ||
    survey.audienceGroup === 'LEAVERS' ||
    owner.audienceGroup === 'LEAVERS' ||
    readEventTrigger(owner.eventTrigger)?.event === 'NOTICE_GIVEN'
  );
}

type Db = Pick<PrismaClient, 'serviceUser' | 'employee' | 'surveyExternalContact'> & {
  serviceUserContact?: Pick<PrismaClient['serviceUserContact'], 'findMany'>;
  feedbackRecord?: Pick<PrismaClient['feedbackRecord'], 'findMany'>;
};

/** The bereaved-family survey (SUR-FAM-002, or one sent on a death): the only survey a family is sent after the person died. */
export function forBereavedFamilies(survey: EligibilitySurvey, owner: EligibilitySurvey): boolean {
  return [survey.libraryReference, owner.libraryReference].includes('SUR-FAM-002') || readEventTrigger(owner.eventTrigger)?.event === 'DEATH';
}

/** "After your complaint (family member or representative)": after a death, staff may send it to the person who complained. */
export function forFamilyComplaint(survey: EligibilitySurvey, owner: EligibilitySurvey): boolean {
  return [survey.libraryReference, owner.libraryReference].includes('SUR-FAM-005');
}

/**
 * Who is making the contact. AUTO: reminders, texts and the call list (nothing a member of staff decided for
 * this person). STAFF: a member of staff sending by name (Send to people, Send again). LINK: the person
 * opening or answering a link they were already sent.
 */
export type ContactContext = 'AUTO' | 'STAFF' | 'LINK';

/**
 * Why an outside person cannot be contacted now:
 * - NO_CONSENT: a People involved record that was removed, made inactive, or no longer has "Can receive care
 *   updates" ticked (always; their invitation lapses).
 * - DIED: family of a person who has died (always; lapses), except the bereaved-family survey, and the family
 *   complaint follow-up (SUR-FAM-005) to the family member who made the complaint.
 * - NO_AUTO: never reached automatically (no reminder, text or call list) but not lapsed: the family member who
 *   complained, on SUR-FAM-005, after the death; anyone else on a survey about one person who has died.
 * - NEEDS_REASON: a survey about one person who has died, sent by staff by name: only with a recorded reason.
 */
export type OutsideBlock = 'NO_CONSENT' | 'DIED' | 'NO_AUTO' | 'NEEDS_REASON';

export type OutsideRow = { id: string; sourceType: string; sourceId: string | null; serviceUserId: string | null };

const digitsTail = (v: string | null | undefined): string | null => {
  const d = (v ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * The complaint's reply-to details name this People involved contact: the same email address or phone number.
 * Complaints do not link to People involved, so a name alone never counts (fails closed).
 */
export function complaintFromContact(fromContact: string | null | undefined, c: { email?: string | null; mobile?: string | null; phone?: string | null }): boolean {
  const text = (fromContact ?? '').toLowerCase();
  if (!text.trim()) return false;
  const email = c.email?.trim().toLowerCase();
  if (email && (text.match(/[^\s,;<>()]+@[^\s,;<>()]+/g) ?? []).some((e: string) => e.replace(/\.+$/, '') === email)) return true;
  const numbers = (text.match(/\+?\d[\d\s().-]{8,}\d/g) ?? []).map(digitsTail).filter((n): n is string => Boolean(n));
  return [c.mobile, c.phone].map(digitsTail).some((n) => Boolean(n && numbers.includes(n)));
}

export async function outsideContactBlocks(
  prisma: Db,
  survey: EligibilitySurvey,
  owner: EligibilitySurvey,
  rows: OutsideRow[],
  context: ContactContext,
): Promise<Map<string, OutsideBlock>> {
  const out = new Map<string, OutsideBlock>();
  if (!rows.length) return out;
  const family = rows.filter((r) => r.sourceType === 'SERVICE_USER_CONTACT');
  const sourceIds = family.map((f) => f.sourceId).filter((x): x is string => Boolean(x));
  const contacts =
    sourceIds.length && prisma.serviceUserContact
      ? await prisma.serviceUserContact.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, deletedAt: true, isActive: true, canReceiveUpdates: true, serviceUserId: true, email: true, mobile: true, phone: true },
        })
      : [];
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const aboutId = survey.aboutServiceUserId ?? owner.aboutServiceUserId ?? null;
  const suIds = [...new Set([aboutId, ...family.map((f) => f.serviceUserId), ...contacts.map((c) => c.serviceUserId)].filter((x): x is string => Boolean(x)))];
  const sus = suIds.length
    ? await prisma.serviceUser.findMany({ where: { id: { in: suIds } }, select: { id: true, dateOfDeath: true, status: { select: { code: true } } } })
    : [];
  const died = new Set(sus.filter((s) => s.dateOfDeath || s.status?.code === 'DECEASED').map((s) => s.id));
  const bereaved = forBereavedFamilies(survey, owner);
  const complaintSurvey = forFamilyComplaint(survey, owner);
  // Family complaints about people who have died: read only when it matters.
  const diedFamilyPeople = [...new Set(contacts.filter((c) => died.has(c.serviceUserId)).map((c) => c.serviceUserId))];
  const complaints =
    complaintSurvey && !bereaved && diedFamilyPeople.length && prisma.feedbackRecord
      ? await prisma.feedbackRecord.findMany({
          where: { deletedAt: null, type: 'COMPLAINT', fromKind: 'FAMILY', aboutServiceUserId: { in: diedFamilyPeople } },
          select: { aboutServiceUserId: true, fromContact: true },
        })
      : [];
  for (const f of family) {
    const c = f.sourceId ? byId.get(f.sourceId) : undefined;
    if (!c || c.deletedAt || !c.isActive || !c.canReceiveUpdates) {
      out.set(f.id, 'NO_CONSENT');
      continue;
    }
    const personDied = died.has(c.serviceUserId) || Boolean(f.serviceUserId && died.has(f.serviceUserId));
    if (!personDied || bereaved) continue;
    const complained = complaintSurvey && complaints.some((k) => k.aboutServiceUserId === c.serviceUserId && complaintFromContact(k.fromContact, c));
    if (!complained) out.set(f.id, 'DIED');
    else if (context === 'AUTO') out.set(f.id, 'NO_AUTO');
  }
  // Anyone else on a survey about one person who has died (a GP's or commissioner's view of their care): never
  // automatic; by name with a reason; a link already sent still works.
  if (aboutId && died.has(aboutId) && context !== 'LINK') {
    for (const r of rows) {
      if (r.sourceType === 'SERVICE_USER_CONTACT') continue;
      out.set(r.id, context === 'AUTO' ? 'NO_AUTO' : 'NEEDS_REASON');
    }
  }
  return out;
}

/** Family members who can no longer be sent this survey at all (NO_CONSENT or DIED), by outside-person id. */
export async function blockedFamilyContacts(
  prisma: Db,
  survey: EligibilitySurvey,
  owner: EligibilitySurvey,
  rows: OutsideRow[],
): Promise<Map<string, 'NO_CONSENT' | 'DIED'>> {
  const all = await outsideContactBlocks(prisma, survey, owner, rows, 'LINK');
  return new Map([...all].filter((e): e is [string, 'NO_CONSENT' | 'DIED'] => e[1] === 'NO_CONSENT' || e[1] === 'DIED'));
}

/**
 * Recipients never reached automatically (reminders, texts, call list) but whose invitation stays open, by
 * recipient id (outsideContactBlocks NO_AUTO).
 */
export async function noAutomaticContactIds(
  prisma: Db,
  survey: EligibilitySurvey,
  owner: EligibilitySurvey,
  people: Array<{ id: string; externalContactId?: string | null }>,
): Promise<Set<string>> {
  const extIds = [...new Set(people.map((p) => p.externalContactId).filter((x): x is string => Boolean(x)))];
  if (!extIds.length) return new Set();
  const exts = await prisma.surveyExternalContact.findMany({ where: { id: { in: extIds } }, select: { id: true, sourceType: true, sourceId: true, serviceUserId: true } });
  const blocks = await outsideContactBlocks(prisma, survey, owner, exts, 'AUTO');
  return new Set(people.filter((p) => p.externalContactId && blocks.get(p.externalContactId) === 'NO_AUTO').map((p) => p.id));
}

/**
 * The recipients (by recipient id) who can no longer be sent this survey. People we support: died,
 * inactive, not started, or care ended (unless chosen by name or the survey is about care ending). Staff:
 * deleted or inactive (unless the survey is for leavers). Outside people: removed; family members whose
 * consent was withdrawn or whose person has died (blockedFamilyContacts).
 */
export async function ineligibleRecipientIds(
  prisma: Db,
  survey: EligibilitySurvey,
  owner: EligibilitySurvey,
  people: Array<{ id: string; employeeId: string | null; serviceUserId: string | null; externalContactId?: string | null }>,
): Promise<Set<string>> {
  const out = new Set<string>();
  const suIds = [...new Set(people.map((p) => p.serviceUserId).filter((x): x is string => Boolean(x)))];
  const empIds = [...new Set(people.map((p) => p.employeeId).filter((x): x is string => Boolean(x)))];
  const extIds = [...new Set(people.map((p) => p.externalContactId).filter((x): x is string => Boolean(x)))];
  const [sus, emps, exts] = await Promise.all([
    suIds.length
      ? prisma.serviceUser.findMany({ where: { id: { in: suIds } }, select: { id: true, deletedAt: true, dateOfDeath: true, status: { select: { code: true } } } })
      : Promise.resolve([]),
    empIds.length ? prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, deletedAt: true, isActive: true } }) : Promise.resolve([]),
    extIds.length
      ? prisma.surveyExternalContact.findMany({ where: { id: { in: extIds } }, select: { id: true, deletedAt: true, sourceType: true, sourceId: true, serviceUserId: true } })
      : Promise.resolve([]),
  ]);
  const blockedFamily = await blockedFamilyContacts(
    prisma,
    survey,
    owner,
    (exts as Array<{ id: string; sourceType?: string | null; sourceId?: string | null; serviceUserId?: string | null }>).map((x) => ({
      id: x.id,
      sourceType: x.sourceType ?? 'TYPED',
      sourceId: x.sourceId ?? null,
      serviceUserId: x.serviceUserId ?? null,
    })),
  );
  const suById = new Map(sus.map((s) => [s.id, s]));
  const empById = new Map(emps.map((e) => [e.id, e]));
  const extById = new Map(exts.map((e) => [e.id, e]));
  const leavers = forLeavers(survey, owner);
  for (const p of people) {
    if (p.serviceUserId) {
      const su = suById.get(p.serviceUserId);
      const code = su?.status?.code ?? null;
      const ended = code === CARE_ENDED_STATUS;
      const never = Boolean(code && (CHOSEN_EXCLUDED_SERVICE_USER_STATUSES as readonly string[]).includes(code));
      if (!su || su.deletedAt || su.dateOfDeath || never || (ended && !careEndedAllowed(survey, owner, p.serviceUserId))) out.add(p.id);
    } else if (p.employeeId) {
      const e = empById.get(p.employeeId);
      // Someone who has left stays reachable on a leavers' survey, or one they were chosen for by name (former people).
      const chosen = (survey.audienceEmployeeIds ?? []).includes(p.employeeId) || (owner.audienceEmployeeIds ?? []).includes(p.employeeId);
      if (!e || e.deletedAt || (!e.isActive && !leavers && !chosen)) out.add(p.id);
    } else if (p.externalContactId) {
      const x = extById.get(p.externalContactId);
      if (!x || x.deletedAt || blockedFamily.has(x.id)) out.add(p.id);
    }
  }
  return out;
}

// ─── Former people, chosen by name ───────────────────────────────────────

/**
 * Former people (decision, November 2026): for this many days after someone leaves (staff) or their care ends
 * (people we support, DISCHARGED), they may be chosen BY NAME for any survey: never by branch, job title or a
 * repeating send, and never anyone who has died. Each such send needs a reason, except leavers' surveys and
 * surveys about care ending. Every invitation to them carries a permanent one-click opt-out.
 */
export const FORMER_PERSON_WINDOW_DAYS = 92;

/** Which surveys may be sent by name to staff who have left, within the window: any (the reason rule decides the rest). */
export function formerStaffAllowed(_survey: EligibilitySurvey, _owner: EligibilitySurvey): boolean {
  return true;
}

/** Surveys that go to former people by their nature: no reason needed (leavers; care ending or its complaint follow-up). */
export function formerPeopleNeedNoReason(survey: EligibilitySurvey, owner: EligibilitySurvey, kind: 'EMPLOYEE' | 'SERVICE_USER'): boolean {
  if (kind === 'EMPLOYEE') return forLeavers(survey, owner);
  const refs = [survey.libraryReference, owner.libraryReference];
  const event = readEventTrigger(owner.eventTrigger)?.event;
  return refs.includes('SUR-PWS-008') || refs.includes('SUR-PWS-006') || event === 'CARE_ENDED' || event === 'COMPLAINT_CLOSED';
}

export const FORMER_REASON_MIN = 5;
export const FORMER_REASON_MAX = 300;

/** People we support whose care ended in the window (a service end date; never a guessed one), never died. */
export function formerServiceUsersWhere(now: Date): Prisma.ServiceUserWhereInput {
  const since = new Date(now.getTime() - FORMER_PERSON_WINDOW_DAYS * 86_400_000);
  return {
    deletedAt: null,
    dateOfDeath: null,
    status: { is: { code: CARE_ENDED_STATUS } },
    serviceEndDate: { gte: since, lte: now },
  };
}

/**
 * Chosen by name: people receiving care, plus those whose care ended in the window (or at any time, on a
 * survey about care ending). Never died, inactive or not started.
 */
export function chosenServiceUsersWhere(now: Date, careEndedSurvey: boolean): Prisma.ServiceUserWhereInput {
  return {
    AND: [
      notWithStatus(CHOSEN_EXCLUDED_SERVICE_USER_STATUSES),
      { dateOfDeath: null },
      ...(careEndedSurvey ? [] : [{ OR: [notWithStatus([CARE_ENDED_STATUS]), formerServiceUsersWhere(now)] }]),
    ],
  };
}

/** Reason given by someone unsubscribing from all surveys (one click, or STOP as a former person): staff cannot lift it. */
export const SURVEY_UNSUBSCRIBE_REASON = 'Unsubscribed from all surveys';

/** Staff who left within the window (no longer active, not deleted): their leaving date, or employment end. */
export function formerStaffWhere(now: Date): Prisma.EmployeeWhereInput {
  const since = new Date(now.getTime() - FORMER_PERSON_WINDOW_DAYS * 86_400_000);
  return {
    deletedAt: null,
    isActive: false,
    OR: [
      { leavingRecords: { some: { deletedAt: null, leavingDate: { gte: since, lte: now } } } },
      { employment: { endDate: { gte: since, lte: now } } },
    ],
  };
}

/** The organisation's own email domains (its profile email and website): a work address, never used for former staff. */
export function organisationDomains(profile: { email?: string | null; companyWebsite?: string | null } | null): string[] {
  const out: string[] = [];
  const mail = profile?.email?.split('@')[1]?.trim().toLowerCase();
  if (mail) out.push(mail);
  const site = profile?.companyWebsite?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  if (site) out.push(site);
  return [...new Set(out)];
}

/** A personal address (not on the organisation's own domains), or null. */
export function personalEmail(email: string | null | undefined, domains: string[]): string | null {
  const e = email?.trim();
  if (!e || !e.includes('@')) return null;
  const domain = e.split('@')[1].toLowerCase();
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`)) ? null : e;
}
