/**
 * Surveys sent when something happens in the care records (Phase 2 part 3). The events CareFlow can read
 * from records it already keeps, the checks it can make, and the ready-made library's structured triggers.
 * The library's timing.trigger stays the words people read; this is what CareFlow acts on. Seed-safe
 * (no src/ imports); src/surveys/survey-event-triggers.util.ts re-exports it.
 */

export const SURVEY_TRIGGER_EVENTS = [
  'FIRST_VISIT',
  'CARE_REVIEW_DUE',
  'HOSPITAL_DISCHARGE',
  'COMPLAINT_CLOSED',
  'MEDICINES_CHANGE',
  'CARE_ENDED',
  'DEATH',
  'NEW_STARTER_SIGN_OFF',
  'NOTICE_GIVEN',
  'RETURN_FROM_LONG_ABSENCE',
] as const;
export type SurveyTriggerEvent = (typeof SURVEY_TRIGGER_EVENTS)[number];

/** Checks a survey can switch on, on top of the built-in ones each event always makes. */
export const SURVEY_TRIGGER_EXCLUSIONS = ['OPEN_SAFEGUARDING', 'OPEN_COMPLAINT', 'IN_HOSPITAL'] as const;
export type SurveyTriggerExclusion = (typeof SURVEY_TRIGGER_EXCLUSIONS)[number];

/** Who the survey goes to (the survey's audience). FAMILY = a public survey for families (an offer to make). */
export type TriggerAudience = 'SERVICE_USER' | 'EMPLOYEE' | 'FAMILY';

export const NEW_STARTER_REVIEW_TYPES = ['PROBATION_REVIEW', 'INDUCTION_CHECKIN', 'CARE_CERTIFICATE_SIGNOFF'] as const;
export type NewStarterReviewType = (typeof NEW_STARTER_REVIEW_TYPES)[number];

export type SurveyTriggerOptions = {
  /** CARE_REVIEW_DUE: only the first review after care starts (e.g. the 6-week review). */
  firstReviewOnly?: boolean;
  /** HOSPITAL_DISCHARGE: nights in hospital at least (default 1). */
  minNights?: number;
  /** COMPLAINT_CLOSED: whose complaint (SELF: the person themselves; FAMILY: a family member or representative). */
  complaintFrom?: 'SELF' | 'FAMILY';
  /** MEDICINES_CHANGE: changes in the first days of care are not counted (new package), default 42. */
  ignoreFirstDays?: number;
  /** NEW_STARTER_SIGN_OFF: which new-starter review, done (default PROBATION_REVIEW). */
  reviewType?: NewStarterReviewType;
  /** RETURN_FROM_LONG_ABSENCE: absence of at least this many days (default 28). */
  minDays?: number;
};

export type SurveyTriggerEventInfo = {
  label: string;
  /** Plain words: what CareFlow reads and when the event day is. */
  description: string;
  audiences: TriggerAudience[];
  /** Built-in checks, always made when the survey is due (shown to managers). */
  builtIn: string[];
  /** The delay may be negative (sent before the event day). */
  beforeAllowed?: boolean;
  /** The fewest days after the event it may be sent (e.g. never sooner than 6 weeks after a death). */
  minDelayDays?: number;
  /** An event that can happen again for the same person. */
  repeats: boolean;
};

