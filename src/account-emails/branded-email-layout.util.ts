/**
 * CareFlow's branded email layout (staff welcome emails, password emails, and any email that wants the same
 * look): an all-white header with the organisation's full logo, a headline in the logo's deep blue, one dark-blue
 * button, a "details" list, an optional extra block, a help line and a legal footer.
 *
 * Same conventions as the survey emails (survey-email-html.util.ts): table layout with inline styles so it renders
 * the same in Outlook, Gmail, Apple Mail and phone apps; lang="en-GB"; a hidden preview line; images only from
 * https addresses (inboxes block anything else); a plain-text part is always sent alongside (callers build it with
 * {@link plainTextEmail}).
 *
 * Every value is escaped. Callers mark the few pieces that carry their own markup (a link, a phone number, bold
 * text) with {@link html}, which escapes whatever it interpolates.
 */

/** A piece of HTML that is already safe to place in an email (built with {@link html} or the helpers here). */
export type SafeHtml = { readonly __html: string };

export type EmailText = string | SafeHtml;

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafe(v: unknown): v is SafeHtml {
  return typeof v === 'object' && v !== null && typeof (v as SafeHtml).__html === 'string';
}

/** Text or SafeHtml as HTML. */
export function toHtml(v: EmailText | null | undefined): string {
  if (v == null) return '';
  return isSafe(v) ? v.__html : escapeEmailHtml(v);
}

/** Tagged template: the literal parts are trusted markup, every interpolated value is escaped (unless SafeHtml). */
export function html(strings: TemplateStringsArray, ...values: Array<EmailText | number | null | undefined>): SafeHtml {
  let out = strings[0];
  values.forEach((v, i) => {
    out += (typeof v === 'number' ? String(v) : toHtml(v)) + strings[i + 1];
  });
  return { __html: out };
}

export const EMAIL_NAVY = '#1e3f74';
/** Links inside running text (the darker blue used across CareFlow emails). */
export const EMAIL_LINK = '#132573';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const BODY = '#4b5563';
const RULE = '#e5e7eb';
const CANVAS = '#eef1f6';
const FONT = "font-family:'Segoe UI',Arial,Helvetica,sans-serif;";

/**
 * Only addresses an inbox can load: https, or http on this computer outside production (local testing with
 * Mailpit, where the admin runs on http://localhost).
 */
