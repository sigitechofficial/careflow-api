import type { AccountEmailBranding, BranchContact } from './account-email-branding';
import { displayHost } from './account-email-branding';
import {
  emailBold,
  emailImageUrl,
  emailLink,
  emailParagraph,
  emailPhoneLink,
  emailSectionLabel,
  html,
  plainTextEmail,
  renderBrandedEmail,
  type EmailDetailRow,
  type EmailText,
  type SafeHtml,
} from './branded-email-layout.util';

/**
 * The three staff welcome emails (approved design, version 5) and the password reset emails, from one layout:
 * A · website login only, B · Care app only, C · both (one password for both).
 */
export type StaffAccess = 'website' | 'app' | 'both';

export const WELCOME_MESSAGE_KIND: Record<StaffAccess, string> = {
  website: 'staff-welcome-website',
  app: 'staff-welcome-app',
  both: 'staff-welcome-both',
};

export type StaffEmployment = {
  role?: string | null;
  jobTitle?: string | null;
  accessLevel?: string | null;
  workArea?: string | null;
};

export type BuiltEmail = { subject: string; preheader: string; html: string; text: string };

/** Where a set-password link opens: the website's page when it covers an office login, else the Care app page. */
export function setPasswordLink(base: string, rawToken: string, coversWebsite: boolean): string {
  const path = coversWebsite ? '/auth/reset-password' : '/app/set-password';
  return `${base}${path}?token=${encodeURIComponent(rawToken)}`;
}

function firstNameOf(name: string | null | undefined): string | null {
  return name?.trim() || null;
}

function contactSentence(branch: BranchContact | null, b: AccountEmailBranding, lead: string): { html: EmailText; text: string } {
  const name = branch?.name ?? b.organisation;
  const phone = branch?.phone ?? b.companyPhone;
  if (!phone) return { html: `${lead} Contact ${name}.`, text: `${lead} Contact ${name}.` };
  return { html: html`${lead} Call ${name} on ${emailPhoneLink(phone)}.`, text: `${lead} Call ${name} on ${phone}.` };
}

function detailRows(rows: Array<[string, EmailText | null | undefined]>): EmailDetailRow[] {
  return rows
    .filter((r): r is [string, EmailText] => r[1] != null && (typeof r[1] !== 'string' || r[1].trim().length > 0))
    .map(([label, value]) => ({ label, value }));
}

