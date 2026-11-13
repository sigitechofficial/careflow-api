/**
 * Interview emails to the candidate (invitation, change, cancellation) and the calendar file that goes with them.
 * Pure functions: no database or mail here, so they are easy to test.
 */

export type InterviewEmailKind = 'INVITE' | 'UPDATE' | 'CANCEL';

export type InterviewEmailInput = {
  kind: InterviewEmailKind;
  interviewId: string;
  sequence: number;
  scheduledAt: Date;
  durationMinutes: number;
  mode: 'IN_PERSON' | 'PHONE' | 'VIDEO';
  location: string | null;
  interviewers: string | null;
  candidateFirstName: string;
  candidateEmail: string;
  candidatePhone: string | null;
  jobTitle: string;
  organisation: string;
  organisationEmail: string | null;
  organisationPhone: string | null;
  /** When the email is created (DTSTAMP). */
  now?: Date;
};

const UK = 'Europe/London';

export function formatInterviewWhen(at: Date): string {
  // Built from parts: some runtimes put a comma after the weekday ("Friday, 13 November").
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const day = `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  return `${day} at ${time} (UK time)`;
}

const MODE_TEXT: Record<InterviewEmailInput['mode'], string> = {
  IN_PERSON: 'In person',
  PHONE: 'Phone call',
  VIDEO: 'Video call',
};

/** The "Where" line: an address, the number we will call, or the video link. */
function whereLine(i: InterviewEmailInput): { label: string; value: string } | null {
  if (i.mode === 'PHONE') {
    const number = i.location?.trim() || i.candidatePhone;
    return number ? { label: 'We will call you on', value: number } : null;
  }
  if (!i.location?.trim()) return null;
  return { label: i.mode === 'VIDEO' ? 'Video link' : 'Where', value: i.location.trim() };
}

function contactLine(i: InterviewEmailInput): string {
  const ways = [i.organisationPhone ? `call ${i.organisationPhone}` : null, i.organisationEmail ? `email ${i.organisationEmail}` : null]
    .filter(Boolean)
    .join(' or ');
  return ways ? `please ${ways}` : 'please contact us';
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildInterviewEmail(i: InterviewEmailInput): { subject: string; text: string; html: string } {
  const when = formatInterviewWhen(i.scheduledAt);
  const where = whereLine(i);
  const details: [string, string][] = [
    ['When', when],
    ['How', MODE_TEXT[i.mode]],
    ...(where ? ([[where.label, where.value]] as [string, string][]) : []),
    ...(i.interviewers?.trim() ? ([['With', i.interviewers.trim()]] as [string, string][]) : []),
  ];

  let subject: string;
  let intro: string[];
  let outro: string[];
  if (i.kind === 'CANCEL') {
    subject = `Interview cancelled — ${i.jobTitle}`;
    intro = [`We are sorry, but your interview for ${i.jobTitle} on ${when} has been cancelled.`];
    outro = [`We will be in touch about what happens next. If you have any questions, ${contactLine(i)}.`];
  } else {
    subject = i.kind === 'UPDATE' ? `Interview changed — ${i.jobTitle}` : `Interview invitation — ${i.jobTitle}`;
    intro =
      i.kind === 'UPDATE'
        ? [`The details of your interview for ${i.jobTitle} have changed. Here are the new details:`]
        : [`Thank you for applying for ${i.jobTitle} with ${i.organisation}.`, 'We would like to invite you to an interview:'];
    outro = [
      ...(i.mode === 'IN_PERSON'
        ? ['Please bring photo ID (passport or driving licence) and proof of your right to work in the UK.']
        : []),
      `If you cannot make this time, ${contactLine(i)} so we can find another one.`,
      'The attached calendar file adds the interview to your calendar.',
    ];
  }

  const lines = [
    `Hello ${i.candidateFirstName},`,
    '',
    ...intro,
    '',
    ...(i.kind === 'CANCEL' ? [] : [...details.map(([k, v]) => `${k}: ${v}`), '']),
    ...outro,
    '',
    'Kind regards,',
    i.organisation,
  ];

  const table =
    i.kind === 'CANCEL'
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;font-size:15px">${details
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 16px 6px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:600;color:#111827">${escapeHtml(v)}</td></tr>`,
          )
          .join('')}</table>`;
  const p = (t: string) => `<p style="margin:0 0 12px">${escapeHtml(t)}</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827;max-width:560px">
${p(`Hello ${i.candidateFirstName},`)}
${intro.map(p).join('')}
${table}
${outro.map(p).join('')}
<p style="margin:16px 0 0">Kind regards,<br>${escapeHtml(i.organisation)}</p>
</div>`;

  return { subject, text: lines.join('\n'), html };
}

/* ─── Calendar file (iCalendar, RFC 5545) ─── */

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Lines longer than 75 characters are folded (continuation lines start with a space). */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += i === 0 ? 75 : 74) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i === 0 ? 75 : i + 74));
  }
  return parts.join('\r\n');
}

export function buildInterviewIcs(i: InterviewEmailInput): string {
  const end = new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000);
  const where = whereLine(i);
  const cancel = i.kind === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CareFlow//Recruitment//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${cancel ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:interview-${i.interviewId}@careflow`,
    `SEQUENCE:${i.sequence}`,
    `DTSTAMP:${icsDate(i.now ?? new Date())}`,
    `DTSTART:${icsDate(i.scheduledAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`Interview: ${i.jobTitle} — ${i.organisation}`)}`,
    ...(where ? [`LOCATION:${icsText(where.value)}`] : [`LOCATION:${icsText(MODE_TEXT[i.mode])}`]),
    `DESCRIPTION:${icsText(`${MODE_TEXT[i.mode]} interview for ${i.jobTitle}.${i.interviewers ? ` With ${i.interviewers}.` : ''}`)}`,
    ...(i.organisationEmail ? [`ORGANIZER;CN=${icsText(i.organisation)}:mailto:${i.organisationEmail}`] : []),
    `ATTENDEE;CN=${icsText(i.candidateFirstName)};ROLE=REQ-PARTICIPANT:mailto:${i.candidateEmail}`,
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
