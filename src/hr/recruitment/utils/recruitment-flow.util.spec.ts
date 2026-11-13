import { CandidateCheckStatus, CandidateCheckType, CandidateOfferStatus, CandidateStage } from '@prisma/client';
import {
  checksForCandidate,
  clearanceBlockerItems,
  clearanceBlockers,
  employmentHistoryErrors,
  findUnexplainedGaps,
  stageMoveError,
  type EmploymentHistoryEntry,
} from './recruitment-flow.util';

const NOW = new Date(Date.UTC(2026, 10, 11)); // 2026-11

const ctx = {
  hasRightToWork: true,
  hasPositiveInterview: true,
  offerStatus: null,
  stageBeforeClosing: null,
};

describe('stageMoveError', () => {
  it('moves one step forward or back', () => {
    expect(stageMoveError(CandidateStage.APPLIED, CandidateStage.SCREENING, ctx)).toBeNull();
    expect(stageMoveError(CandidateStage.INTERVIEW, CandidateStage.SCREENING, ctx)).toBeNull();
    expect(stageMoveError(CandidateStage.APPLIED, CandidateStage.INTERVIEW, ctx)).toBe('Move one step at a time.');
  });

  it('needs the screening answers and the right to work before the interview', () => {
    expect(stageMoveError(CandidateStage.SCREENING, CandidateStage.INTERVIEW, { ...ctx, hasRightToWork: null })).toMatch(/screening/);
    expect(stageMoveError(CandidateStage.SCREENING, CandidateStage.INTERVIEW, { ...ctx, hasRightToWork: false })).toMatch(/right to work/);
  });

  it('needs a positive interview before the offer and an accepted offer before the checks', () => {
    expect(stageMoveError(CandidateStage.INTERVIEW, CandidateStage.OFFER, { ...ctx, hasPositiveInterview: false })).toMatch(/interview/);
    expect(stageMoveError(CandidateStage.OFFER, CandidateStage.VETTING, ctx)).toMatch(/accepted/);
    expect(
      stageMoveError(CandidateStage.OFFER, CandidateStage.VETTING, { ...ctx, offerStatus: CandidateOfferStatus.ACCEPTED }),
    ).toBeNull();
  });

  it('only clears through the sign-off', () => {
    expect(stageMoveError(CandidateStage.VETTING, CandidateStage.ACCEPTED, ctx)).toMatch(/Clear to start/);
  });

  it('closes from any step and reopens only where it was closed', () => {
    expect(stageMoveError(CandidateStage.OFFER, CandidateStage.REJECTED, ctx)).toBeNull();
    const closed = { ...ctx, stageBeforeClosing: CandidateStage.INTERVIEW };
    expect(stageMoveError(CandidateStage.REJECTED, CandidateStage.INTERVIEW, closed)).toBeNull();
    expect(stageMoveError(CandidateStage.REJECTED, CandidateStage.OFFER, closed)).toMatch(/reopened/);
  });
});

describe('employment history', () => {
  const job = (from: string, to: string | null): EmploymentHistoryEntry => ({ kind: 'JOB', from, to, employer: 'Acme Care' });

  it('finds months that no job or gap covers, including time out of work since the last job', () => {
    const gaps = findUnexplainedGaps([job('2019-01', '2020-12'), job('2021-04', '2026-06')], NOW);
    expect(gaps).toEqual([
      { from: '2021-01', to: '2021-03' },
      { from: '2026-07', to: '2026-10' },
    ]);
  });

  it('treats back-to-back jobs, overlaps, explained gaps and a current job as covered', () => {
    const entries: EmploymentHistoryEntry[] = [
      job('2019-01', '2020-12'),
      { kind: 'GAP', from: '2021-01', to: '2021-03', explanation: 'Caring for a relative' },
      job('2021-04', '2022-06'),
      job('2022-01', null),
    ];
    expect(findUnexplainedGaps(entries, NOW)).toEqual([]);
  });

  it('reports incomplete rows', () => {
    expect(employmentHistoryErrors([{ kind: 'JOB', from: '2020-05', to: '2020-01' }])).toEqual([
      'Row 1: the end month is before the start month.',
      'Row 1: the employer is missing.',
    ]);
    expect(employmentHistoryErrors([{ kind: 'GAP', from: '2020-05', to: null }])).toEqual([
      'Row 1: say what the candidate was doing.',
    ]);
  });
});

describe('checks and clearance', () => {
  it('adds the overseas and driving checks only when they apply', () => {
    const types = (o: boolean, d: boolean) => checksForCandidate({ livedOverseas: o, drivesForWork: d }).map((c) => c.type);
    expect(types(false, false)).not.toContain(CandidateCheckType.OVERSEAS_POLICE_CHECK);
    expect(types(true, true)).toEqual(expect.arrayContaining([CandidateCheckType.OVERSEAS_POLICE_CHECK, CandidateCheckType.DRIVING]));
  });

  it('blocks clearance until every required check is verified and the history is complete', () => {
    const checks = checksForCandidate({ livedOverseas: false, drivesForWork: false }).map((c) => ({
      ...c,
      status: CandidateCheckStatus.VERIFIED as CandidateCheckStatus,
    }));
    const history: EmploymentHistoryEntry[] = [{ kind: 'JOB', from: '2020-01', to: null, employer: 'Acme Care' }];
    const base = { stage: CandidateStage.VETTING, dataProcessingConsent: true, employmentHistory: history, checks, now: NOW };

    expect(clearanceBlockers(base)).toEqual([]);

    const dbsPending = checks.map((c) => (c.type === CandidateCheckType.DBS ? { ...c, status: CandidateCheckStatus.RECEIVED } : c));
    expect(clearanceBlockers({ ...base, checks: dbsPending })).toEqual(['Enhanced DBS with adults barred list is not verified yet.']);

    const qualificationsSkipped = checks.map((c) =>
      c.type === CandidateCheckType.QUALIFICATIONS ? { ...c, status: CandidateCheckStatus.NOT_STARTED } : c,
    );
    expect(clearanceBlockers({ ...base, checks: qualificationsSkipped })).toEqual([]);

    expect(clearanceBlockers({ ...base, employmentHistory: [] })).toEqual(['Add the full employment history.']);
    expect(clearanceBlockerItems({ ...base, employmentHistory: [] })).toEqual([
      { message: 'Add the full employment history.', target: 'EMPLOYMENT_HISTORY' },
    ]);
  });
});
