import type { AccountEmailBranding } from './account-email-branding';
import { buildPasswordResetEmail, buildWelcomeEmail, setPasswordLink, type WelcomeEmailInput } from './staff-account-emails.content';
import { emailImageUrl, telHref } from './branded-email-layout.util';

const branding: AccountEmailBranding = {
  organisation: 'Allfor Care',
  logoUrl: 'https://careflow.example.test/email/allfor-care-logo.png',
  legalLine: 'ALLFOR CARE SERVICES LIMITED · Company no. 05142064 · CQC provider ID 1-101656545',
  addressLine: '15 Maswell Park Road, Hounslow TW3 2DL',
  website: 'https://www.allforcare.co.uk',
  companyPhone: '0208 930 3085',
  siteUrl: 'https://careflow.example.test',
  setPasswordUrlBase: 'https://careflow.example.test',
  appStoreBadgeUrl: 'cid:careflow-app-store-badge',
  googlePlayBadgeUrl: 'cid:careflow-google-play-badge',
  appStoreUrl: 'https://apps.apple.com/gb/app/id1234567890',
  playStoreUrl: 'https://play.google.com/store/apps/details?id=com.careflow.carer',
};

function input(over: Partial<WelcomeEmailInput> = {}): WelcomeEmailInput {
  return {
    access: 'website',
    firstName: 'Priya',
    email: 'priya.shah@example.test',
    link: 'https://careflow.example.test/auth/reset-password?token=TOKEN123',
    linkHours: 72,
    employment: { role: 'Coordinator', jobTitle: 'Care Coordinator', accessLevel: 'Branch Administrator', workArea: 'Administration' },
    branch: { name: 'Allfor Care Hounslow', phone: '020 8898 2867' },
    branding,
    ...over,
  };
}

describe('staff welcome emails', () => {
  it('A · website login: subject, headline, one button, details and help line', () => {
    const e = buildWelcomeEmail(input());
    expect(e.subject).toBe('Your CareFlow account is ready');
    expect(e.html).toContain('Welcome, Priya');
    expect(e.html).toContain('href="https://careflow.example.test/auth/reset-password?token=TOKEN123"');
    expect(e.html.match(/Choose my password/g)).toHaveLength(1);
    expect(e.html).toContain('Works once, for 72 hours. Only you will know your password.');
    for (const label of ['Sign in with', 'Job title', 'Access level', 'Work area', 'Branch']) expect(e.html).toContain(label);
    // A has no Role row and no app section.
    expect(e.html).not.toContain('>Role<');
    expect(e.html).not.toContain('get-app');
    expect(e.html).toContain('href="https://careflow.example.test/auth/forgot-password"');
    expect(e.html).toContain('href="tel:+442088982867"');
    expect(e.html).toContain('src="https://careflow.example.test/email/allfor-care-logo.png"');
    expect(e.html).toContain('ALLFOR CARE SERVICES LIMITED · Company no. 05142064 · CQC provider ID 1-101656545');
    expect(e.html).toContain('Account emails are always sent.');
    expect(e.html).toContain('lang="en-GB"');
  });

  it('B · Care app: store badges link straight to each store, and the app forgot-password hint', () => {
    const e = buildWelcomeEmail(input({ access: 'app', firstName: 'Amir', link: setPasswordLink('https://careflow.example.test', 'T0K', false) }));
    expect(e.subject).toBe('Set up your Allfor Care app');
    expect(e.html).toContain('Welcome to the team, Amir');
    expect(e.html).toContain('href="https://careflow.example.test/app/set-password?token=T0K"');
    expect(e.html).toContain('href="https://apps.apple.com/gb/app/id1234567890"');
    expect(e.html).toContain('src="cid:careflow-app-store-badge"');
    expect(e.html).toContain('href="https://play.google.com/store/apps/details?id=com.careflow.carer"');
    expect(e.html).toContain('Forgot password');
    expect(e.html).toContain('>Role<');
    expect(e.html).not.toContain('Access level');
    expect(e.text).toContain('Android (Google Play): https://play.google.com/store/apps/details?id=com.careflow.carer');
    expect(e.text).toContain('iPhone (App Store): https://apps.apple.com/gb/app/id1234567890');
  });

  it('C · both: one password for the website and the app', () => {
    const e = buildWelcomeEmail(input({ access: 'both', firstName: 'Grace' }));
    expect(e.subject).toBe('Your CareFlow account and Care app are ready');
    expect(e.html).toContain('Choose one password. It works for both the CareFlow website and the Care app.');
    expect(e.html).toContain('>Website<');
    expect(e.html).toContain('href="https://apps.apple.com/gb/app/id1234567890"');
    expect(e.text).toContain('Website: https://careflow.example.test');
  });

  it('always has a plain-text part with the link, the details and the legal footer', () => {
    const e = buildWelcomeEmail(input());
    expect(e.text).toContain('Choose my password:\nhttps://careflow.example.test/auth/reset-password?token=TOKEN123');
    expect(e.text).toContain('Sign in with: priya.shah@example.test');
    expect(e.text).toContain('Access level: Branch Administrator');
    expect(e.text).toContain('Call Allfor Care Hounslow on 020 8898 2867.');
    expect(e.text).toContain('ALLFOR CARE SERVICES LIMITED');
    expect(e.text).not.toMatch(/<[a-z]/i);
  });

  it('leaves out rows with no value and falls back to the company phone', () => {
    const e = buildWelcomeEmail(input({ employment: {}, branch: null }));
    expect(e.html).not.toContain('Job title');
    expect(e.html).not.toContain('>Branch<');
    expect(e.text).toContain('Call Allfor Care on 0208 930 3085.');
  });

  it('says the link also replaces the other account’s password when that account exists', () => {
    expect(buildWelcomeEmail(input({ alsoReplaces: 'app' })).text).toContain('works in the Care app too');
    expect(buildWelcomeEmail(input({ access: 'app', alsoReplaces: 'website' })).text).toContain('CareFlow website password too');
  });

  it('escapes names and details', () => {
    const e = buildWelcomeEmail(input({ firstName: '<script>x</script>', employment: { jobTitle: 'A & B "quoted"' } }));
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('A &amp; B &quot;quoted&quot;');
  });

  it('shows the organisation name instead of a logo it can’t load', () => {
    const e = buildWelcomeEmail(input({ branding: { ...branding, logoUrl: null } }));
    expect(e.html).not.toContain('<img src="https://careflow.example.test/email/allfor-care-logo.png"');
    expect(e.html).toContain('>Allfor Care</span>');
  });
});

