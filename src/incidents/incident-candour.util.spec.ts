import {
  candourCloseCheck,
  candourDateProblem,
  candourDecisionProblems,
  candourHintReasons,
  candourMissing,
  candourOverdue,
  candourStatus,
  candourSubjectIds,
  type CandourState,
} from './incident-candour.util';

const base: CandourState = {
  decision: 'YES',
  toldOn: null,
  toldByEmployeeId: null,
  toldPersonKind: null,
  factsExplained: false,
  enquiriesExplained: false,
  apologyGiven: false,
  supportOffered: null,
  writtenSentOn: null,
  writtenMethod: null,
  writtenAttachmentId: null,
  resultsSharedOn: null,
  resultsAttachmentId: null,
  noFurtherEnquiriesReason: null,
  unableToNotify: false,
  unableReason: null,
  attemptCount: 0,
};
const told = {
  toldOn: '2026-10-02',
  toldByEmployeeId: 'e1',
  toldPersonKind: 'REPRESENTATIVE',
  factsExplained: true,
  enquiriesExplained: true,
  apologyGiven: true,
  supportOffered: 'Named contact: Eleanor',
};
const written = { writtenSentOn: '2026-10-03', writtenMethod: 'POST', writtenAttachmentId: 'a1' };

describe('candourStatus', () => {
  it('no decision, not known, not required', () => {
    expect(candourStatus({ ...base, decision: null })).toBe('NOT_DECIDED');
    expect(candourStatus({ ...base, decision: 'NOT_KNOWN' })).toBe('NOT_KNOWN');
    expect(candourStatus({ ...base, decision: 'NO' })).toBe('NOT_REQUIRED');
    expect(candourStatus({ ...base, decision: 'NOT_APPLICABLE' })).toBe('NOT_REQUIRED');
  });

  it('Yes is complete only when told, written and results are all done', () => {
    expect(candourStatus(base)).toBe('IN_PROGRESS');
    expect(candourStatus({ ...base, ...told })).toBe('IN_PROGRESS');
    expect(candourStatus({ ...base, ...told, ...written })).toBe('IN_PROGRESS');
    expect(
      candourStatus({ ...base, ...told, ...written, resultsSharedOn: '2026-10-20', resultsAttachmentId: 'a2' }),
    ).toBe('COMPLETE');
    expect(
      candourStatus({ ...base, ...told, ...written, noFurtherEnquiriesReason: 'No investigation needed' }),
    ).toBe('COMPLETE');
  });

  it('told in person needs all three points and the support offered', () => {
    expect(candourStatus({ ...base, ...told, ...written, apologyGiven: false, noFurtherEnquiriesReason: 'x' })).toBe(
      'IN_PROGRESS',
    );
    expect(candourStatus({ ...base, ...told, ...written, supportOffered: ' ', noFurtherEnquiriesReason: 'x' })).toBe(
      'IN_PROGRESS',
    );
  });

  it('the written step needs a copy of the letter', () => {
    expect(
      candourStatus({ ...base, ...told, ...written, writtenAttachmentId: null, noFurtherEnquiriesReason: 'x' }),
    ).toBe('IN_PROGRESS');
  });

  it('could not tell them: complete with a reason and at least one attempt (Reg 20(5))', () => {
    expect(candourStatus({ ...base, unableToNotify: true, unableReason: 'DECLINED' })).toBe('IN_PROGRESS');
    expect(candourStatus({ ...base, unableToNotify: true, unableReason: 'DECLINED', attemptCount: 1 })).toBe(
      'COMPLETE',
    );
  });
});

describe('candourMissing', () => {
  it('lists the missing steps', () => {
    expect(candourMissing({ ...base, ...told })).toEqual([
      'the written follow-up (with a copy)',
      'sharing the results (or why there are no further enquiries)',
    ]);
    expect(candourMissing({ ...base, unableToNotify: true })).toEqual([
      'why they could not be told',
      'at least one contact attempt',
    ]);
  });
});

describe('candourDecisionProblems', () => {
  it('Yes needs a harm and the health professional; No needs a reason and the professional', () => {
    expect(candourDecisionProblems({ decision: 'YES' })).toEqual([
      'which harm applies',
      'the health professional consulted (name and role)',
    ]);
    expect(candourDecisionProblems({ decision: 'NO' })).toEqual([
      'the reason',
      'the health professional consulted (name and role)',
    ]);
    expect(candourDecisionProblems({ decision: 'NOT_KNOWN' })).toEqual([]);
    expect(
      candourDecisionProblems({
        decision: 'YES',
        harmTypes: ['BODY_STRUCTURE_CHANGE'],
        healthProfessionalName: 'Dr Shah',
        healthProfessionalRole: 'GP',
      }),
    ).toEqual([]);
  });
});