function textOf(v: EmailText): string {
  return typeof v === 'string' ? v : v.__html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

/**
 * The Care app section. Each official store badge links straight to that store's page, so it works on any phone
 * without our website; a store shows only once the app is published there (CARE_APP_IOS_APP_ID /
 * CARE_APP_ANDROID_PACKAGE). With neither set, a plain "Get the Care app" link goes to /get-app.
 */
function appBlock(b: AccountEmailBranding, email: string): { html: SafeHtml; text: string[] } {
  const getApp = `${b.siteUrl}/get-app`;
  const apple = b.appStoreUrl ? emailImageUrl(b.appStoreBadgeUrl) : null;
  const google = b.playStoreUrl ? emailImageUrl(b.googlePlayBadgeUrl) : null;
  const cells: SafeHtml[] = [];
  if (apple && b.appStoreUrl) {
    cells.push(html`<td><a href="${b.appStoreUrl}" target="_blank"><img src="${apple}" alt="Download on the App Store" width="150" height="50" style="display:block;width:150px;height:50px;border:0;"></a></td>`);
  }
  if (google && b.playStoreUrl) {
    if (cells.length) cells.push(html`<td width="10"></td>`);
    cells.push(html`<td><a href="${b.playStoreUrl}" target="_blank"><img src="${google}" alt="Get it on Google Play" width="168" height="65" style="display:block;width:168px;height:65px;border:0;margin-top:-7px;margin-bottom:-8px;"></a></td>`);
  }
  const badges = cells.length
    ? html`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${{ __html: cells.map((c) => c.__html).join('') }}</tr></table>`
    : html`<p style="margin:0;font-size:15px;line-height:23px;">${emailLink('Get the Care app', getApp, { bold: true })}</p>`;
  const storeLines = [
    b.playStoreUrl ? `Android (Google Play): ${b.playStoreUrl}` : null,
    b.appStoreUrl ? `iPhone (App Store): ${b.appStoreUrl}` : null,
  ].filter((x): x is string => Boolean(x));
  const iphoneLater = b.playStoreUrl && !b.appStoreUrl
    ? emailParagraph('The iPhone app is on its way; we will let you know when it is ready.', { size: 13, colour: '#6b7280', margin: '12px 0 0' })
    : html``;
  return {
    html: html`${emailSectionLabel('On your phone: the Care app')}
${emailParagraph(html`Your visits, care plans and messages from the office. Install it, then sign in with ${emailBold(email)}.`)}
${badges}
${iphoneLater}`,
    text: [
      'ON YOUR PHONE: THE CARE APP',
      `Your visits, care plans and messages from the office. Install it, then sign in with ${email}.`,
      ...(storeLines.length ? storeLines : [`Get the Care app: ${getApp}`]),
      ...(b.playStoreUrl && !b.appStoreUrl ? ['The iPhone app is on its way; we will let you know when it is ready.'] : []),
    ],
  };
}

export type WelcomeEmailInput = {
  access: StaffAccess;
  /** The other account already exists, so this link also sets its password (one password for both). */
  alsoReplaces?: 'website' | 'app' | null;
  /**
   * The office set the password when giving access: no set-password link, and the password is never in the email.
   * It says their manager will give it to them. `link` is then ignored.
   */
  passwordGiven?: boolean;
  firstName: string | null;
  email: string;
  link: string;
  linkHours: number;
  employment: StaffEmployment;
  branch: BranchContact | null;
  branding: AccountEmailBranding;
};

export function buildWelcomeEmail(input: WelcomeEmailInput): BuiltEmail {
  const b = input.branding;
  const first = firstNameOf(input.firstName);
  const org = b.organisation;
  const host = displayHost(b.siteUrl);
  const forgot = `${b.siteUrl}/auth/forgot-password`;
  const note = `Works once, for ${input.linkHours} hours. Only you will know your password.`;
  const e = input.employment;
  const branchName = input.branch?.name ?? null;

  let subject: string;
  let preheader: string;
  let kicker: string;
  let title: string;
  let subtitle: string;
  let intro: EmailText;
  let introText: string;
  let rows: EmailDetailRow[];
  let help: { html: EmailText; text: string };
  let why: string;
  let extra: { html: SafeHtml; text: string[] } | null = null;

  if (input.access === 'website') {
    subject = 'Your CareFlow account is ready';
    preheader = `Choose your password to sign in to CareFlow. The link works for ${input.linkHours} hours.`;
    kicker = 'CareFlow';
    title = first ? `Welcome, ${first}` : 'Welcome';
    subtitle = 'Your CareFlow account is ready. Choose a password and you’re in.';
    intro = html`CareFlow is where ${org} runs care: visits, care plans, staff and more. You sign in at ${emailLink(host, b.siteUrl, { bold: true })}.`;
    introText = `CareFlow is where ${org} runs care: visits, care plans, staff and more. You sign in at ${b.siteUrl}`;
    if (input.alsoReplaces === 'app') {
      intro = html`${intro} Your new password works in the Care app too, so you use one password for both.`;
      introText += '\n\nYour new password works in the Care app too, so you use one password for both.';
    }
    rows = detailRows([
      ['Sign in with', input.email],
      ['Job title', e.jobTitle],
      ['Access level', e.accessLevel],
      ['Work area', e.workArea],
      ['Branch', branchName],
    ]);
    const c = contactSentence(input.branch, b, 'Anything wrong in your details, or weren’t expecting this?');
    help = {
      html: html`Link expired? Get a new one at ${emailLink(displayHost(forgot), forgot)}. ${c.html}`,
      text: `Link expired? Get a new one at ${forgot}\n${c.text}`,
    };
    why = `You’re getting this because ${org} created a CareFlow account for you.`;
  } else if (input.access === 'app') {
    subject = `Set up your ${org} app`;
    preheader = 'Choose your password and install the Care app to see your visits.';
    kicker = 'Care app';
    title = first ? `Welcome to the team, ${first}` : 'Welcome to the team';
    subtitle = 'Your visits, care plans and messages from the office, all on your phone.';
    intro = 'First, choose the password you’ll use to sign in to the Care app.';
    introText = intro;
    if (input.alsoReplaces === 'website') {
      intro = `${intro} It replaces your CareFlow website password too, so you use one password for both.`;
      introText = intro;
    }
    rows = detailRows([
      ['Sign in with', input.email],
      ['Role', e.role],
      ['Work area', e.workArea],
      ['Branch', branchName],
    ]);
    extra = appBlock(b, input.email);
    const c = contactSentence(input.branch, b, 'Anything wrong in your details?');
    help = {
      html: html`Link expired? Tap ${emailBold('Forgot password')} in the app. ${c.html}`,
      text: `Link expired? Tap Forgot password in the app.\n${c.text}`,
    };
    why = `You’re getting this because ${org} switched on your Care app access.`;
  } else {
    subject = 'Your CareFlow account and Care app are ready';
    preheader = 'One password for the CareFlow website and the Care app.';
    kicker = 'CareFlow + Care app';
    title = first ? `Welcome, ${first}` : 'Welcome';
    subtitle = 'You’ll use CareFlow in the office and the Care app on visits.';
    intro = 'Choose one password. It works for both the CareFlow website and the Care app.';
    introText = intro;
    rows = detailRows([
      ['Sign in with', input.email],
      ['Website', emailLink(host, b.siteUrl, { bold: true, plain: true })],
      ['Role', e.role],
      ['Job title', e.jobTitle],
      ['Access level', e.accessLevel],
      ['Work area', e.workArea],
      ['Branch', branchName],
    ]);
    extra = appBlock(b, input.email);
    const c = contactSentence(input.branch, b, 'Anything wrong in your details?');
    help = {
      html: html`Link expired? Use ${emailBold('Forgot password')} on the website or in the app. ${c.html}`,
      text: `Link expired? Use Forgot password on the website (${forgot}) or in the app.\n${c.text}`,
    };
    why = `You’re getting this because ${org} created a CareFlow account for you and switched on your Care app access.`;
  }

  let button = { label: 'Choose my password', href: input.link, note: note as string };
  if (input.passwordGiven) {
    const app = input.access === 'app';
    const signIn = `${b.siteUrl}/auth/login`;
    const given = 'Your manager will give you your password. You can change it any time after you sign in.';
    button = app
      ? { label: 'Get the Care app', href: `${b.siteUrl}/get-app`, note: given }
      : { label: 'Sign in to CareFlow', href: signIn, note: given };
    preheader = app ? 'Install the Care app and sign in to see your visits.' : 'Your CareFlow account is ready. Your manager will give you your password.';
    if (input.access === 'website') subtitle = 'Your CareFlow account is ready. Sign in with the password your manager gives you.';
    if (app) {
      intro = 'Install the Care app and sign in with the password your manager gives you.';
      introText = intro;
    } else if (input.access === 'both') {
      intro = 'One password works for both the CareFlow website and the Care app. Your manager will give it to you.';
      introText = intro;
    }
    const c = contactSentence(input.branch, b, 'Anything wrong in your details?');
    help = app
      ? { html: html`Forgotten your password? Tap ${emailBold('Forgot password')} in the app. ${c.html}`, text: `Forgotten your password? Tap Forgot password in the app.
${c.text}` }
      : { html: html`Forgotten your password? Get a new one at ${emailLink(displayHost(forgot), forgot)}. ${c.html}`, text: `Forgotten your password? Get a new one at ${forgot}
${c.text}` };
  }

  const legal = [b.legalLine, [b.addressLine, b.website].filter(Boolean).join(' · ')].filter(Boolean) as string[];
  const htmlBody = renderBrandedEmail({
    organisation: org,
    logoUrl: b.logoUrl,
    kicker,
    preheader,
    title,
    subtitle,
    intro,
    button,
    details: { heading: 'Your details', rows },
    extra: extra?.html ?? null,
    help: help.html,
    signOff: org,
    footer: { why, legalLine: b.legalLine, addressLine: b.addressLine, website: b.website },
  });
  const text = plainTextEmail([
    title,
    subtitle,
    introText,
    [`${button.label}:`, button.href, button.note],
    ['YOUR DETAILS', ...rows.map((r) => `${r.label}: ${r.label === 'Website' ? b.siteUrl : textOf(r.value)}`)],
    extra?.text ?? null,
    help.text,
    org,
    ['--', `${why} Account emails are always sent.`, ...legal],
  ]);
  return { subject, preheader, html: htmlBody, text };
}

export type ResetEmailInput = {
  /** Which sign-ins the new password is for. */
  access: StaffAccess;
  firstName: string | null;
  email: string;
  link: string;
  linkMinutes: number;
  branding: AccountEmailBranding;
};

/** "Reset your password": one link, and the new password covers every sign-in the person has. */
export function buildPasswordResetEmail(input: ResetEmailInput): BuiltEmail {
  const b = input.branding;
  const first = firstNameOf(input.firstName);
  const greeting = first ? `Hi ${first},` : 'Hi,';
  const what =
    input.access === 'app'
      ? 'your Care app password'
      : input.access === 'both'
        ? 'your password for the CareFlow website and the Care app'
        : 'the password for your CareFlow account';
  const subject = input.access === 'app' ? 'Reset your Care app password' : 'Reset your CareFlow password';
  const intro = `We received a request to reset ${what}. Use the link below to choose a new password.`;
  const both = input.access === 'both' ? ' Your new password works for both.' : '';
  const expiry = `This link expires in ${input.linkMinutes} minutes and can be used once.`;
  const ignore = "If you didn't request this, you can ignore this email — your password won't change.";
  const kicker = input.access === 'app' ? 'Care app' : input.access === 'both' ? 'CareFlow + Care app' : 'CareFlow';
  const why = `You’re getting this because someone asked to reset the password for ${input.email}.`;
  const htmlBody = renderBrandedEmail({
    organisation: b.organisation,
    logoUrl: b.logoUrl,
    kicker,
    preheader: `${expiry} Only you will know your new password.`,
    title: 'Reset your password',
    subtitle: greeting,
    intro: `${intro}${both}`,
    button: { label: 'Choose a new password', href: input.link, note: expiry },
    details: null,
    extra: null,
    help: ignore,
    signOff: b.organisation,
    footer: { why, legalLine: b.legalLine, addressLine: b.addressLine, website: b.website },
  });
  const legal = [b.legalLine, [b.addressLine, b.website].filter(Boolean).join(' · ')].filter(Boolean) as string[];
  const text = plainTextEmail([
    greeting,
    `${intro}${both}`,
    input.link,
    expiry,
    ignore,
    b.organisation,
    ['--', `${why} Account emails are always sent.`, ...legal],
  ]);
  return { subject, preheader: expiry, html: htmlBody, text };
}