describe('welcome emails when the office set the password', () => {
  it('never contains the password or a set-password link, and says their manager gives it', () => {
    for (const access of ['website', 'app', 'both'] as const) {
      const e = buildWelcomeEmail(input({ access, passwordGiven: true, link: 'https://careflow.example.test/auth/reset-password?token=SHOULD-NOT-APPEAR' }));
      expect(e.html).not.toContain('SHOULD-NOT-APPEAR');
      expect(e.text).not.toContain('SHOULD-NOT-APPEAR');
      expect(e.html).not.toContain('Choose my password');
      expect(e.text).toContain('Your manager will give you your password.');
    }
  });

  it('website: a sign-in button; app: the Care app button', () => {
    const a = buildWelcomeEmail(input({ passwordGiven: true }));
    expect(a.html).toContain('href="https://careflow.example.test/auth/login"');
    expect(a.html).toContain('Sign in to CareFlow');
    const b = buildWelcomeEmail(input({ access: 'app', passwordGiven: true }));
    expect(b.html).toContain('>Get the Care app<');
    expect(b.html).toContain('href="https://careflow.example.test/get-app"');
    const c = buildWelcomeEmail(input({ access: 'both', passwordGiven: true }));
    expect(c.text).toContain('One password works for both the CareFlow website and the Care app.');
  });
});

describe('password reset email', () => {
  it('app only: Care app wording and the app page', () => {
    const e = buildPasswordResetEmail({ access: 'app', firstName: 'Amir', email: 'a@example.test', link: 'https://x.test/app/set-password?token=t', linkMinutes: 60, branding });
    expect(e.subject).toBe('Reset your Care app password');
    expect(e.text).toContain('Hi Amir,');
    expect(e.text).toContain('This link expires in 60 minutes and can be used once.');
    expect(e.html).toContain('href="https://x.test/app/set-password?token=t"');
  });

  it('both: says the new password works for both', () => {
    const e = buildPasswordResetEmail({ access: 'both', firstName: null, email: 'g@example.test', link: 'https://x.test/auth/reset-password?token=t', linkMinutes: 60, branding });
    expect(e.subject).toBe('Reset your CareFlow password');
    expect(e.text).toContain('Hi,');
    expect(e.text).toContain('Your new password works for both.');
  });
});

describe('email helpers', () => {
  it('images: https always, http only on this computer outside production', () => {
    expect(emailImageUrl('https://a.test/x.png', {})).toBe('https://a.test/x.png');
    expect(emailImageUrl('http://localhost:5174/email/x.png', { NODE_ENV: 'development' })).toBe('http://localhost:5174/email/x.png');
    expect(emailImageUrl('http://localhost:5174/email/x.png', { NODE_ENV: 'production' })).toBeNull();
    expect(emailImageUrl('http://evil.test/x.png', {})).toBeNull();
    expect(emailImageUrl('data:image/png;base64,AAA', {})).toBeNull();
    expect(emailImageUrl('/uploads/company/logo.png', {})).toBeNull();
  });

  it('UK phone numbers become tel: links', () => {
    expect(telHref('020 8898 2867')).toBe('tel:+442088982867');
    expect(telHref('07903 068899')).toBe('tel:+447903068899');
    expect(telHref('+44 20 8898 2867')).toBe('tel:+442088982867');
  });

  it('set-password links: website page when they have an office login, else the app page', () => {
    expect(setPasswordLink('https://s.test', 'a b', true)).toBe('https://s.test/auth/reset-password?token=a%20b');
    expect(setPasswordLink('https://s.test', 'tok', false)).toBe('https://s.test/app/set-password?token=tok');
  });
});

describe('Care app badges follow which stores have the app', () => {
  it('Android only (iPhone in review): only the Google Play badge, linking straight to the store', () => {
    const e = buildWelcomeEmail({
      access: 'app', firstName: 'Devon', email: 'devon@example.test', link: 'https://careflow.example.test/app/set-password?token=t', linkHours: 72,
      employment: { jobTitle: 'Carer', role: 'Carer', workArea: 'Care', accessLevel: 'Carer/Domestic' }, branch: null,
      branding: { ...branding, appStoreUrl: null },
    });
    expect(e.html).toContain('href="https://play.google.com/store/apps/details?id=com.careflow.carer"');
    expect(e.html).not.toContain('cid:careflow-app-store-badge');
    expect(e.html).toContain('The iPhone app is on its way');
    expect(e.text).toContain('Android (Google Play): https://play.google.com/store/apps/details?id=com.careflow.carer');
  });
});