export const SURVEY_TRIGGER_EVENT_INFO: Record<SurveyTriggerEvent, SurveyTriggerEventInfo> = {
  FIRST_VISIT: {
    label: 'First care visit',
    description: "The person's first care visit recorded as done.",
    audiences: ['SERVICE_USER'],
    builtIn: ['Not sent if the person has died or their care has ended'],
    repeats: false,
  },
  CARE_REVIEW_DUE: {
    label: 'Care plan review due',
    description: "A care plan's next review date. Can be sent before it (a negative number of days).",
    audiences: ['SERVICE_USER'],
    builtIn: ['Not sent if the person has died or their care has ended', 'Not sent if the review has been done or moved'],
    beforeAllowed: true,
    repeats: true,
  },
  HOSPITAL_DISCHARGE: {
    label: 'Home from hospital',
    description: 'The day a hospital stay recorded as an absence ("Hospitalised") ends.',
    audiences: ['SERVICE_USER'],
    builtIn: ['Not sent if the person has died, their care has ended, or they are back in hospital'],
    repeats: true,
  },
  COMPLAINT_CLOSED: {
    label: 'Complaint closed',
    description: 'The final response to a complaint, once the complaint is closed. Never for anonymous complaints.',
    audiences: ['SERVICE_USER', 'FAMILY'],
    builtIn: ['Not sent if the complaint has been reopened', 'Not sent if the person has died'],
    repeats: true,
  },
  MEDICINES_CHANGE: {
    label: 'Change to medicines',
    description: "A medicine added to or stopped on the person's record (not in the first weeks of a new package).",
    audiences: ['SERVICE_USER'],
    builtIn: ['Not sent if the person has died or their care has ended', 'One survey for several changes within 4 weeks'],
    repeats: true,
  },
  CARE_ENDED: {
    label: 'Care ended',
    description: "The person's care with us ending (status Discharged; the service end date if recorded).",
    audiences: ['SERVICE_USER'],
    builtIn: ['Never after a death'],
    repeats: false,
  },
  DEATH: {
    label: 'Death of a person we support',
    description: 'A death recorded on the person\'s record. Offered to the family: staff make the contact.',
    audiences: ['FAMILY'],
    builtIn: ['Always checked by staff first: never if the family asked us not to write', 'Never sooner than 6 weeks after the death'],
    // SUR-FAM-002 and POL-CD-011: between 6 and 8 weeks after the death, never sooner.
    minDelayDays: 42,
    repeats: false,
  },
  NEW_STARTER_SIGN_OFF: {
    label: 'New starter sign-off',
    description: "A new starter's probation, induction or Care Certificate sign-off recorded as done (the last milestone).",
    audiences: ['EMPLOYEE'],
    builtIn: ['Not sent if they have left'],
    repeats: false,
  },
  NOTICE_GIVEN: {
    label: 'Notice given',
    description: 'A leaving record added (notice accepted).',
    audiences: ['EMPLOYEE'],
    builtIn: ['Never after a death in service'],
    repeats: false,
  },
  RETURN_FROM_LONG_ABSENCE: {
    label: 'Back from a long absence',
    description: 'The first day back after sickness, maternity or paternity leave of at least 4 weeks (or the days chosen).',
    audiences: ['EMPLOYEE'],
    builtIn: ['Not sent if they have left, or the absence was made longer'],
    repeats: true,
  },
};

export const SURVEY_TRIGGER_EXCLUSION_INFO: Record<SurveyTriggerExclusion, { label: string; audiences: TriggerAudience[] }> = {
  OPEN_SAFEGUARDING: { label: 'An open safeguarding case about the person', audiences: ['SERVICE_USER', 'FAMILY'] },
  OPEN_COMPLAINT: { label: 'An open complaint about the person\'s care', audiences: ['SERVICE_USER', 'FAMILY'] },
  IN_HOSPITAL: { label: 'The person is in hospital', audiences: ['SERVICE_USER'] },
};

export const TRIGGER_DELAY_MIN = -60;
export const TRIGGER_DELAY_MAX = 120;
export const TRIGGER_WINDOW_MIN = 1;
export const TRIGGER_WINDOW_MAX = 60;
export const TRIGGER_LOOK_BACK_MAX = 90;

/** The library's structured trigger for a ready-made survey. */
export type LibraryEventTrigger = {
  event: SurveyTriggerEvent;
  /** Days after the event day the survey is due (negative: before). */
  delayDays: number;
  /** Days after the due day it may still be sent; after that the event is let go (EXPIRED). */
  windowDays: number;
  exclusions: SurveyTriggerExclusion[];
  options?: SurveyTriggerOptions;
  /** Staff check each one before it goes (things CareFlow cannot see, e.g. an Ombudsman review). */
  checkFirst: boolean;
};