describe('candourHintReasons', () => {
  const none = {
    severity: 'LOW',
    categoryKey: 'ACCIDENT',
    subtypeKey: null,
    admittedToHospital: null,
    takenToAe: null,
    seriousServiceUserInjury: false,
  };
  it('suggests for high severity, serious injury, hospital, unexpected death', () => {
    expect(candourHintReasons(none)).toEqual([]);
    expect(candourHintReasons({ ...none, severity: 'HIGH' })).toEqual(['High severity']);
    expect(candourHintReasons({ ...none, seriousServiceUserInjury: true })).toEqual(['a serious injury']);
    expect(candourHintReasons({ ...none, admittedToHospital: true, takenToAe: true })).toEqual([
      'admitted to hospital',
    ]);
    expect(candourHintReasons({ ...none, categoryKey: 'DEATH', subtypeKey: 'UNEXPECTED_DEATH' })).toEqual([
      'a death that was not expected',
    ]);
  });
  it('never suggests for an expected death', () => {
    expect(
      candourHintReasons({ ...none, categoryKey: 'DEATH', subtypeKey: 'EXPECTED_DEATH', severity: 'CRITICAL' }),
    ).toEqual([]);
  });
});

describe('candourDateProblem', () => {
  const at = { today: '2026-10-08', incidentDay: '2026-10-01' };
  it('future, before the incident, out of order', () => {
    expect(candourDateProblem({ ...at, label: 'Told on', date: '2026-10-09' })).toBe("Told on can't be in the future");
    expect(candourDateProblem({ ...at, label: 'Told on', date: '2026-09-30' })).toBe(
      "Told on can't be before the incident happened",
    );
    expect(
      candourDateProblem({
        ...at,
        label: 'Letter sent on',
        date: '2026-10-02',
        notBefore: { date: '2026-10-03', label: 'the day they were told' },
      }),
    ).toBe("Letter sent on can't be before the day they were told");
    expect(candourDateProblem({ ...at, label: 'Told on', date: '2026-10-08' })).toBeNull();
  });
});

describe('candourOverdue', () => {
  const o = {
    decision: 'YES',
    toldOn: null,
    unableToNotify: false,
    dutyStartedDay: '2026-10-01',
    today: '2026-10-08',
    overdueDays: 5,
  };
  it('off, under, exactly, over', () => {
    expect(candourOverdue({ ...o, overdueDays: null })).toBe(false);
    expect(candourOverdue({ ...o, today: '2026-10-05' })).toBe(false);
    expect(candourOverdue({ ...o, today: '2026-10-06' })).toBe(false);
    expect(candourOverdue(o)).toBe(true);
  });
  it('not overdue once told, unable recorded, or not required', () => {
    expect(candourOverdue({ ...o, toldOn: '2026-10-07' })).toBe(false);
    expect(candourOverdue({ ...o, unableToNotify: true })).toBe(false);
    expect(candourOverdue({ ...o, decision: 'NO' })).toBe(false);
    expect(candourOverdue({ ...o, decision: 'NOT_KNOWN' })).toBe(true);
  });
});

describe('candourSubjectIds', () => {
  it('only when a service user was affected', () => {
    expect(
      candourSubjectIds({ affectedPersonKinds: ['EMPLOYEE'], primaryServiceUserId: null, involvedServiceUserIds: ['s1'] }),
    ).toEqual([]);
    expect(
      candourSubjectIds({
        affectedPersonKinds: ['SERVICE_USER'],
        primaryServiceUserId: 's1',
        involvedServiceUserIds: ['s1', 's2'],
      }),
    ).toEqual(['s1', 's2']);
  });
});

describe('candourCloseCheck', () => {
  it('undecided and not known block; in progress needs a reason', () => {
    expect(
      candourCloseCheck([
        { name: 'A', status: 'NOT_DECIDED' },
        { name: 'B', status: 'NOT_KNOWN' },
        { name: 'C', status: 'IN_PROGRESS' },
        { name: 'D', status: 'COMPLETE' },
        { name: 'E', status: 'NOT_REQUIRED' },
      ]),
    ).toEqual({ blocking: ['A', 'B'], incomplete: ['C'] });
  });
});
