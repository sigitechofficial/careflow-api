import {
  checkApplication,
  historyFromExtraction,
  normaliseRecruitmentRules,
  normaliseRecruitmentScreening,
  screenApplicationByRules,
  splitName,
  yesNoToBool,
} from './recruitment-inbox.util';

describe('checkApplication', () => {
  const read = (over: Record<string, unknown> = {}) =>
    ({ rightToWork: 'YES', drivesForWork: 'UNKNOWN', employmentHistory: [], ...over }) as Parameters<typeof checkApplication>[0];

  it('uses defaults for unknown or missing outcomes', () => {
    expect(normaliseRecruitmentRules({ rightToWork: 'NOPE', drivesForWork: 'DECLINE' })).toEqual({
      rightToWork: 'NOTE',
      drivesForWork: 'DECLINE',
      careExperience: 'OFF',
    });
  });

  it('declines only on a clear "no"; not stated needs staff', () => {
    const rules = normaliseRecruitmentRules({ rightToWork: 'DECLINE', drivesForWork: 'STAFF' });
    expect(checkApplication(read({ rightToWork: 'NO' }), rules).declined).toBe('Right to work in the UK: no');
    const unknown = checkApplication(read({ rightToWork: 'UNKNOWN' }), rules);
    expect(unknown.declined).toBeNull();
    expect(unknown.hold).toBe('Right to work in the UK: not stated');
    expect(checkApplication(read({ drivesForWork: 'YES' }), rules)).toMatchObject({ declined: null, hold: null });
  });

  it('works out care experience from the CV and leaves notes and switched-off rules alone', () => {
    const rules = normaliseRecruitmentRules({ rightToWork: 'OFF', careExperience: 'NOTE' });
    const job = { kind: 'JOB', careRole: false };
    const none = checkApplication(read({ employmentHistory: [job] }), rules);
    expect(none.checks).toEqual([expect.objectContaining({ key: 'careExperience', answer: 'NO', met: false })]);
    expect(none.hold).toBeNull();
    expect(checkApplication(read({ employmentHistory: [{ ...job, careRole: true }] }), rules).checks[0].answer).toBe('YES');
  });
});

const job = (over: Record<string, unknown> = {}) => ({
  kind: 'JOB' as const,
  from: '2021-03',
  to: '2023-06',
  ongoing: false,
  employer: 'Sunrise Care',
  jobTitle: 'Carer',
  reasonForLeaving: '',
  careRole: true,
  explanation: '',
  ...over,
});

describe('historyFromExtraction', () => {
  it('keeps complete jobs, oldest first, with the current job open-ended', () => {
    const { entries, incomplete } = historyFromExtraction([
      job({ from: '2023-07', to: '', ongoing: true, employer: 'Home Helpers' }),
      job(),
    ]);
    expect(incomplete).toBe(0);
    expect(entries.map((e) => [e.from, e.to, e.employer])).toEqual([
      ['2021-03', '2023-06', 'Sunrise Care'],
      ['2023-07', null, 'Home Helpers'],
    ]);
    expect(entries[0].reasonForLeaving).toBeNull();
  });

  it('counts rows without usable dates instead of guessing', () => {
    const { entries, incomplete } = historyFromExtraction([
      job({ from: '' }),
      job({ to: '', ongoing: false }),
      job({ from: '2022-05', to: '2021-01' }),
      job({ from: '2019' }),
    ]);
    expect(entries).toEqual([]);
    expect(incomplete).toBe(4);
  });

  it('keeps an explained gap', () => {
    const { entries } = historyFromExtraction([job({ kind: 'GAP', from: '2020-01', to: '2020-12', explanation: 'Caring for a parent' })]);
    expect(entries).toEqual([{ kind: 'GAP', from: '2020-01', to: '2020-12', explanation: 'Caring for a parent' }]);
  });
});

describe('helpers', () => {
  it('splits a From name', () => {
    expect(splitName('"Jane Ann Smith"')).toEqual({ firstName: 'Jane Ann', lastName: 'Smith' });
    expect(splitName('Jane')).toEqual({ firstName: 'Jane', lastName: '' });
    expect(splitName(null)).toEqual({ firstName: '', lastName: '' });
  });

  it('turns YES / NO / UNKNOWN into true / false / null', () => {
    expect([yesNoToBool('YES'), yesNoToBool('NO'), yesNoToBool('UNKNOWN')]).toEqual([true, false, null]);
  });
});

