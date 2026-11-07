/**
 * The HTML of survey invitation and reminder emails: one branded, accessible layout for every
 * audience. Table layout with inline styles so it renders the same in Outlook, Gmail, Apple Mail and
 * phone apps; 16px text, a large button with strong contrast, lang="en-GB", a hidden preview line, and a
 * plain-text part is always sent alongside (survey-contact-messages.util.ts).
 *
 * Never holds an answer, and never a personal link on an anonymous survey (A7): callers pass `button`
 * only when it is safe (a named survey's own link, or a sign-in page that holds no token).
 */

export type SurveyEmailSection = { heading: string; body: string };

export type SurveyEmailHtmlInput = {
  organisation: string | null;
  /** An https logo; anything else is ignored (localhost or relative URLs never load in an inbox). */
  logoUrl?: string | null;
  /** #rrggbb; used for the top bar and the button (falls back to navy if too light for white text). */
  brandColour?: string | null;
  preheader: string;
  greeting: string;
  paragraphs: string[];
  button?: { label: string; href: string } | null;
  /** One line under the button: "Takes about 6 minutes · Open until Monday 30 November 2026". */
  facts?: string | null;
  /** How to answer when there is no button (anonymous staff surveys, paper). */
  howToAnswer?: string | null;
  sections: SurveyEmailSection[];
  /** A short muted line at the end (reminders: "If you've already answered, thank you…"). */
  closingNote?: string | null;
  signOff: string[];
  footer: {
    legalLines: string[];
    contactLine: string | null;
    website: string | null;
    why: string | null;
  };
  unsubscribe?: { label: string; href: string } | null;
};

const NAVY = '#132573';
const TEXT = '#1f2937';
const MUTED = '#4b5563';
const BORDER = '#e5e7eb';
const CANVAS = '#f1f3f7';
const PANEL = '#f6f8fb';
const FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Turns bare http(s) URLs in already-escaped text into links. */
function linkify(escaped: string, colour: string): string {
  return escaped.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
    const clean = url.replace(/[.,;:)]+$/, '');
    return `<a href="${clean}" style="color:${colour};">${clean}</a>${url.slice(clean.length)}`;
  });
}

/** **bold** in plain text → <strong> (after escaping). */
function bold(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function safeHttpsUrl(url: string | null | undefined): string | null {
  const u = url?.trim();
  return u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

/** White text needs a dark background (WCAG AA 4.5:1); a light brand colour falls back to navy. */
function buttonColour(hex: string | null | undefined): string {
  const h = hex?.trim();
  if (!h || !/^#[0-9a-f]{6}$/i.test(h)) return NAVY;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05) >= 4.5 ? h : NAVY;
}

export function renderSurveyEmailHtml(input: SurveyEmailHtmlInput): string {
  const e = escapeEmailHtml;
  const brand = buttonColour(input.brandColour);
  const org = input.organisation?.trim() || null;
  const logo = safeHttpsUrl(input.logoUrl);
  const rich = (t: string) => bold(linkify(e(t), brand));

  const header = logo
    ? `<img src="${e(logo)}" alt="${e(org ?? 'Logo')}" width="168" style="display:block;width:168px;max-width:168px;height:auto;border:0;outline:none;">`
    : `<span style="${FONT}font-size:20px;font-weight:700;color:${brand};">${e(org ?? '')}</span>`;

  const para = (t: string) => `<p style="${FONT}margin:0 0 16px;font-size:16px;line-height:25px;color:${TEXT};">${rich(t)}</p>`;

  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 14px;">
<tr><td align="center" bgcolor="${brand}" style="border-radius:8px;background:${brand};">
<a href="${e(input.button.href)}" target="_blank" style="${FONT}display:inline-block;padding:15px 34px;font-size:17px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;">${e(input.button.label)}<span aria-hidden="true">&nbsp;&rarr;</span></a>
</td></tr></table>`
    : '';

  const facts = input.facts
    ? `<p style="${FONT}margin:0 0 24px;font-size:14px;line-height:21px;color:${MUTED};">${rich(input.facts)}</p>`
    : '';

  const how = input.howToAnswer
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 24px;">
<tr><td style="background:${PANEL};border-left:4px solid ${brand};border-radius:4px;padding:16px 18px;${FONT}font-size:16px;line-height:25px;color:${TEXT};">
<strong style="display:block;margin-bottom:4px;">How to answer</strong>${rich(input.howToAnswer)}
</td></tr></table>`
    : '';

  const sections = input.sections
    .map(
      (s) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
<tr><td style="background:${PANEL};border-radius:6px;padding:16px 18px;">
<p style="${FONT}margin:0 0 6px;font-size:15px;font-weight:700;color:${TEXT};">${e(s.heading)}</p>
<p style="${FONT}margin:0;font-size:15px;line-height:23px;color:${TEXT};">${rich(s.body)}</p>
</td></tr></table>`,
    )
    .join('\n');

  const closingNote = input.closingNote
    ? `<p style="${FONT}margin:8px 0 0;font-size:15px;line-height:23px;color:${MUTED};">${rich(input.closingNote)}</p>`
    : '';
  const signOff = input.signOff.length
    ? `<p style="${FONT}margin:24px 0 0;font-size:16px;line-height:25px;color:${TEXT};">${input.signOff.map(e).join('<br>')}</p>`
    : '';

  const f = input.footer;
  const footerLines = [
    f.contactLine ? `<span style="color:${TEXT};">${rich(f.contactLine)}</span>` : '',
    f.website ? `<a href="${e(f.website)}" style="color:${brand};text-decoration:none;">${e(f.website.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>` : '',
    ...f.legalLines.map(e),
    f.why ? e(f.why) : '',
    input.unsubscribe ? `<a href="${e(input.unsubscribe.href)}" style="color:${MUTED};">${e(input.unsubscribe.label)}</a>` : '',
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(org ?? 'Survey')}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${e(input.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="background:${CANVAS};">
<tr><td align="center" style="padding:28px 12px 32px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td height="6" bgcolor="${brand}" style="background:${brand};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:22px 36px 18px;border-bottom:1px solid ${BORDER};">${header}</td></tr>
<tr><td style="padding:32px 36px 28px;">
${para(input.greeting)}
${input.paragraphs.map(para).join('\n')}
${button}
${facts}
${how}
${sections}
${closingNote}
${signOff}
</td></tr>
</table>
</td></tr>
<tr><td style="padding:22px 28px 0;${FONT}font-size:13px;line-height:20px;color:${MUTED};text-align:center;">
${footerLines.join('<br>\n')}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
