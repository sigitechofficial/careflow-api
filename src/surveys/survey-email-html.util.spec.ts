import { surveyContactMessages, type ContactMessageInput } from './survey-contact-messages.util';
import { renderSurveyEmailHtml } from './survey-email-html.util';
import { daysUntil, everydayOrganisationName, formatEmailDate } from './survey-email-branding';

const base: ContactMessageInput = {
  kind: 'EMPLOYEE',
  anonymous: false,
  reminder: false,
  title: 'Your working hours and availability',
  firstName: 'Jane',
  link: 'https://care.example/survey/tok-123',
  portalLink: null,
  closesOn: '30 Nov 2026, 17:00',
  closesDate: 'Monday 30 November 2026',
  daysLeft: 3,
  organisation: 'Allfor Care',
  textRepliesSupported: false,
  minutes: 6,
  contactPhone: '0208 930 3085',
  contactEmail: 'info@allforcare.co.uk',
  logoUrl: 'https://allforcare.co.uk/logo.png',
  brand: {
    legalName: 'Allfor Care Services Limited',
    companyNumber: '01234567',
    cqcProviderId: '1-000000000',
    website: 'https://allforcare.co.uk',
    brandColour: '#132573',
  },
};

describe('survey emails (agreed wording and layout)', () => {
  it('staff invitation: short personal subject, button to their own link, time, closing date, help and footer', () => {
    const m = surveyContactMessages(base);
    expect(m.emailSubject).toBe("Jane, we'd like your views: Your working hours and availability");
    expect(m.emailHtml).toContain('<html lang="en-GB"');
    expect(m.emailHtml).toContain('src="https://allforcare.co.uk/logo.png"');
    expect(m.emailHtml).toContain('Hi Jane,');
    expect(m.emailHtml).toContain('href="https://care.example/survey/tok-123"');
    expect(m.emailHtml).toContain('Start the survey');
    expect(m.emailHtml).toContain('<strong>6 minutes</strong>');
    expect(m.emailHtml).toContain('Open until <strong>Monday 30 November 2026</strong>');
    expect(m.emailHtml).toContain('What happens to your answers');
    expect(m.emailHtml).toContain("please don&#39;t forward this email");
    expect(m.emailHtml).toContain('Need help?');
    expect(m.emailHtml).toContain('call the office on 0208 930 3085');
    expect(m.emailHtml).toContain('Allfor Care Services Limited · Registered in England and Wales, company number 01234567');
    expect(m.emailHtml).toContain('provider ID 1-000000000');
    expect(m.emailHtml).toContain('because you work with Allfor Care');
    expect(m.emailText).toContain('Start the survey: https://care.example/survey/tok-123');
    expect(m.emailText).toContain('It takes about 6 minutes, and you can do it on your phone.');
  });

  it('anonymous staff survey: no personal link anywhere; anonymity explained; how to answer instead of a button', () => {
    const m = surveyContactMessages({ ...base, anonymous: true, staffPlaces: { app: true, web: true, webLink: 'https://care.example/my-surveys' } });
    expect(m.emailSubject).toBe('Your views, anonymously: Your working hours and availability');
    for (const part of [m.emailHtml, m.emailText, m.emailSubject]) expect(part).not.toContain('tok-123');
    expect(m.emailHtml).toContain('This survey is anonymous:');
    expect(m.emailHtml).toContain('How to answer');
    expect(m.emailHtml).not.toContain('Start the survey');
    expect(m.emailHtml).toContain("We can&#39;t see who said what");
  });

  it('web-only staff on an anonymous survey get a button to My surveys (no token)', () => {
    const m = surveyContactMessages({ ...base, anonymous: true, staffPlaces: { app: false, web: true, webLink: 'https://care.example/my-surveys' } });
    expect(m.emailHtml).toContain('Open My surveys');
    expect(m.emailHtml).toContain('href="https://care.example/my-surveys"');
  });

  it('person we support: "Dear", portal button, help from family, never affects care, other formats', () => {
    const m = surveyContactMessages({ ...base, kind: 'SERVICE_USER', firstName: 'Mrs Smith', link: null, portalLink: 'https://care.example/portal/surveys', minutes: 10 });
    expect(m.emailHtml).toContain('Dear Mrs Smith,');
    expect(m.emailHtml).toContain('Open your survey');
    expect(m.emailHtml).toContain('href="https://care.example/portal/surveys"');
    expect(m.emailHtml).toContain('A family member or someone you trust can help you');
    expect(m.emailHtml).toContain('never affect the care you receive');
    expect(m.emailHtml).toContain('Prefer to answer another way?');
    expect(m.emailHtml).toContain('The Allfor Care team');
    expect(m.emailHtml).toContain('provides your care');
  });

  it('care has ended, anonymous: paper or phone only, never the portal; unsubscribe link', () => {
    const m = surveyContactMessages({ ...base, kind: 'SERVICE_USER', anonymous: true, link: null, portalLink: 'https://care.example/portal/surveys', paperOnly: true, unsubscribeLink: 'https://care.example/survey-unsubscribe/x' });
    expect(m.emailHtml).not.toContain('portal/surveys');
    expect(m.emailHtml).toContain('paper copy');
    expect(m.emailHtml).toContain('href="https://care.example/survey-unsubscribe/x"');
    expect(m.emailText).toContain('To stop all survey messages from us, for good: https://care.example/survey-unsubscribe/x');
  });

  it('reminders: days left in the subject, short body, thanks anyone who has answered', () => {
    expect(surveyContactMessages({ ...base, reminder: true }).emailSubject).toBe('Reminder: 3 days left to share your views on Your working hours and availability');
    expect(surveyContactMessages({ ...base, reminder: true, daysLeft: 1 }).emailSubject).toBe('Reminder: 1 day left to share your views on Your working hours and availability');
    expect(surveyContactMessages({ ...base, reminder: true, daysLeft: 0 }).emailSubject).toBe('Last day to share your views: Your working hours and availability');
    expect(surveyContactMessages({ ...base, reminder: true, daysLeft: null }).emailSubject).toBe('Reminder: Your working hours and availability');
    const m = surveyContactMessages({ ...base, reminder: true });
    expect(m.emailHtml).toContain('Just a reminder that our survey');
    expect(m.emailHtml).toContain('Answer the survey');
    expect(m.emailHtml).toContain('already answered, thank you');
    expect(m.emailHtml).not.toContain('What happens to your answers');
  });

  it('a ready-made survey can carry its own subject and opening', () => {
    const m = surveyContactMessages({ ...base, inviteSubject: '{{firstName}}, how are your working hours suiting you?', inviteIntro: "We'd like to hear how your hours are suiting you." });
    expect(m.emailSubject).toBe('Jane, how are your working hours suiting you?');
    expect(m.emailHtml).toContain('how your hours are suiting you');
    expect(surveyContactMessages({ ...base, firstName: null, inviteSubject: '{{firstName}}, how are your hours?' }).emailSubject).toBe('How are your hours?');
  });

  it('escapes everything, ignores non-https logos, and keeps white button text readable', () => {
    const html = renderSurveyEmailHtml({
      organisation: '<b>Org</b>',
      logoUrl: 'http://localhost/logo.png',
      brandColour: '#ffee00',
      preheader: 'x',
      greeting: 'Hello <script>',
      paragraphs: [],
      button: { label: 'Go', href: 'https://x.example/a' },
      sections: [],
      signOff: [],
      footer: { legalLines: [], contactLine: null, website: null, why: null },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Org&lt;/b&gt;');
    expect(html).not.toContain('localhost/logo.png');
    expect(html).not.toContain('#ffee00'); // too light for white text: falls back to navy
  });

  it('organisation names, dates and days left', () => {
    expect(everydayOrganisationName('Allfor Care Services Limited')).toBe('Allfor Care');
    expect(everydayOrganisationName('Sunrise Homecare Ltd')).toBe('Sunrise Homecare');
    expect(everydayOrganisationName('Kind Hands')).toBe('Kind Hands');
    expect(formatEmailDate(new Date('2026-11-30T17:00:00Z'))).toBe('Monday 30 November 2026');
    expect(daysUntil(new Date('2026-11-30T17:00:00Z'), 'Europe/London', new Date('2026-11-27T09:00:00Z'))).toBe(3);
    expect(daysUntil(new Date('2026-11-27T23:30:00Z'), 'Europe/London', new Date('2026-11-27T09:00:00Z'))).toBe(0);
  });
});
