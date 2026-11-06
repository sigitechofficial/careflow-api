import { surveyContactMessages, type ContactMessageInput } from './survey-contact-messages.util';
import { renderSurveyEmailHtml } from './survey-email-html.util';

const base: ContactMessageInput = {
  kind: 'EMPLOYEE',
  anonymous: false,
  reminder: false,
  title: 'Your working hours and availability',
  firstName: 'Jane',
  link: 'https://care.example/survey/tok-123',
  portalLink: null,
  closesOn: '30 Nov 2026, 17:00',
  organisation: 'Allfor Care',
  textRepliesSupported: false,
  minutes: 6,
  contactPhone: '0161 000 0000',
  contactEmail: 'office@care.example',
};

describe('survey email (HTML and plain text)', () => {
  it('a named invitation: organisation, button to their own link, time, closing date and help', () => {
    const m = surveyContactMessages(base);
    expect(m.emailSubject).toBe('Allfor Care would value your views: Your working hours and availability');
    expect(m.emailHtml).toContain('<html lang="en-GB">');
    expect(m.emailHtml).toContain('Allfor Care');
    expect(m.emailHtml).toContain('href="https://care.example/survey/tok-123"');
    expect(m.emailHtml).toContain('Start the survey');
    expect(m.emailHtml).toContain('6 minutes');
    expect(m.emailHtml).toContain('30 Nov 2026, 17:00');
    expect(m.emailHtml).toContain('0161 000 0000');
    expect(m.emailHtml).toContain('large print');
    expect(m.emailText).toContain('It takes about 6 minutes.');
    expect(m.emailText).toContain('office@care.example');
  });

  it('an anonymous staff survey: no personal link anywhere, a "how to answer" box instead of a button', () => {
    const m = surveyContactMessages({ ...base, anonymous: true, staffPlaces: { app: true, web: true, webLink: 'https://care.example/my-surveys' } });
    expect(m.emailHtml).not.toContain('tok-123');
    expect(m.emailText).not.toContain('tok-123');
    expect(m.emailHtml).toContain('How to answer');
    expect(m.emailHtml).not.toContain('Start the survey');
    expect(m.emailHtml).toContain('Anonymous: not linked to your name');
  });

  it('web-only staff on an anonymous survey get a button to My surveys (no token)', () => {
    const m = surveyContactMessages({ ...base, anonymous: true, staffPlaces: { app: false, web: true, webLink: 'https://care.example/my-surveys' } });
    expect(m.emailHtml).toContain('Open My surveys');
    expect(m.emailHtml).toContain('href="https://care.example/my-surveys"');
  });

  it('people we support: portal button, on-behalf note, care wording', () => {
    const m = surveyContactMessages({ ...base, kind: 'SERVICE_USER', link: null, portalLink: 'https://care.example/portal/surveys' });
    expect(m.emailHtml).toContain('Open your portal');
    expect(m.emailHtml).toContain('on your behalf');
    expect(m.emailHtml).toContain('provides your care');
  });

  it('care has ended, anonymous: paper or phone only, never the portal', () => {
    const m = surveyContactMessages({ ...base, kind: 'SERVICE_USER', anonymous: true, link: null, portalLink: null, paperOnly: true, unsubscribeLink: 'https://care.example/survey-unsubscribe/x' });
    expect(m.emailHtml).not.toContain('Open your portal');
    expect(m.emailHtml).toContain('paper copy');
    expect(m.emailHtml).toContain('href="https://care.example/survey-unsubscribe/x"');
  });

  it('a reminder says so in the subject and thanks anyone who has answered', () => {
    const m = surveyContactMessages({ ...base, reminder: true });
    expect(m.emailSubject).toBe('Reminder: Your working hours and availability (open until 30 Nov 2026, 17:00)');
    expect(m.emailHtml).toContain('Answer the survey');
    expect(m.emailHtml).toContain('If you have answered since');
  });

  it('escapes everything it is given and ignores non-https logos', () => {
    const html = renderSurveyEmailHtml({
      organisation: '<b>Org</b>',
      logoUrl: 'http://localhost/logo.png',
      preheader: 'x',
      heading: 'A "survey" & <script>',
      greeting: 'Hello,',
      paragraphs: [],
      details: [],
      notes: [],
      help: null,
      footer: [],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Org&lt;/b&gt;');
    expect(html).not.toContain('localhost/logo.png');
  });
});
