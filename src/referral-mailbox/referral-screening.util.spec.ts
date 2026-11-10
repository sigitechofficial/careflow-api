import { DEFAULT_SCREENING, normaliseScreening, screenByRules, senderMatches } from './referral-screening.util';

const s = DEFAULT_SCREENING;
const email = (fromEmail: string, subject: string, bodyText = '') => ({ fromEmail, subject, bodyText });
const none = { knownSender: false };

describe('email screening (free rules)', () => {
  it('brings in the NHS, councils and people we already deal with', () => {
    expect(screenByRules(email('discharge.team@nhs.net', 'Patient update'), s, none).decision).toBe('BRING');
    expect(screenByRules(email('brokerage@croydon.gov.uk', 'Weekly bulletin'), s, none).decision).toBe('BRING');
    expect(screenByRules(email('a@hospital.nhs.uk', 'x'), s, none).decision).toBe('BRING');
    expect(screenByRules(email('jane@gmail.com', 'Hello again'), s, { knownSender: true }).reason).toMatch(/before/);
  });

  it('skips automated senders, junk subjects, blocked senders and mailing lists', () => {
    expect(screenByRules(email('no-reply@accounts.google.com', 'Security alert'), s, none)).toEqual({ decision: 'SKIP', reason: 'Automated sender (no-reply, notifications…)' });
    expect(screenByRules(email('team@quickbooks.com', 'Join our webinar this week'), s, none).decision).toBe('SKIP');
    expect(screenByRules(email('x@pinterest.com', 'For Chaudhry', 'Pins you may like. Unsubscribe here.'), s, none).reason).toMatch(/Mailing list/);
    expect(screenByRules(email('sales@vendor.com', 'Hello'), { ...s, blockedSenders: ['@vendor.com'] }, none).reason).toMatch(/Blocked/);
  });

  it('brings in emails about care even from a no-reply address, and family enquiries from anyone', () => {
    expect(screenByRules(email('noreply@portal.example', 'New care package referral'), s, none).decision).toBe('BRING');
    expect(screenByRules(email('dev@glocal.com', 'Prices and a quote for my mother'), s, none)).toEqual({ decision: 'BRING', reason: 'Mentions care' });
    expect(screenByRules(email('bob@gmail.com', 'Help please', 'My dad has dementia and needs visits a day'), s, none).decision).toBe('BRING');
  });

  it('leaves the rest unsure (for the quick check), and brings everything when screening is off', () => {
    expect(screenByRules(email('bob@gmail.com', 'Question', 'Can you call me back?'), s, none).decision).toBe('UNSURE');
    expect(screenByRules(email('no-reply@x.com', 'Security alert'), { ...s, mode: 'OFF' }, none).decision).toBe('BRING');
  });

  it('matches senders by address, domain and domain ending', () => {
    expect(senderMatches('sam@nhs.net', ['sam@nhs.net'])).toBe('sam@nhs.net');
    expect(senderMatches('sam@nhs.net', ['@nhs.net'])).toBe('@nhs.net');
    expect(senderMatches('x@croydon.gov.uk', ['.gov.uk'])).toBe('.gov.uk');
    expect(senderMatches('x@notgov.uk', ['.gov.uk'])).toBeNull();
    expect(normaliseScreening({ mode: 'NOPE', trustedSenders: [' @A.com ', 'bad entry'] })).toEqual({ mode: 'RULES_AND_AI', trustedSenders: ['@a.com'], blockedSenders: [] });
  });
});
