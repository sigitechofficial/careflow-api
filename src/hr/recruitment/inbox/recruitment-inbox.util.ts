import type { EmploymentHistoryEntry } from '../utils/recruitment-flow.util';
import { AUTOMATED_SENDER, JUNK_SUBJECT, senderMatches, type ScreeningSettings } from '../../../referral-mailbox/referral-screening.util';

type YesNo = 'YES' | 'NO' | 'UNKNOWN';

/** What Claude reads from a job application email and its CV. Strings are empty when not given. */
export type ApplicationExtraction = {
  isApplication: boolean;
  summary: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  vacancyId: string;
  vacancyReason: string;
  rightToWork: YesNo;
  drivesForWork: YesNo;
  coverLetter: string;
  employmentHistory: {
    kind: 'JOB' | 'GAP';
    from: string;
    to: string;
    ongoing: boolean;
    employer: string;
    jobTitle: string;
    reasonForLeaving: string;
    careRole: boolean;
    explanation: string;
  }[];
  cvFileName: string;
  checkNotes: string[];
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * The CV's jobs as employment history rows. Rows without a usable start month, or without an end month that is not
 * their current job, can't be saved as they are: they are counted so staff add them on the candidate.
 */
export function historyFromExtraction(rows: ApplicationExtraction['employmentHistory'] | undefined): {
  entries: EmploymentHistoryEntry[];
  incomplete: number;
} {
  const entries: EmploymentHistoryEntry[] = [];
  let incomplete = 0;
  for (const r of rows ?? []) {
    const from = r.from?.trim() ?? '';
    const to = r.to?.trim() ?? '';
    if (!MONTH.test(from) || (!r.ongoing && !MONTH.test(to)) || (MONTH.test(to) && to < from)) {
      incomplete += 1;
      continue;
    }
    entries.push(
      r.kind === 'GAP'
        ? { kind: 'GAP', from, to: r.ongoing ? null : to, explanation: r.explanation?.trim() || null }
        : {
            kind: 'JOB',
            from,
            to: r.ongoing ? null : to,
            employer: r.employer?.trim() || null,
            jobTitle: r.jobTitle?.trim() || null,
            reasonForLeaving: r.reasonForLeaving?.trim() || null,
            careRole: Boolean(r.careRole),
          },
    );
  }
  // Oldest first, like the history editor.
  entries.sort((a, b) => a.from.localeCompare(b.from));
  return { entries, incomplete };
}

export const yesNoToBool = (v: YesNo | undefined): boolean | null => (v === 'YES' ? true : v === 'NO' ? false : null);

/** "Jane Smith" from the email's From name when Claude found no name. */
export function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (fullName ?? '').replace(/["<>]/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/** Words that make an email look like someone applying for a job (subject or body). */
const JOB_WORDS =
  /\b(appl(y|ying|ied|ication|icant)|cv|r[eé]sum[eé]|cover letter|vacanc(y|ies)|vac-\d+|job|position|role|candidate|interview|care (worker|assistant)|carer|support worker|right to work|availability)\b/i;

/** Job boards' alerts and suggestions to job seekers ("20 more laravel jobs", jobalert.indeed.com): not applications. */
const JOB_ALERT_SUBJECT = /\b(job alerts?|jobs? (for|near) you|recommended jobs|new jobs|\d+ (more|new) [a-z ]*jobs)\b/i;
const JOB_ALERT_SENDER = /@(jobalerts?|match)\./i;

/** Files a CV comes in. */
const CV_FILE = /\.(pdf|docx?|odt|rtf|pages)$/i;

/* ─── rules: what an application must show ─── */

/** OFF: not checked. NOTE: shown to staff. STAFF: staff decide (no automatic candidate). DECLINE: set aside when the answer is no. */
export type RecruitmentRuleOutcome = 'OFF' | 'NOTE' | 'STAFF' | 'DECLINE';
export const RECRUITMENT_RULE_OUTCOMES: RecruitmentRuleOutcome[] = ['OFF', 'NOTE', 'STAFF', 'DECLINE'];

export const RECRUITMENT_RULES = [
  { key: 'rightToWork', label: 'Right to work in the UK', defaultOutcome: 'NOTE' },
  { key: 'drivesForWork', label: 'Drives for work (licence and car)', defaultOutcome: 'OFF' },
  { key: 'careExperience', label: 'Care experience', defaultOutcome: 'OFF' },
] as const satisfies readonly { key: string; label: string; defaultOutcome: RecruitmentRuleOutcome }[];
export type RecruitmentRuleKey = (typeof RECRUITMENT_RULES)[number]['key'];
export type RecruitmentRules = Record<RecruitmentRuleKey, RecruitmentRuleOutcome>;

export function normaliseRecruitmentRules(raw: unknown): RecruitmentRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(
    RECRUITMENT_RULES.map((d) => [d.key, RECRUITMENT_RULE_OUTCOMES.includes(r[d.key] as RecruitmentRuleOutcome) ? r[d.key] : d.defaultOutcome]),
  ) as RecruitmentRules;
}

export type RuleCheck = { key: RecruitmentRuleKey; label: string; answer: YesNo; outcome: RecruitmentRuleOutcome; met: boolean };

/**
 * The rules against what Claude read. Not stated (UNKNOWN) is never a decline: staff ask. `declined` is the first
 * rule answered "no" that declines; `hold` the first one that needs staff (no automatic candidate).
 */
export function checkApplication(x: Pick<ApplicationExtraction, 'rightToWork' | 'drivesForWork' | 'employmentHistory'>, rules: RecruitmentRules): {
  checks: RuleCheck[];
  declined: string | null;
  hold: string | null;
} {
  const jobs = (x.employmentHistory ?? []).filter((e) => e.kind === 'JOB');
  const answers: Record<RecruitmentRuleKey, YesNo> = {
    rightToWork: x.rightToWork ?? 'UNKNOWN',
    drivesForWork: x.drivesForWork ?? 'UNKNOWN',
    careExperience: jobs.some((j) => j.careRole) ? 'YES' : jobs.length ? 'NO' : 'UNKNOWN',
  };
  const checks = RECRUITMENT_RULES.filter((d) => rules[d.key] !== 'OFF').map((d) => ({
    key: d.key,
    label: d.label,
    answer: answers[d.key],
    outcome: rules[d.key],
    met: answers[d.key] === 'YES',
  }));
  const declinedBy = checks.find((c) => c.outcome === 'DECLINE' && c.answer === 'NO');
  const heldBy = checks.find((c) => !c.met && (c.outcome === 'STAFF' || c.outcome === 'DECLINE'));
  const describe = (c: RuleCheck) => `${c.label}: ${c.answer === 'NO' ? 'no' : 'not stated'}`;
  return { checks, declined: declinedBy ? describe(declinedBy) : null, hold: heldBy ? describe(heldBy) : null };
}

/** Recruitment inbox screening when nothing is saved: rules, then the quick check; no trusted or blocked senders yet. */
export const DEFAULT_RECRUITMENT_SCREENING: ScreeningSettings = { mode: 'RULES_AND_AI', trustedSenders: [], blockedSenders: [] };

/**
 * Free rules before Claude reads an email, so obvious junk (receipts, newsletters, no-reply notices) costs nothing.
 * Same settings as the referral inbox: trusted senders and people who applied before are always read; blocked
 * senders, junk and job alerts are set aside unread, with the reason; emails that mention a job or carry a CV-like
 * file are read. Anything else is UNSURE: the quick check decides, or (rules only) it is read.
 * A set-aside email can still be read with "Read again".
 */
export function screenApplicationByRules(
  email: { fromEmail: string | null; subject: string | null; bodyText: string; attachments: { fileName: string }[] },
  settings: ScreeningSettings = DEFAULT_RECRUITMENT_SCREENING,
  ctx: { knownSender: boolean } = { knownSender: false },
): { decision: 'READ' | 'SKIP' | 'UNSURE'; reason: string } {
  if (settings.mode === 'OFF') return { decision: 'READ', reason: 'Screening is off' };
  const from = (email.fromEmail ?? '').trim().toLowerCase();
  const subject = email.subject ?? '';
  const body = email.bodyText ?? '';
  const trusted = from ? senderMatches(from, settings.trustedSenders) : null;
  if (trusted) return { decision: 'READ', reason: `Trusted sender (${trusted})` };
  if (ctx.knownSender) return { decision: 'READ', reason: 'Has applied to us before' };
  const blocked = from ? senderMatches(from, settings.blockedSenders) : null;
  if (blocked) return { decision: 'SKIP', reason: `Blocked sender (${blocked})` };
  if (JUNK_SUBJECT.test(subject) && !JOB_WORDS.test(subject)) return { decision: 'SKIP', reason: 'Subject is a newsletter, alert, receipt or offer' };
  const cv = email.attachments.find((a) => CV_FILE.test(a.fileName));
  if (!cv && (JOB_ALERT_SUBJECT.test(subject) || JOB_ALERT_SENDER.test(from))) return { decision: 'SKIP', reason: 'Job alert or job board advert' };
  if (JOB_WORDS.test(subject) || JOB_WORDS.test(body.slice(0, 3000))) return { decision: 'READ', reason: 'Mentions a job or application' };
  if (cv) return { decision: 'READ', reason: `Has a document attached (${cv.fileName})` };
  if (from && AUTOMATED_SENDER.test(from)) return { decision: 'SKIP', reason: 'Automated sender (no-reply, notifications…)' };
  if (/\bunsubscribe\b/i.test(body)) return { decision: 'SKIP', reason: 'Mailing list (has an unsubscribe link)' };
  return { decision: 'UNSURE', reason: 'No clear sign either way' };
}
