/**
 * The HTML body of survey invitation and reminder emails: one accessible, branded layout for every
 * audience. Inline styles and a table layout so it renders the same in Outlook, Gmail and phone apps;
 * 16px text, a large button with strong contrast, lang="en-GB", and a plain-text alternative is always
 * sent alongside (survey-contact-messages.util.ts).
 *
 * Never holds an answer, and never a personal link on an anonymous survey (A7): callers pass `button`
 * only when it is safe (a named survey's own link, or a sign-in page with no token).
 */

export type SurveyEmailHtmlInput = {
  organisation: string | null;
  /** An https logo URL; anything else is ignored (a localhost or relative URL never loads in an inbox). */
  logoUrl?: string | null;
  /** Hidden preview line shown by inbox lists next to the subject. */
  preheader: string;
  heading: string;
  greeting: string;
  paragraphs: string[];
  button?: { label: string; href: string } | null;
  /** How to answer when there is no button (anonymous staff surveys, paper). */
  howToAnswer?: string | null;
  details: Array<{ label: string; value: string }>;
  notes: string[];
  help: string | null;
  footer: string[];
  unsubscribe?: { label: string; href: string } | null;
};

const BRAND = '#1d4ed8'; // white text on this is 6.7:1
const TEXT = '#1f2937';
const MUTED = '#4b5563';
const BORDER = '#e5e7eb';
const PANEL = '#f3f4f6';
const FONT = "font-family:Arial,Helvetica,sans-serif;";

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turns bare http(s) URLs in already-escaped text into links (for "how to answer" lines). */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
    const clean = url.replace(/[.,;:)]+$/, '');
    const tail = url.slice(clean.length);
    return `<a href="${clean}" style="color:${BRAND};">${clean}</a>${tail}`;
  });
}

function safeHttpsUrl(url: string | null | undefined): string | null {
  const u = url?.trim();
  return u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

export function renderSurveyEmailHtml(input: SurveyEmailHtmlInput): string {
  const e = escapeEmailHtml;
  const org = input.organisation?.trim() || null;
  const logo = safeHttpsUrl(input.logoUrl);
  const header = logo
    ? `<img src="${e(logo)}" alt="${e(org ?? 'Logo')}" height="40" style="display:block;height:40px;max-width:220px;border:0;">`
    : org
      ? `<span style="${FONT}font-size:18px;font-weight:bold;color:${TEXT};">${e(org)}</span>`
      : '';

  const p = (text: string, extra = '') =>
    `<p style="${FONT}margin:0 0 16px;font-size:16px;line-height:24px;color:${TEXT};${extra}">${linkify(e(text))}</p>`;

  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px;">
<tr><td style="border-radius:6px;background:${BRAND};">
<a href="${e(input.button.href)}" style="${FONT}display:inline-block;padding:14px 28px;font-size:17px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">${e(input.button.label)}</a>
</td></tr></table>
<p style="${FONT}margin:0 0 20px;font-size:13px;line-height:20px;color:${MUTED};">If the button does not work, copy this link into your browser:<br><a href="${e(input.button.href)}" style="color:${BRAND};word-break:break-all;">${e(input.button.href)}</a></p>`
    : '';

  const how = input.howToAnswer
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
<tr><td style="background:${PANEL};border-radius:6px;padding:14px 16px;${FONT}font-size:16px;line-height:24px;color:${TEXT};">
<strong>How to answer</strong><br>${linkify(e(input.howToAnswer))}
</td></tr></table>`
    : '';

  const details = input.details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${BORDER};">
${input.details
  .map(
    (d) =>
      `<tr><td style="${FONT}padding:10px 12px 10px 0;font-size:15px;color:${MUTED};border-bottom:1px solid ${BORDER};width:38%;vertical-align:top;">${e(d.label)}</td><td style="${FONT}padding:10px 0;font-size:15px;color:${TEXT};border-bottom:1px solid ${BORDER};vertical-align:top;">${e(d.value)}</td></tr>`,
  )
  .join('\n')}
</table>`
    : '';

  const notes = input.notes.map((n) => p(n, `font-size:15px;color:${MUTED};`)).join('\n');
  const help = input.help ? p(input.help, 'font-size:15px;') : '';
  const unsubscribe = input.unsubscribe
    ? `<br><a href="${e(input.unsubscribe.href)}" style="color:${MUTED};">${e(input.unsubscribe.label)}</a>`
    : '';
  const footer = input.footer.length || unsubscribe
    ? `<p style="${FONT}margin:0;font-size:13px;line-height:20px;color:${MUTED};">${input.footer.map(e).join('<br>')}${unsubscribe}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PANEL};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PANEL};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:8px;">
${header ? `<tr><td style="padding:20px 28px;border-bottom:1px solid ${BORDER};">${header}</td></tr>` : ''}
<tr><td style="padding:28px;">
<h1 style="${FONT}margin:0 0 20px;font-size:22px;line-height:30px;color:${TEXT};">${e(input.heading)}</h1>
${p(input.greeting)}
${input.paragraphs.map((x) => p(x)).join('\n')}
${button}
${how}
${details}
${notes}
${help}
</td></tr>
${footer ? `<tr><td style="padding:16px 28px 24px;border-top:1px solid ${BORDER};">${footer}</td></tr>` : ''}
</table>
</td></tr>
</table>
</body>
</html>`;
}
