import { auditResult, type AuditSection } from './quality-audit-scoring.util';

const sections: AuditSection[] = [
  {
    title: 'Policy',
    standards: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
  },
  {
    title: 'Practice',
    standards: [
      { id: 'c', text: 'C' },
      { id: 'd', text: 'D' },
    ],
  },
];
const met = (standardId: string, celebrate = false) => ({
  standardId,
  answer: 'MET' as const,
  celebrate,
  note: null,
});
const notMet = (standardId: string, note: string | null = 'Found a gap') => ({
  standardId,
  answer: 'NOT_MET' as const,
  celebrate: false,
  note,
});

describe('auditResult', () => {
  it('has no score until something is answered', () => {
    expect(auditResult(sections, [])).toMatchObject({
      total: 4,
      answered: 0,
      percent: null,
      complete: false,
    });
  });

  it('scores met as a share of the answered standards, overall and per section', () => {
    const r = auditResult(sections, [met('a', true), met('b'), notMet('c')]);
    expect(r).toMatchObject({
      total: 4,
      answered: 3,
      met: 2,
      notMet: 1,
      percent: 66.7,
      celebrated: 1,
      complete: false,
    });
    expect(r.sections).toEqual([
      {
        title: 'Policy',
        total: 2,
        answered: 2,
        met: 2,
        notMet: 0,
        percent: 100,
      },
      {
        title: 'Practice',
        total: 2,
        answered: 1,
        met: 0,
        notMet: 1,
        percent: 0,
      },
    ]);
  });

  it('is complete when every standard is answered, and lists not met standards without a note', () => {
    const r = auditResult(sections, [
      met('a'),
      met('b'),
      notMet('c', '  '),
      notMet('d'),
    ]);
    expect(r).toMatchObject({ complete: true, percent: 50 });
    expect(r.missingNotes).toEqual(['c']);
  });

  it('ignores answers to standards the audit does not have', () => {
    const r = auditResult(sections, [met('a'), notMet('gone')]);
    expect(r).toMatchObject({ answered: 1, met: 1, notMet: 0, percent: 100 });
  });
});
