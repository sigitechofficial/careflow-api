import { historyFromExtraction, splitName, yesNoToBool } from './recruitment-inbox.util';

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
