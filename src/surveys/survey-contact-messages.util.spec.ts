import { surveyContactMessages, type ContactMessageInput } from './survey-contact-messages.util';
import { MAX_TEXT_MESSAGE_LENGTH } from '../text-messages/text-message.service';

const base: ContactMessageInput = {
  kind: 'EMPLOYEE',
  anonymous: false,
  reminder: true,
  title: 'Annual staff survey',
  firstName: 'Sam',
  link: 'https://care.example/survey/tok-123',
  portalLink: 'https://care.example/portal/surveys',
  closesOn: '30 November 2026',
  organisation: 'Example Care',
  textRepliesSupported: false,
};

describe('surveyContactMessages', () => {
  it('named surveys carry the person’s own link and say it is personal', () => {
    const m = surveyContactMessages(base);
    expect(m.emailText).toContain('https://care.example/survey/tok-123');
    expect(m.emailText).toContain('personal to you');
    expect(m.text).toContain('https://care.example/survey/tok-123');
    expect(m.emailSubject).toBe('Reminder: Annual staff survey (open until 30 November 2026)');
  });

  it('anonymous surveys never carry a personal link, in any channel, and never say the person has not answered', () => {
    for (const kind of ['EMPLOYEE', 'SERVICE_USER'] as const) {
      const m = surveyContactMessages({ ...base, kind, anonymous: true });
      const all = [m.emailSubject, m.emailText, m.pushTitle, m.pushBody, m.text].join('\n');
      expect(all).not.toContain('tok-123');
      expect(all).not.toMatch(/not (yet )?answered|haven.t answered/i);
      expect(m.emailText).toContain('not linked to your name');
    }
    expect(surveyContactMessages({ ...base, anonymous: true }).text).toContain('carer app');
    expect(surveyContactMessages({ ...base, kind: 'SERVICE_USER', anonymous: true }).text).toContain('portal');
  });

  it('offers "Reply STOP" only when the text provider handles replies', () => {
    expect(surveyContactMessages(base).text).not.toContain('STOP');
    expect(surveyContactMessages({ ...base, textRepliesSupported: true }).text).toContain('Reply STOP');
  });

  it('keeps a text within three messages even with a long title', () => {
    const m = surveyContactMessages({ ...base, title: 'x'.repeat(300), textRepliesSupported: true });
    expect(m.text.length).toBeLessThanOrEqual(MAX_TEXT_MESSAGE_LENGTH);
  });

  it('tells people we support that someone can answer for them', () => {
    expect(surveyContactMessages({ ...base, kind: 'SERVICE_USER' }).emailText).toContain('on your behalf');
  });

  it('anonymous staff surveys point to wherever the person can answer signed in, never a link or token', () => {
    const anon = { ...base, anonymous: true, link: 'https://care.example/survey/tok-123' };
    const both = surveyContactMessages({ ...anon, staffPlaces: { app: true, web: true, webLink: 'https://care.example/my-surveys' } });
    expect(both.emailText).toContain('carer app');
    expect(both.emailText).toContain('https://care.example/my-surveys');
    expect(both.text).toContain('My surveys');
    const webOnly = surveyContactMessages({ ...anon, staffPlaces: { app: false, web: true, webLink: 'https://care.example/my-surveys' } });
    expect(webOnly.emailText).not.toContain('carer app');
    expect(webOnly.emailText).toContain('My surveys');
    const neither = surveyContactMessages({ ...anon, staffPlaces: { app: false, web: false, webLink: null } });
    expect(neither.emailText).toContain('paper copy');
    for (const m of [both, webOnly, neither]) {
      expect(`${m.emailText} ${m.text} ${m.pushBody}`).not.toContain('tok-123');
    }
  });
});
