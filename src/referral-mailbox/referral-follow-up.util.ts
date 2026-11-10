import type { ReferralExtraction } from './referral-extraction.service';

/** A later email in a referral's thread, added to the referral when Claude reads it again. */
export type ThreadEmail = {
  fromName: string | null;
  fromEmail: string | null;
  subject: string | null;
  receivedAt: Date;
  bodyText: string;
};

/** The referral email followed by the later emails in its thread, oldest first, for Claude to read as one. */
export function threadBody(originalBody: string, later: ThreadEmail[]): string {
  return [
    originalBody || '(no text in the email body)',
    ...later.map((f) =>
      [
        '',
        '--- A later email in this thread (newer information replaces older) ---',
        `From: ${[f.fromName, f.fromEmail ? `<${f.fromEmail}>` : ''].filter(Boolean).join(' ') || 'unknown'}`,
        `Received: ${f.receivedAt.toISOString()}`,
        `Subject: ${f.subject ?? ''}`,
        '',
        f.bodyText || '(no text)',
      ].join('\n'),
    ),
  ].join('\n');
}

const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const FILLER = new Set(['a', 'an', 'and', 'at', 'on', 'the', 'of', 'in', 'to', 'for', 'some']);
/** The same fact in other words ("10am on Mondays" / "10am Mondays") is not a change. */
const sameWords = (a: string, b: string) => {
  const words = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !FILLER.has(w)).join(' ');
  return words(a) === words(b);
};

/** Single facts staff care about when the referrer sends more: [label, read from the extraction]. */
const FACTS: Array<[string, (e: ReferralExtraction) => string]> = [
  ['First name', (e) => t(e.person?.firstName)],
  ['Last name', (e) => t(e.person?.lastName)],
  ['Date of birth', (e) => t(e.person?.dateOfBirth)],
  ['Address', (e) => t(e.person?.addressLine)],
  ['Postcode', (e) => t(e.person?.postcode)],
  ['Phone', (e) => t(e.person?.phone)],
  ['NHS number', (e) => t(e.person?.nhsNumber)],
  ['Lives alone', (e) => t(e.person?.livesAlone)],
  ['Contact', (e) => [t(e.contact?.name), t(e.contact?.relationship)].filter(Boolean).join(', ')],
  ['Contact phone', (e) => t(e.contact?.phone)],
  ['Contact email', (e) => t(e.contact?.email)],
  ['Hours a week', (e) => t(e.care?.hoursPerWeek)],
  ['Visits a day', (e) => t(e.care?.visitsPerDay)],
  ['Visit times', (e) => t(e.care?.visitTimes)],
  ['Carers per visit', (e) => t(e.care?.carersPerVisit)],
  ['Start date', (e) => t(e.care?.requestedStartDate)],
  ['Carer gender', (e) => t(e.care?.genderPreference)],
  ['Language or culture', (e) => t(e.care?.languageOrCulture)],
  ['Funding', (e) => (e.funding?.type && e.funding.type !== 'UNKNOWN' ? [e.funding.type, t(e.funding.funderName)].filter(Boolean).join(', ') : '')],
  ['Care needs', (e) => t(e.careNeeds)],
];

/**
 * What the later emails added or changed, as lines for the enquiry's history ("Date of birth: 12/03/1941").
 * Lists show only their new items; visits are listed when there were none before or they changed.
 */
export function newFacts(before: ReferralExtraction, after: ReferralExtraction): string[] {
  const lines: string[] = [];
  for (const [label, read] of FACTS) {
    const was = read(before);
    const now = read(after);
    if (now && !sameWords(now, was)) lines.push(was ? `${label}: ${now} (was ${was})` : `${label}: ${now}`);
  }
  const added = (label: string, a: string[] = [], b: string[] = []) => {
    const old = new Set(a.map((x) => x.trim().toLowerCase()));
    const fresh = b.filter((x) => x.trim() && !old.has(x.trim().toLowerCase()));
    if (fresh.length) lines.push(`${label}: ${fresh.join('; ')}`);
  };
  added('New conditions', before.conditions, after.conditions);
  added('New risks', before.risks, after.risks);
  const visits = (e: ReferralExtraction) =>
    (e.visits ?? []).map((v) => `${v.label || 'Visit'} ${v.startTime} for ${v.durationMinutes} min, ${v.days.join(' ')}${v.carers > 1 ? `, ${v.carers} carers` : ''}`);
  const vBefore = visits(before);
  const vAfter = visits(after);
  if (vAfter.length && vAfter.join('|') !== vBefore.join('|')) lines.push(`Visits: ${vAfter.join('; ')}`);
  return lines;
}
