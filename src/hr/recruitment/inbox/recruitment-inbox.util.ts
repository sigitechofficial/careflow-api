import type { EmploymentHistoryEntry } from '../utils/recruitment-flow.util';

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
