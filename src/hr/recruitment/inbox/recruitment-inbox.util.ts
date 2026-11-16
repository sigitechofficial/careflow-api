import type { EmploymentHistoryEntry } from '../utils/recruitment-flow.util';
import { AUTOMATED_SENDER, JUNK_SUBJECT } from '../../../referral-mailbox/referral-screening.util';

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

/**
 * Free rules before Claude reads an email, so obvious junk (receipts, newsletters, no-reply notices) costs nothing.
 * Claude reads only emails that mention a job or carry a CV-like file; the rest is set aside unread, with the reason.
 * A set-aside email can still be read with "Read again".
 */
export function screenApplicationByRules(email: {
  fromEmail: string | null;
  subject: string | null;
  bodyText: string;
  attachments: { fileName: string }[];
}): { decision: 'READ' | 'SKIP'; reason: string } {
  const from = (email.fromEmail ?? '').trim().toLowerCase();
  const subject = email.subject ?? '';
  const body = email.bodyText ?? '';
  if (JUNK_SUBJECT.test(subject) && !JOB_WORDS.test(subject)) return { decision: 'SKIP', reason: 'Subject is a newsletter, alert, receipt or offer' };
  const cv = email.attachments.find((a) => CV_FILE.test(a.fileName));
  if (!cv && (JOB_ALERT_SUBJECT.test(subject) || JOB_ALERT_SENDER.test(from))) return { decision: 'SKIP', reason: 'Job alert or job board advert' };
  if (JOB_WORDS.test(subject) || JOB_WORDS.test(body.slice(0, 3000))) return { decision: 'READ', reason: 'Mentions a job or application' };
  if (cv) return { decision: 'READ', reason: `Has a document attached (${cv.fileName})` };
  if (from && AUTOMATED_SENDER.test(from)) return { decision: 'SKIP', reason: 'Automated sender (no-reply, notifications…)' };
  if (/\bunsubscribe\b/i.test(body)) return { decision: 'SKIP', reason: 'Mailing list (has an unsubscribe link)' };
  // A mailbox that also gets other mail (bank alerts, appointments…): only job-like emails go to Claude.
  return { decision: 'SKIP', reason: 'No sign of a job or CV' };
}