export const LIBRARY_EVENT_TRIGGERS: Record<string, LibraryEventTrigger> = {
  // 5 to 7 days after the first visit.
  'SUR-PWS-001': { event: 'FIRST_VISIT', delayDays: 5, windowDays: 2, exclusions: ['IN_HOSPITAL'], checkFirst: false },
  // With the review notice at least 5 working days before the 6-week review: 10 to 7 days before it (7 calendar
  // days before any weekday is 5 working days).
  'SUR-PWS-002': { event: 'CARE_REVIEW_DUE', delayDays: -10, windowDays: 3, exclusions: ['IN_HOSPITAL'], options: { firstReviewOnly: true }, checkFirst: false },
  // 3 to 4 weeks after a change to medicines support; not for a new package.
  'SUR-PWS-005': { event: 'MEDICINES_CHANGE', delayDays: 21, windowDays: 7, exclusions: ['IN_HOSPITAL'], options: { ignoreFirstDays: 42 }, checkFirst: false },
  // Fourth week after the final response; never while Stage 2, Ombudsman, safeguarding, police or legal.
  'SUR-PWS-006': { event: 'COMPLAINT_CLOSED', delayDays: 21, windowDays: 6, exclusions: ['OPEN_SAFEGUARDING'], options: { complaintFrom: 'SELF' }, checkFirst: true },
  // 10 to 14 days after coming home from a stay of one night or more.
  'SUR-PWS-007': { event: 'HOSPITAL_DISCHARGE', delayDays: 10, windowDays: 4, exclusions: [], options: { minNights: 1 }, checkFirst: false },
  // About 10 working days after the last visit; never after a death.
  'SUR-PWS-008': { event: 'CARE_ENDED', delayDays: 14, windowDays: 7, exclusions: ['OPEN_SAFEGUARDING'], checkFirst: false },
  // Within 5 working days of the lone working sign-off (end of induction), confirmed by the office.
  'SUR-STF-003': { event: 'NEW_STARTER_SIGN_OFF', delayDays: 1, windowDays: 6, exclusions: [], options: { reviewType: 'INDUCTION_CHECKIN' }, checkFirst: true },
  // Within 5 working days after the probation outcome.
  'SUR-STF-004': { event: 'NEW_STARTER_SIGN_OFF', delayDays: 1, windowDays: 6, exclusions: [], options: { reviewType: 'PROBATION_REVIEW' }, checkFirst: false },
  // Within 2 working days of notice being accepted; never during an open disciplinary or safeguarding process.
  'SUR-STF-015': { event: 'NOTICE_GIVEN', delayDays: 1, windowDays: 3, exclusions: [], checkFirst: true },
  // About 20 working days after the first shift back after 4 weeks or more away.
  'SUR-STF-022': { event: 'RETURN_FROM_LONG_ABSENCE', delayDays: 28, windowDays: 7, exclusions: [], options: { minDays: 28 }, checkFirst: false },
  // Between 6 and 8 weeks after the death; staff make the contact.
  'SUR-FAM-002': { event: 'DEATH', delayDays: 42, windowDays: 14, exclusions: [], checkFirst: true },
  // Fourth week after the final response to a family member's complaint.
  'SUR-FAM-005': { event: 'COMPLAINT_CLOSED', delayDays: 21, windowDays: 6, exclusions: ['OPEN_SAFEGUARDING'], options: { complaintFrom: 'FAMILY' }, checkFirst: true },
};

/** Problems with the structured triggers against the library surveys (reference → audience, trigger words). */
export function validateLibraryEventTriggers(
  surveys: Array<{ reference: string; audience: string; timing: { trigger: string | null } }>,
): string[] {
  const errors: string[] = [];
  const byRef = new Map(surveys.map((s) => [s.reference, s]));
  for (const [ref, t] of Object.entries(LIBRARY_EVENT_TRIGGERS)) {
    const s = byRef.get(ref);
    if (!s) {
      errors.push(`${ref}: event trigger for a survey that is not in the library`);
      continue;
    }
    if (!s.timing.trigger) errors.push(`${ref}: event trigger but no timing.trigger words`);
    const info = SURVEY_TRIGGER_EVENT_INFO[t.event];
    if (!info) {
      errors.push(`${ref}: unknown event ${t.event}`);
      continue;
    }
    const audience: TriggerAudience = s.audience === 'PUBLIC' ? 'FAMILY' : (s.audience as TriggerAudience);
    if (!info.audiences.includes(audience)) errors.push(`${ref}: ${t.event} is not for ${s.audience} surveys`);
    if (t.delayDays < TRIGGER_DELAY_MIN || t.delayDays > TRIGGER_DELAY_MAX) errors.push(`${ref}: delayDays out of range`);
    if (t.delayDays < 0 && !info.beforeAllowed) errors.push(`${ref}: ${t.event} cannot be sent before the event`);
    if (info.minDelayDays !== undefined && t.delayDays < info.minDelayDays) errors.push(`${ref}: ${t.event} is never sent sooner than ${info.minDelayDays} days after it`);
    if (t.windowDays < TRIGGER_WINDOW_MIN || t.windowDays > TRIGGER_WINDOW_MAX) errors.push(`${ref}: windowDays out of range`);
    if (audience === 'FAMILY' && !t.checkFirst) errors.push(`${ref}: family surveys are offered by staff: checkFirst must be true`);
    for (const x of t.exclusions) {
      const xi = SURVEY_TRIGGER_EXCLUSION_INFO[x];
      if (!xi) errors.push(`${ref}: unknown exclusion ${x}`);
      else if (!xi.audiences.includes(audience)) errors.push(`${ref}: exclusion ${x} is not for ${s.audience} surveys`);
    }
  }
  return errors;
}
