/**
 * Referral rules: what kinds of email are handled automatically, and which care CareFlow notes, hands to a
 * manager or declines. Settings come from staff (Referral inbox → Settings → Rules); never from an email.
 * See docs/REFERRAL_RULES_PLAN.md.
 */
import type { ReferralCheck } from './referral-checks.util';
import { careWeMayNotProvide, dayIndexes } from './referral-checks.util';
import type { CareFlag, ReferralExtraction } from './referral-extraction.service';

/* ─── kinds of email ─────────────────────────────────────────── */

export const EMAIL_KINDS = [
  'NEW_REFERRAL',
  'BROKERAGE_OFFER',
  'PRIVATE_ENQUIRY',
  'PRICE_ENQUIRY',
  'GENERAL_QUESTION',
  'FOLLOW_UP',
  'REFERRAL_WITHDRAWN',
  'EXISTING_CLIENT',
  'COMPLAINT',
  'SAFEGUARDING_CONCERN',
  'JOB_APPLICATION',
  'SUPPLIER_OR_MARKETING',
  'OTHER',
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** AUTO: checks, enquiry and reply. STAFF: recorded and checked, never an automatic reply. IGNORE: kept, nothing done. */
export type KindAction = 'AUTO' | 'STAFF' | 'IGNORE';

export const EMAIL_KIND_INFO: Record<EmailKind, { label: string; hint: string; defaultAction: KindAction; newCare: boolean }> = {
  NEW_REFERRAL: { label: 'New referral from a professional', hint: 'Council, NHS, hospital, GP or another provider asks us to take on care.', defaultAction: 'AUTO', newCare: true },
  BROKERAGE_OFFER: { label: 'Package offered to several providers', hint: 'A brokerage team sends a package to many providers, often with a reply-by time.', defaultAction: 'AUTO', newCare: true },
  PRIVATE_ENQUIRY: { label: 'Enquiry from the person or family', hint: 'Someone asks for care for themselves or a relative.', defaultAction: 'AUTO', newCare: true },
  PRICE_ENQUIRY: { label: 'Price question only', hint: 'Mainly asks what we charge, with few care details.', defaultAction: 'AUTO', newCare: true },
  GENERAL_QUESTION: { label: 'Other question about our care', hint: 'Areas we cover, services we offer, availability.', defaultAction: 'AUTO', newCare: true },
  FOLLOW_UP: { label: 'More about a referral we already have', hint: 'Extra information, an answer to our questions, a chase.', defaultAction: 'STAFF', newCare: false },
  REFERRAL_WITHDRAWN: { label: 'Referral withdrawn or placed elsewhere', hint: 'No longer needed, placed with another provider, person died or went into a home.', defaultAction: 'STAFF', newCare: false },
  EXISTING_CLIENT: { label: 'About someone we already care for', hint: 'Changes to visits, a hospital stay, cancelled visits, a review.', defaultAction: 'STAFF', newCare: false },
  COMPLAINT: { label: 'Complaint', hint: 'Unhappy with our care or staff.', defaultAction: 'STAFF', newCare: false },
  SAFEGUARDING_CONCERN: { label: 'Safeguarding concern', hint: 'Abuse, neglect or a safeguarding enquiry about someone.', defaultAction: 'STAFF', newCare: false },
  JOB_APPLICATION: { label: 'Job application', hint: 'Someone applying to work for us.', defaultAction: 'IGNORE', newCare: false },
  SUPPLIER_OR_MARKETING: { label: 'Supplier, advert or newsletter', hint: 'Sales emails, invoices, newsletters, training offers.', defaultAction: 'IGNORE', newCare: false },
  OTHER: { label: 'Anything else', hint: 'Not about care for a person.', defaultAction: 'IGNORE', newCare: false },
};

/** The kind for emails read before kinds existed. */
export function emailKindOf(e: Pick<ReferralExtraction, 'emailKind' | 'requestType' | 'isReferral' | 'funding'>): EmailKind {
  if (e.emailKind && (EMAIL_KINDS as readonly string[]).includes(e.emailKind)) return e.emailKind;
  if (!e.isReferral || e.requestType === 'NOT_CARE') return 'OTHER';
  if (e.requestType === 'PRICE_ENQUIRY') return 'PRICE_ENQUIRY';
  if (e.requestType === 'GENERAL_QUESTION') return 'GENERAL_QUESTION';
  return e.funding?.type === 'PRIVATE' ? 'PRIVATE_ENQUIRY' : 'NEW_REFERRAL';
}

/* ─── rules ──────────────────────────────────────────────────── */

/** OFF: not checked. NOTE: shown to staff only. MANAGER: a manager decides, no automatic reply. DECLINE: "Can't take it". */
export type RuleOutcome = 'OFF' | 'NOTE' | 'MANAGER' | 'DECLINE';
export const RULE_OUTCOMES: RuleOutcome[] = ['OFF', 'NOTE', 'MANAGER', 'DECLINE'];

export type RuleValueKind = 'minutes' | 'time' | 'hours' | 'age' | 'count';

export type RuleDef = {
  key: string;
  group: 'Type of care' | 'Health and tasks' | 'Person' | 'Safety' | 'Visits' | 'Timing' | 'Funding';
  label: string;
  hint: string;
  defaultOutcome: RuleOutcome;
  value?: { kind: RuleValueKind; default: number | string; label: string };
};

export const RULE_CATALOG: RuleDef[] = [
  { key: 'liveIn', group: 'Type of care', label: 'Live-in care', hint: 'A carer living in the person’s home.', defaultOutcome: 'MANAGER' },
  { key: 'sleepingNight', group: 'Type of care', label: 'Sleeping nights', hint: 'A carer sleeps over, woken only if needed.', defaultOutcome: 'MANAGER' },
  { key: 'wakingNight', group: 'Type of care', label: 'Waking nights', hint: 'A carer awake all night.', defaultOutcome: 'MANAGER' },
  { key: 'twentyFourHour', group: 'Type of care', label: '24-hour care', hint: 'Care round the clock.', defaultOutcome: 'MANAGER' },
  { key: 'endOfLife', group: 'Type of care', label: 'End of life / fast track', hint: 'Palliative care, NHS fast-track packages.', defaultOutcome: 'MANAGER' },
  { key: 'respite', group: 'Type of care', label: 'Short-term respite', hint: 'Cover while the usual carer has a break.', defaultOutcome: 'NOTE' },
  { key: 'reablement', group: 'Type of care', label: 'Reablement', hint: 'Short-term care to regain independence, usually up to 6 weeks.', defaultOutcome: 'NOTE' },
  { key: 'domesticOnly', group: 'Type of care', label: 'Domestic help only', hint: 'Cleaning, laundry, shopping; no personal care.', defaultOutcome: 'NOTE' },
  { key: 'companionshipOnly', group: 'Type of care', label: 'Companionship or sitting only', hint: 'Company and supervision; no personal care.', defaultOutcome: 'NOTE' },
  { key: 'escort', group: 'Type of care', label: 'Escorting or outings', hint: 'Taking the person to appointments or out in the community.', defaultOutcome: 'NOTE' },

  { key: 'delegatedHealthcare', group: 'Health and tasks', label: 'Delegated healthcare tasks', hint: 'Insulin, PEG feeding, catheter or stoma care, oxygen, wound care: need a nurse to delegate, training and a competency check.', defaultOutcome: 'MANAGER' },
  { key: 'complexClinical', group: 'Health and tasks', label: 'Complex clinical care', hint: 'Tracheostomy, suction, ventilation, IV lines, injections other than insulin.', defaultOutcome: 'MANAGER' },
  { key: 'medicationAdminister', group: 'Health and tasks', label: 'Giving medicines', hint: 'Carers administer medicines (not just prompting).', defaultOutcome: 'NOTE' },
  { key: 'timeCriticalMeds', group: 'Health and tasks', label: 'Time-critical medicines', hint: 'e.g. Parkinson’s medicines that must be given at exact times.', defaultOutcome: 'NOTE' },
  { key: 'hoist', group: 'Health and tasks', label: 'Hoist transfers', hint: 'Moving the person with a hoist.', defaultOutcome: 'NOTE' },
  { key: 'doubleHanded', group: 'Health and tasks', label: 'Two carers at a visit', hint: 'Double-handed visits.', defaultOutcome: 'NOTE' },
  { key: 'bariatric', group: 'Health and tasks', label: 'Bariatric care', hint: 'Needs bariatric equipment or extra moving and handling.', defaultOutcome: 'MANAGER' },
  { key: 'dementia', group: 'Health and tasks', label: 'Dementia', hint: 'Dementia or memory loss.', defaultOutcome: 'NOTE' },
  { key: 'mentalHealth', group: 'Health and tasks', label: 'Serious mental illness', hint: 'e.g. schizophrenia, bipolar disorder, recent detention.', defaultOutcome: 'NOTE' },
  { key: 'learningDisability', group: 'Health and tasks', label: 'Learning disability or autism', hint: '', defaultOutcome: 'NOTE' },
  { key: 'behaviour', group: 'Health and tasks', label: 'Behaviour that challenges', hint: 'Aggression, violence or distressed behaviour.', defaultOutcome: 'MANAGER' },
  { key: 'substanceMisuse', group: 'Health and tasks', label: 'Alcohol or drug use', hint: 'Current alcohol or drug misuse.', defaultOutcome: 'MANAGER' },

  { key: 'minAge', group: 'Person', label: 'Younger than', hint: 'Personal care for children needs the right CQC registration.', defaultOutcome: 'MANAGER', value: { kind: 'age', default: 18, label: 'years' } },
  { key: 'maxAge', group: 'Person', label: 'Older than', hint: '', defaultOutcome: 'OFF', value: { kind: 'age', default: 100, label: 'years' } },
  { key: 'noAccess', group: 'Person', label: 'No way for carers to get in', hint: 'No key safe and nobody to let carers in.', defaultOutcome: 'NOTE' },

  { key: 'safeguarding', group: 'Safety', label: 'Open safeguarding concern', hint: 'A safeguarding enquiry or concern about the person.', defaultOutcome: 'MANAGER' },
  { key: 'risksToStaff', group: 'Safety', label: 'Risks to staff at the home', hint: 'Aggressive dogs, hoarding, smoking, unsafe building or area, lone-working risks.', defaultOutcome: 'MANAGER' },
  { key: 'infection', group: 'Safety', label: 'Infection needing extra precautions', hint: 'e.g. MRSA, C. difficile, TB.', defaultOutcome: 'NOTE' },

  { key: 'shortVisits', group: 'Visits', label: 'Visits shorter than', hint: 'NICE: visits should normally be at least 30 minutes.', defaultOutcome: 'MANAGER', value: { kind: 'minutes', default: 30, label: 'minutes' } },
  { key: 'earlyVisits', group: 'Visits', label: 'Visits starting before', hint: '', defaultOutcome: 'MANAGER', value: { kind: 'time', default: '07:00', label: '' } },
  { key: 'lateVisits', group: 'Visits', label: 'Visits finishing after', hint: '', defaultOutcome: 'MANAGER', value: { kind: 'time', default: '22:00', label: '' } },
  { key: 'minHours', group: 'Visits', label: 'Fewer hours a week than', hint: 'Small packages that are hard to staff.', defaultOutcome: 'OFF', value: { kind: 'hours', default: 3, label: 'hours' } },
  { key: 'maxHours', group: 'Visits', label: 'More hours a week than', hint: 'Large packages that need several carers.', defaultOutcome: 'OFF', value: { kind: 'hours', default: 50, label: 'hours' } },
  { key: 'maxVisitsPerDay', group: 'Visits', label: 'More visits a day than', hint: '', defaultOutcome: 'OFF', value: { kind: 'count', default: 4, label: 'visits' } },

  { key: 'urgentStart', group: 'Timing', label: 'Care needed today or tomorrow', hint: 'Emergency starts.', defaultOutcome: 'MANAGER' },
  { key: 'hospitalDischarge', group: 'Timing', label: 'Hospital discharge', hint: 'The person is waiting to leave hospital.', defaultOutcome: 'NOTE' },

  { key: 'fundCouncil', group: 'Funding', label: 'Council funded', hint: '', defaultOutcome: 'OFF' },
  { key: 'fundNhs', group: 'Funding', label: 'NHS funded (continuing healthcare)', hint: 'CHC packages are usually reviewed by a senior clinician first.', defaultOutcome: 'OFF' },
  { key: 'fundDirectPayment', group: 'Funding', label: 'Direct payments', hint: '', defaultOutcome: 'OFF' },
  { key: 'fundPrivate', group: 'Funding', label: 'Paying privately', hint: '', defaultOutcome: 'OFF' },
  { key: 'fundUnknown', group: 'Funding', label: 'Funding not known', hint: '', defaultOutcome: 'OFF' },
];

const CATALOG = new Map(RULE_CATALOG.map((r) => [r.key, r]));

/** One saved rule: for all branches (locationId null) or one branch, which wins for that branch. */
export type RuleSetting = { key: string; outcome: RuleOutcome; value?: number | string | null; locationId?: string | null };
/** A rule written by staff. Claude checks emails against it; it can never decline. */
export type CustomRule = { id: string; text: string; outcome: 'NOTE' | 'MANAGER'; locationId: string | null; isActive: boolean };
export type ReferralRules = { kinds: Partial<Record<EmailKind, KindAction>>; rules: RuleSetting[]; custom: CustomRule[] };

const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Saved JSON → valid rules (unknown keys, bad values and declining custom rules are dropped). */
export function normaliseRules(raw: unknown): ReferralRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReferralRules>;
  const kinds: Partial<Record<EmailKind, KindAction>> = {};
  for (const [k, v] of Object.entries(r.kinds ?? {})) {
    if ((EMAIL_KINDS as readonly string[]).includes(k) && ['AUTO', 'STAFF', 'IGNORE'].includes(v as string)) kinds[k as EmailKind] = v as KindAction;
  }
  const seen = new Set<string>();
  const rules: RuleSetting[] = [];
  for (const s of Array.isArray(r.rules) ? r.rules : []) {
    const def = CATALOG.get(s?.key);
    if (!def || !RULE_OUTCOMES.includes(s.outcome)) continue;
    const locationId = typeof s.locationId === 'string' && s.locationId ? s.locationId : null;
    const id = `${s.key}|${locationId ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let value: number | string | null = null;
    if (def.value) {
      if (def.value.kind === 'time') value = isTime(s.value) ? s.value : def.value.default;
      else {
        const n = Number(s.value);
        value = Number.isFinite(n) && n >= 0 && n <= 1000 ? n : def.value.default;
      }
    }
    rules.push({ key: s.key, outcome: s.outcome, value, locationId });
  }
  const custom: CustomRule[] = (Array.isArray(r.custom) ? r.custom : [])
    .filter((c) => c && typeof c.text === 'string' && c.text.trim())
    .slice(0, 50)
    .map((c, i) => ({
      id: typeof c.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) ? c.id : `r${i + 1}`,
      text: c.text.trim().slice(0, 500),
      outcome: c.outcome === 'MANAGER' ? 'MANAGER' : 'NOTE',
      locationId: typeof c.locationId === 'string' && c.locationId ? c.locationId : null,
      isActive: c.isActive !== false,
    }));
  return { kinds, rules, custom };
}

export function kindAction(rules: ReferralRules, kind: EmailKind): KindAction {
  return rules.kinds[kind] ?? EMAIL_KIND_INFO[kind].defaultAction;
}

/** The rule as it applies to a branch: the branch's own setting, else the all-branches one, else the default. */
export function effectiveRule(rules: ReferralRules, key: string, locationId: string | null): { outcome: RuleOutcome; value: number | string | null } {
  const def = CATALOG.get(key)!;
  const own = locationId ? rules.rules.find((r) => r.key === key && r.locationId === locationId) : undefined;
  const all = rules.rules.find((r) => r.key === key && !r.locationId);
  const s = own ?? all;
  return { outcome: s?.outcome ?? def.defaultOutcome, value: s?.value ?? def.value?.default ?? null };
}

/* ─── checking an email against the rules ────────────────────── */

const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Age in whole years on a date, from YYYY-MM-DD; null when not given. */
export function ageOn(dob: string | null | undefined, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dob ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < mo || (today.getUTCMonth() + 1 === mo && today.getUTCDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** What the email shows for each rule: the evidence in words, or null when the rule doesn't apply. */
function findings(e: ReferralExtraction, rule: (key: string) => { value: number | string | null }, today: Date): Record<string, string | null> {
  const f = e.careFlags;
  const has = (flag: CareFlag) => Boolean(f?.present?.includes(flag));
  const visits = e.visits ?? [];
  const yes = (b: boolean | undefined, text: string) => (b ? text : null);
  const list = (items: string[] | undefined) => (items?.length ? items.join(', ') : null);
  const out: Record<string, string | null> = {};

  if (f) {
    out.liveIn = yes(has('liveIn'), 'Live-in care asked for.');
    out.sleepingNight = yes(has('sleepingNight'), 'Sleeping nights asked for.');
    out.wakingNight = yes(has('wakingNight'), 'Waking nights asked for.');
    out.twentyFourHour = yes(has('twentyFourHour'), '24-hour care asked for.');
    out.endOfLife = yes(has('endOfLife'), 'End of life or fast-track care.');
    out.respite = yes(has('respite'), 'Respite care.');
    out.reablement = yes(has('reablement'), 'Reablement.');
    out.domesticOnly = yes(has('domesticOnly'), 'Domestic help only, no personal care.');
    out.companionshipOnly = yes(has('companionshipOnly'), 'Companionship or sitting only.');
    out.escort = yes(has('escort'), 'Escorting or outings.');
    out.delegatedHealthcare = list(f.delegatedHealthcare);
    out.complexClinical = list(f.complexClinical);
    out.medicationAdminister = yes(f.medicationLevel === 'ADMINISTER', 'Carers to give medicines.');
    out.timeCriticalMeds = yes(has('timeCriticalMedicines'), 'Time-critical medicines.');
    out.hoist = yes(has('hoist'), 'Hoist transfers.');
    out.bariatric = yes(has('bariatric'), 'Bariatric care.');
    out.dementia = yes(has('dementia'), 'Dementia.');
    out.mentalHealth = yes(has('seriousMentalIllness'), 'Serious mental illness.');
    out.learningDisability = yes(has('learningDisabilityOrAutism'), 'Learning disability or autism.');
    out.behaviour = yes(has('behaviourThatChallenges'), 'Behaviour that challenges.');
    out.substanceMisuse = yes(has('substanceMisuse'), 'Alcohol or drug use.');
    out.noAccess = yes(has('noAccessArrangement'), 'No key safe or anyone to let carers in.');
    out.safeguarding = yes(has('safeguardingConcern'), 'A safeguarding concern is mentioned.');
    out.risksToStaff = list(f.risksToStaff);
    out.infection = f.infectionControl?.trim() || null;
    out.hospitalDischarge = yes(has('hospitalDischarge'), 'Hospital discharge.');
  } else {
    // Emails read before the care flags existed: the old wording checks.
    const special = careWeMayNotProvide(`${e.careNeeds ?? ''} ${e.summary ?? ''}`);
    out.liveIn = special.includes('Live-in care') ? 'Live-in care asked for.' : null;
    out.twentyFourHour = special.includes('24-hour or night care') ? '24-hour or night care asked for.' : null;
    out.delegatedHealthcare = special.includes('Clinical or nursing tasks') ? 'Clinical or nursing tasks.' : null;
  }

  // Two carers: from the visits as well as the flags.
  const doubles = visits.filter((v) => (v.carers ?? 1) >= 2).map((v) => v.label || 'a visit');
  out.doubleHanded = doubles.length ? `Two carers at ${doubles.join(', ')}.` : yes(has('doubleHanded'), 'Two carers at some visits.');

  // Age: date of birth, else the age the email gives, else the old "a child" wording.
  const age = ageOn(e.person?.dateOfBirth, today) ?? (f?.ageYears && f.ageYears > 0 ? f.ageYears : null);
  const childWording = !f && careWeMayNotProvide(`${e.careNeeds ?? ''} ${e.summary ?? ''}`).includes('Care for a child');
  const minAge = Number(rule('minAge').value);
  out.minAge = age != null ? (age < minAge ? `Aged ${age}.` : null) : childWording ? 'A child.' : null;
  const maxAge = Number(rule('maxAge').value);
  out.maxAge = age != null && age > maxAge ? `Aged ${age}.` : null;

  // Visits.
  const minVisit = Number(rule('shortVisits').value);
  const short = visits.filter((v) => v.durationMinutes > 0 && v.durationMinutes < minVisit);
  out.shortVisits = short.length ? short.map((v) => `${v.label || 'Visit'} ${v.durationMinutes} min`).join(', ') : null;
  const early = toMinutes(String(rule('earlyVisits').value)) ?? 0;
  const earlyOnes = visits.filter((v) => (toMinutes(v.startTime ?? '') ?? 24 * 60) < early);
  out.earlyVisits = earlyOnes.length ? earlyOnes.map((v) => `${v.label || 'Visit'} at ${v.startTime}`).join(', ') : null;
  const late = toMinutes(String(rule('lateVisits').value)) ?? 24 * 60;
  const lateOnes = visits.filter((v) => {
    const s = toMinutes(v.startTime ?? '');
    return s != null && s + (v.durationMinutes || 30) > late;
  });
  out.lateVisits = lateOnes.length ? lateOnes.map((v) => `${v.label || 'Visit'} at ${v.startTime} for ${v.durationMinutes || 30} min`).join(', ') : null;

  const weeklyMinutes = visits.reduce((sum, v) => sum + (v.durationMinutes || 0) * dayIndexes(v.days ?? []).length * Math.max(1, v.carers || 1), 0);
  const statedHours = Number(String(e.care?.hoursPerWeek ?? '').replace(/[^\d.]/g, ''));
  const hours = weeklyMinutes > 0 ? Math.round((weeklyMinutes / 60) * 10) / 10 : Number.isFinite(statedHours) && statedHours > 0 ? statedHours : null;
  out.minHours = hours != null && hours < Number(rule('minHours').value) ? `${hours} carer hours a week.` : null;
  out.maxHours = hours != null && hours > Number(rule('maxHours').value) ? `${hours} carer hours a week.` : null;
  const perDay = Number(String(e.care?.visitsPerDay ?? '').replace(/[^\d]/g, '')) || 0;
  const maxPerDay = Math.max(perDay, ...[0, 1, 2, 3, 4, 5, 6].map((d) => visits.filter((v) => dayIndexes(v.days ?? []).includes(d)).length));
  out.maxVisitsPerDay = maxPerDay > Number(rule('maxVisitsPerDay').value) ? `${maxPerDay} visits a day.` : null;

  // Timing.
  const start = (e.care?.requestedStartDate ?? '').trim();
  const startDays = /^\d{4}-\d{2}-\d{2}$/.test(start)
    ? Math.round((Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10)) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000)
    : null;
  out.urgentStart =
    e.urgency === 'EMERGENCY' ? 'Marked as an emergency.' : startDays != null && startDays >= 0 && startDays <= 1 ? `Start ${start}.` : null;

  // Funding.
  const ft = e.funding?.type;
  out.fundCouncil = ft === 'LOCAL_AUTHORITY' || ft === 'MIXED' ? 'Council funded.' : null;
  out.fundNhs = ft === 'NHS' ? 'NHS funded.' : null;
  out.fundDirectPayment = ft === 'DIRECT_PAYMENT' ? 'Direct payments.' : null;
  out.fundPrivate = ft === 'PRIVATE' ? 'Paying privately.' : null;
  out.fundUnknown = !ft || ft === 'UNKNOWN' ? 'Funding not given.' : null;
  return out;
}

const OUTCOME_WORDS: Record<Exclude<RuleOutcome, 'OFF'>, string> = {
  NOTE: 'noted',
  MANAGER: 'a manager decides',
  DECLINE: 'we don’t take this',
};

/** The rule label with its value, e.g. "Visits shorter than 30 minutes". */
export function ruleLabel(def: RuleDef, value: number | string | null): string {
  return def.value && value != null && value !== '' ? `${def.label} ${value}${def.value.label ? ` ${def.value.label}` : ''}` : def.label;
}

/**
 * The checks the rules add for one email, for the branch it belongs to:
 * - DECLINE → FAIL (key "rule:…"): the decision is "Can't take it".
 * - MANAGER → WARN (key "rule:…"): at most "Possibly", and no automatic reply.
 * - NOTE → WARN (key "note:…"): shown to staff only; changes nothing.
 * Custom rules Claude found broken are added the same way (never FAIL).
 */
export function ruleChecks(e: ReferralExtraction, rules: ReferralRules, locationId: string | null, today = new Date()): ReferralCheck[] {
  const rule = (key: string) => effectiveRule(rules, key, locationId);
  const found = findings(e, rule, today);
  const checks: ReferralCheck[] = [];
  for (const def of RULE_CATALOG) {
    const { outcome, value } = rule(def.key);
    const evidence = found[def.key];
    if (outcome === 'OFF' || !evidence) continue;
    checks.push({
      key: `${outcome === 'NOTE' ? 'note' : 'rule'}:${def.key}`,
      label: ruleLabel(def, value),
      result: outcome === 'DECLINE' ? 'FAIL' : 'WARN',
      detail: `${evidence.replace(/\.$/, '')} (${OUTCOME_WORDS[outcome]}).`,
    });
  }
  const active = new Map(rules.custom.filter((c) => c.isActive && (!c.locationId || c.locationId === locationId)).map((c) => [c.id, c]));
  for (const m of e.houseRuleMatches ?? []) {
    const c = active.get(m.ruleId);
    if (!c) continue;
    active.delete(m.ruleId);
    checks.push({
      key: `${c.outcome === 'MANAGER' ? 'rule' : 'note'}:custom:${c.id}`,
      label: `Our rule: ${(c.text.length > 80 ? `${c.text.slice(0, 77)}…` : c.text).replace(/[.\s]+$/, '')}`,
      result: 'WARN',
      detail: `${(m.reason || 'Claude found this rule applies').replace(/\.$/, '')} (${OUTCOME_WORDS[c.outcome]}).`,
    });
  }
  return checks;
}

/** The custom rules Claude should check an email against (all branches' rules; filtered by branch later). */
export function houseRulesForReading(rules: ReferralRules): Array<{ id: string; text: string }> {
  return rules.custom.filter((c) => c.isActive).map((c) => ({ id: c.id, text: c.text }));
}