describe('screenApplicationByRules', () => {
  const email = (over: Partial<Parameters<typeof screenApplicationByRules>[0]> = {}) => ({
    fromEmail: 'jane@example.com',
    subject: 'Hello',
    bodyText: 'Hi there',
    attachments: [] as { fileName: string }[],
    ...over,
  });
  const decide = (over: Partial<Parameters<typeof screenApplicationByRules>[0]> = {}) => screenApplicationByRules(email(over)).decision;

  it('reads an application', () => {
    expect(decide({ subject: 'Application for Care Worker (VAC-0005)' })).toBe('READ');
    expect(decide({ bodyText: 'Please find my CV attached.' })).toBe('READ');
  });

  it('reads a job board application from a no-reply sender', () => {
    expect(decide({ fromEmail: 'noreply@indeed.com', subject: 'New application: Care Worker - Jane Smith' })).toBe('READ');
  });

  it('reads an email with a CV-like file even without job words', () => {
    expect(decide({ attachments: [{ fileName: 'Jane Smith.docx' }] })).toBe('READ');
  });

  it('sets aside job alerts sent to job seekers', () => {
    expect(decide({ fromEmail: 'alert@jobalert.indeed.com', subject: 'PHP Laravel Developer at BNZ Technologies. 20 more laravel jobs' })).toBe('SKIP');
    expect(decide({ fromEmail: 'donotreply@match.indeed.com', subject: 'PHP Developer @ Compass Training' })).toBe('SKIP');
    expect(decide({ subject: 'New jobs for you', bodyText: 'Care worker roles near you' })).toBe('SKIP');
  });

  it('leaves mail with no clear sign either way to the quick check', () => {
    expect(screenApplicationByRules(email())).toEqual({ decision: 'UNSURE', reason: 'No clear sign either way' });
    expect(decide({ fromEmail: 'info@bank.example.com', subject: 'Login Alert', bodyText: 'You signed in to DigiBank.' })).toBe('UNSURE');
  });

  it('follows the settings: off, trusted, blocked and people who applied before', () => {
    const settings = { mode: 'RULES_AND_AI' as const, trustedSenders: ['@indeedemail.com'], blockedSenders: ['@spam.example.com'] };
    expect(screenApplicationByRules(email({ subject: 'Security alert' }), { ...settings, mode: 'OFF' }).decision).toBe('READ');
    expect(screenApplicationByRules(email({ fromEmail: 'x@indeedemail.com' }), settings)).toEqual({ decision: 'READ', reason: 'Trusted sender (@indeedemail.com)' });
    expect(screenApplicationByRules(email({ fromEmail: 'a@spam.example.com', subject: 'Job application' }), settings).decision).toBe('SKIP');
    expect(screenApplicationByRules(email(), settings, { knownSender: true }).reason).toBe('Has applied to us before');
  });

  it('with "open vacancies only", reads only emails that name one of our open vacancies', () => {
    const settings = { mode: 'RULES_AND_AI' as const, trustedSenders: ['@indeedemail.com'], blockedSenders: [], openVacanciesOnly: true };
    const openVacancies = [
      { reference: 'VAC-0012', title: 'Care Assistant' },
      { reference: 'VAC-0003', title: 'Senior Carer (Nights)' },
    ];
    const screen = (over: Partial<Parameters<typeof screenApplicationByRules>[0]>, knownSender = false) =>
      screenApplicationByRules(email(over), settings, { knownSender, openVacancies });
    expect(screen({ subject: 'Application for VAC-0012' })).toEqual({ decision: 'READ', reason: 'For our vacancy VAC-0012 (Care Assistant)' });
    expect(screen({ subject: 'Applying', bodyText: 'Re your advert vac 12, CV attached' }).decision).toBe('READ');
    expect(screen({ subject: 'Applying for the care  assistant role' }).decision).toBe('READ');
    expect(screen({ bodyText: 'I would like the Senior Carer (Nights) job.' }).decision).toBe('READ');
    expect(screen({ subject: 'Application for VAC-0120' })).toEqual({ decision: 'SKIP', reason: 'Not for one of our open vacancies' });
    expect(screen({ subject: 'Application for Laravel developer', attachments: [{ fileName: 'cv.pdf' }] }).decision).toBe('SKIP');
    // Trusted senders and people who applied before are still read.
    expect(screen({ fromEmail: 'x@indeedemail.com', subject: 'New applicant' }).decision).toBe('READ');
    expect(screen({ subject: 'Hello' }, true).decision).toBe('READ');
    // No open vacancies: nothing is brought in.
    expect(screenApplicationByRules(email({ subject: 'Application for VAC-0012' }), settings, { knownSender: false }).decision).toBe('SKIP');
  });

  it('keeps "open vacancies only" off unless it is set', () => {
    expect(normaliseRecruitmentScreening(undefined).openVacanciesOnly).toBe(false);
    expect(normaliseRecruitmentScreening({ openVacanciesOnly: 'yes' }).openVacanciesOnly).toBe(false);
    expect(normaliseRecruitmentScreening({ mode: 'RULES', openVacanciesOnly: true })).toEqual({ mode: 'RULES', trustedSenders: [], blockedSenders: [], openVacanciesOnly: true });
  });

  it('sets aside receipts, newsletters and security notices', () => {
    expect(decide({ subject: 'Your receipt from Tesco', attachments: [{ fileName: 'receipt.pdf' }] })).toBe('SKIP');
    expect(decide({ subject: 'Security alert' })).toBe('SKIP');
    expect(decide({ subject: 'November newsletter' })).toBe('SKIP');
  });

  it('sets aside automated senders and mailing lists with no sign of a job', () => {
    expect(decide({ fromEmail: 'no-reply@accounts.google.com', subject: 'Storage almost full' })).toBe('SKIP');
    expect(decide({ fromEmail: 'offers@shop.example.com', bodyText: 'Big savings. Unsubscribe here.' })).toBe('SKIP');
  });
});
