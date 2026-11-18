/**
 * Offer and rejection emails to the candidate. Pure functions: no database or mail here, so they are easy to test.
 * Staff-only notes and the internal rejection reason are never put in these emails.
 */

export type CandidateEmailBase = {
  candidateFirstName: string;
  jobTitle: string;
  organisation: string;
  organisationEmail: string | null;
  organisationPhone: string | null;
};

export type OfferEmailInput = CandidateEmailBase & {
  /** OFFER: first time; UPDATE: the terms changed after it was sent. */
  kind: 'OFFER' | 'UPDATE';
  startDate: Date | null;
  hoursPerWeek: string | null;
  payRate: string | null;
};

/** How far the candidate got decides the wording. */
export type RejectionPoint = 'APPLICATION' | 'INTERVIEW' | 'OFFER';

export type RejectionEmailInput = CandidateEmailBase & { point: RejectionPoint };

type Email = { subject: string; text: string; html: string };

/** Offer start dates are stored as dates (midnight UTC), so they are shown in UTC. */
export function formatOfferDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
}

function contactWays(i: CandidateEmailBase): string {
  return [i.organisationPhone ? `call ${i.organisationPhone}` : null, i.organisationEmail ? `email ${i.organisationEmail}` : null]
    .filter(Boolean)
    .join(' or ');
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(
  i: CandidateEmailBase,
  subject: string,
  intro: string[],
  details: [string, string][],
  outro: string[],
): Email {
  const text = [
    `Hello ${i.candidateFirstName},`,
    '',
    ...intro,
    '',
    ...(details.length ? [...details.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...outro,
    '',
    'Kind regards,',
    i.organisation,
  ].join('\n');

  const p = (t: string) => `<p style="margin:0 0 12px">${escapeHtml(t)}</p>`;
  const table = details.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;font-size:15px">${details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600;color:#111827">${escapeHtml(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:560px">
${p(`Hello ${i.candidateFirstName},`)}
${intro.map(p).join('')}
${table}
${outro.map(p).join('')}
<p style="margin:16px 0 0">Kind regards,<br>${escapeHtml(i.organisation)}</p>
</div>`;
  return { subject, text, html };
}

/** The checks every care worker must pass before starting (CQC Schedule 3). */
const OFFER_CONDITIONS =
  'This offer is conditional on satisfactory pre-employment checks: proof of identity and your right to work in the UK, an enhanced DBS check, two satisfactory references (including your most recent employer) and a health declaration.';

export function buildOfferEmail(i: OfferEmailInput): Email {
  const details: [string, string][] = [
    ['Role', i.jobTitle],
    ...(i.startDate ? ([['Proposed start date', formatOfferDate(i.startDate)]] as [string, string][]) : []),
    ...(i.hoursPerWeek?.trim() ? ([['Hours per week', i.hoursPerWeek.trim()]] as [string, string][]) : []),
    ...(i.payRate?.trim() ? ([['Pay', i.payRate.trim()]] as [string, string][]) : []),
  ];
  const ways = contactWays(i);
  const update = i.kind === 'UPDATE';
  return render(
    i,
    update ? `Your job offer has been updated — ${i.jobTitle}` : `Conditional job offer — ${i.jobTitle}`,
    update
      ? [`The details of the job offer we made you for ${i.jobTitle} with ${i.organisation} have changed. Here are the new details:`]
      : [
          `Thank you for attending your interview. We are pleased to offer you the role of ${i.jobTitle} with ${i.organisation}.`,
          'Here are the details of the offer:',
        ],
    details,
    [
      OFFER_CONDITIONS,
      ways
        ? `Please let us know whether you accept the offer: ${ways}.`
        : 'Please let us know whether you accept the offer.',
      'Once you accept, we will tell you which documents to bring or send for the checks.',
    ],
  );
}

export function buildRejectionEmail(i: RejectionEmailInput): Email {
  const intro =
    i.point === 'OFFER'
      ? [
          `We are writing about the conditional offer we made you for ${i.jobTitle} with ${i.organisation}.`,
          'We are sorry to tell you that we are unable to continue with the offer, and we have closed your application.',
        ]
      : i.point === 'INTERVIEW'
        ? [
            `Thank you for taking the time to attend an interview for ${i.jobTitle} with ${i.organisation}.`,
            'After careful thought, we are sorry to tell you that we will not be offering you the role on this occasion.',
          ]
        : [
            `Thank you for applying for ${i.jobTitle} with ${i.organisation}.`,
            'After careful thought, we are sorry to tell you that we will not be taking your application further on this occasion.',
          ];
  const ways = contactWays(i);
  return render(i, `Your application for ${i.jobTitle}`, intro, [], [
    ...(i.point === 'OFFER' && ways ? [`If you have any questions, please ${ways}.`] : []),
    'We appreciate your interest in working with us and wish you every success. You are welcome to apply for our future vacancies.',
  ]);
}
