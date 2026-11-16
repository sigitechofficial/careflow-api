import { historyFromExtraction, screenApplicationByRules, splitName, yesNoToBool } from './recruitment-inbox.util';

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

  it('sets aside everyday mail with no sign of a job (bank alerts, appointments…)', () => {
    expect(screenApplicationByRules(email())).toEqual({ decision: 'SKIP', reason: 'No sign of a job or CV' });
    expect(decide({ fromEmail: 'info@bank.example.com', subject: 'Login Alert', bodyText: 'You signed in to DigiBank.' })).toBe('SKIP');
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