export function emailImageUrl(url: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  const u = url?.trim();
  if (!u || /[\s"'<>]/.test(u)) return null;
  if (/^https:\/\//i.test(u)) return u;
  // An image sent inside the email (see mail/inline-email-images).
  if (/^cid:[\w.-]+$/i.test(u)) return u;
  if (env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u)) return u;
  return null;
}

/** A link in running text. */
export function emailLink(label: EmailText, href: string, opts: { bold?: boolean; plain?: boolean } = {}): SafeHtml {
  const style = `color:${EMAIL_LINK};${opts.bold ? 'font-weight:600;' : ''}${opts.plain ? 'text-decoration:none;' : ''}`;
  return { __html: `<a href="${escapeEmailHtml(href)}" style="${style}">${toHtml(label)}</a>` };
}

export function emailBold(text: EmailText): SafeHtml {
  return { __html: `<strong>${toHtml(text)}</strong>` };
}

/** "020 8898 2867" → "tel:+442088982867" (UK numbers); other formats are kept as digits. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return `tel:${digits}`;
  if (digits.startsWith('0')) return `tel:+44${digits.slice(1)}`;
  return `tel:${digits}`;
}

export function emailPhoneLink(phone: string): SafeHtml {
  return {
    __html: `<a href="${escapeEmailHtml(telHref(phone))}" style="color:${EMAIL_NAVY};font-weight:600;text-decoration:none;">${escapeEmailHtml(phone)}</a>`,
  };
}

/** A small capitalised heading inside the body ("YOUR DETAILS"). */
export function emailSectionLabel(text: string, top = 30): SafeHtml {
  return { __html: `<p style="margin:${top}px 0 10px;${FONT}font-size:12px;font-weight:700;letter-spacing:1px;color:${MUTED};">${escapeEmailHtml(text.toUpperCase())}</p>` };
}

export function emailParagraph(text: EmailText, opts: { size?: number; colour?: string; margin?: string } = {}): SafeHtml {
  const size = opts.size ?? 15;
  return {
    __html: `<p style="margin:${opts.margin ?? '0 0 14px'};${FONT}font-size:${size}px;line-height:${size + 8}px;color:${opts.colour ?? TEXT};">${toHtml(text)}</p>`,
  };
}

export type EmailDetailRow = { label: string; value: EmailText };

function detailsTable(rows: EmailDetailRow[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${FONT}font-size:15px;line-height:22px;">${rows
    .map((r, i) => {
      const last = i === rows.length - 1 ? `border-bottom:1px solid ${RULE};` : '';
      return `<tr><td style="padding:10px 0;border-top:1px solid ${RULE};${last}color:${MUTED};width:38%;">${escapeEmailHtml(r.label)}</td><td style="padding:10px 0;border-top:1px solid ${RULE};${last}color:${TEXT};">${toHtml(r.value)}</td></tr>`;
    })
    .join('')}</table>`;
}

function buttonHtml(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${EMAIL_NAVY}" style="border-radius:10px;background:${EMAIL_NAVY};"><a href="${escapeEmailHtml(href)}" target="_blank" style="display:inline-block;padding:16px 40px;font-size:17px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;${FONT}">${escapeEmailHtml(label)}</a></td>
</tr></table>`;
}

export type BrandedEmailInput = {
  /** Shown as the header image's alt text, and instead of the logo when there is none. */
  organisation: string;
  /** Full logo, ideally 3:1 (shown 210 × 70). Anything {@link emailImageUrl} refuses is left out. */
  logoUrl?: string | null;
  /** Small words at the top right ("CareFlow", "Care app"). */
  kicker?: string | null;
  /** Hidden preview line shown by inboxes after the subject. */
  preheader: string;
  title: string;
  subtitle?: EmailText | null;
  intro: EmailText;
  button?: { label: string; href: string; note?: EmailText | null } | null;
  details?: { heading: string; rows: EmailDetailRow[] } | null;
  /** Further blocks after the details (e.g. the Care app section). */
  extra?: SafeHtml | null;
  help?: EmailText | null;
  signOff: string;
  footer: {
    /** Why they got it, e.g. "You're getting this because …". */
    why?: string | null;
    /** e.g. "ALLFOR CARE SERVICES LIMITED · Company no. 05142064 · CQC provider ID 1-101656545". */
    legalLine?: string | null;
    addressLine?: string | null;
    website?: string | null;
  };
};

export function renderBrandedEmail(input: BrandedEmailInput): string {
  const e = escapeEmailHtml;
  const logo = emailImageUrl(input.logoUrl);
  const brand = logo
    ? `<img src="${e(logo)}" alt="${e(input.organisation)}" width="210" height="70" style="display:block;width:210px;height:70px;border:0;outline:none;">`
    : `<span style="${FONT}font-size:22px;font-weight:700;color:${EMAIL_NAVY};">${e(input.organisation)}</span>`;
  const kicker = input.kicker ? `<td align="right" style="${FONT}font-size:12px;font-weight:600;color:${EMAIL_NAVY};">${e(input.kicker)}</td>` : '';

  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center">
    ${buttonHtml(input.button.label, input.button.href)}
    ${input.button.note ? `<p style="margin:12px 0 0;font-size:13px;line-height:20px;color:${MUTED};">${toHtml(input.button.note)}</p>` : ''}
  </td></tr></table>`
    : '';
  const details = input.details?.rows.length
    ? `${emailSectionLabel(input.details.heading).__html}
  ${detailsTable(input.details.rows)}`
    : '';

  const f = input.footer;
  const website = f.website?.trim() || null;
  const footerTop = f.why ? `${e(f.why)} Account emails are always sent.` : '';
  const legal = [f.legalLine ? e(f.legalLine) : '', [f.addressLine ? e(f.addressLine) : '', website ? `<a href="${e(website)}" style="color:${MUTED};">${e(website.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>` : ''].filter(Boolean).join(' · ')]
    .filter(Boolean)
    .join('<br>');
  const footer = [footerTop, legal].filter(Boolean).join('<br><br>\n  ');

  return `<!DOCTYPE html>
<html lang="en-GB" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(input.title)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${e(input.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CANVAS}" style="background:${CANVAS};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
<tr><td style="background:#ffffff;border-radius:14px 14px 0 0;padding:24px 36px 14px;${FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td>${brand}</td>
    ${kicker}
  </tr></table>
</td></tr>
<tr><td style="background:#ffffff;padding:10px 36px 26px;${FONT}border-bottom:1px solid #e8ebf1;">
  <p style="margin:0;font-size:28px;line-height:34px;font-weight:700;color:${EMAIL_NAVY};">${e(input.title)}</p>
  ${input.subtitle ? `<p style="margin:8px 0 0;font-size:16px;line-height:24px;color:${BODY};">${toHtml(input.subtitle)}</p>` : ''}
</td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:28px 36px 8px;${FONT}">
  <p style="margin:0 0 22px;font-size:16px;line-height:25px;color:${TEXT};">${toHtml(input.intro)}</p>
  ${button}
  ${details}
  ${input.extra ? input.extra.__html : ''}
  ${input.help ? `<p style="margin:26px 0 0;font-size:14px;line-height:22px;color:${BODY};">${toHtml(input.help)}</p>` : ''}
  <p style="margin:24px 0 30px;font-size:15px;line-height:22px;color:${TEXT};">${e(input.signOff)}</p>
</td></tr>
<tr><td style="padding:22px 20px 0;${FONT}font-size:12px;line-height:19px;color:${MUTED};text-align:center;">
  ${footer}
</td></tr>
</table></td></tr></table>
</body>
</html>`;
}

/**
 * The plain-text part: paragraphs separated by blank lines, links written out in full. Lines that are null or
 * empty are dropped, so callers can list optional lines inline.
 */
export function plainTextEmail(blocks: Array<string | string[] | null | undefined | false>): string {
  return blocks
    .map((b) => (Array.isArray(b) ? b.filter(Boolean).join('\n') : b))
    .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
    .join('\n\n');
}
