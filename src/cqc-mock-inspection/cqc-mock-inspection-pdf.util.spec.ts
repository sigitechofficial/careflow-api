import {
  answerTally,
  buildMockInspectionPdf,
  questionsWithAnswers,
  evidenceLabel,
  gapLine,
  keyQuestionLine,
  reportFileName,
  type MockInspectionReport,
} from './cqc-mock-inspection-pdf.util';

const report = (
  over: Partial<MockInspectionReport> = {},
): MockInspectionReport => ({
  organisationName: 'All For Care',
  generatedAt: new Date('2026-11-17T10:00:00.000Z'),
  generatedBy: 'Sam Manager',
  title: 'Mock inspection, November 2026',
  status: 'COMPLETED',
  serviceName: 'Greenwich',
  templateTitle: null,
  frameworkTitle: 'CQC single assessment framework',
  frameworkVersion: 1,
  leadReviewer: 'Sam Manager',
  startedAt: new Date('2026-11-01T09:00:00.000Z'),
  completedAt: new Date('2026-11-17T09:00:00.000Z'),
  scale: [
    { score: 1, label: 'Significant shortfalls' },
    { score: 2, label: 'Some shortfalls' },
    { score: 3, label: 'Good standard' },
    { score: 4, label: 'Exceptional standard' },
  ],
  result: {
    keyQuestions: [
      {
        keyQuestionCode: 'SAFE',
        statementCount: 2,
        scoredCount: 2,
        total: 5,
        max: 8,
        percent: 62.5,
        bandRating: 'GOOD',
        rating: 'REQUIRES_IMPROVEMENT',
        limitedFrom: 'GOOD',
        complete: true,
      },
    ],
    overall: 'REQUIRES_IMPROVEMENT',
    complete: true,
    unscoredStatementIds: [],
    overallApplies: true,
  },
  keyQuestions: [
    {
      code: 'SAFE',
      title: 'Safe',
      statements: [
        {
          id: 's1',
          title: 'Learning culture',
          score: 1,
          strengths: null,
          concerns: 'Lessons not shared — “team” meetings missed',
          notes: null,
          gap: false,
          evidence: [
            { title: 'Incident log', sourceType: 'INCIDENT_LEARNING' },
          ],
          hiddenEvidenceCount: 1,
          focus: 'Sharing lessons after incidents',
          guidance: {
            lookAt: ['Incident reviews', 'Team meeting minutes'],
            askPeople: [],
            askStaff: ['What changed after the last incident?'],
          },
          checks: [
            { part: 'lookAt', text: 'Incident reviews', answer: 'MET', note: null },
            {
              part: 'askStaff',
              text: 'What changed after the last incident?',
              answer: 'NOT_MET',
              note: ' Nobody could say ',
            },
          ],
        },
        {
          id: 's2',
          title: 'Safeguarding',
          score: 4,
          strengths: 'Good training',
          concerns: null,
          notes: null,
          gap: true,
          evidence: [],
          hiddenEvidenceCount: 0,
        },
      ],
    },
  ],
  actions: [
    {
      statementId: 's1',
      title: 'Share lessons monthly',
      detail: null,
      owner: null,
      dueAt: new Date('2026-12-31'),
      status: 'OPEN',
      completedAt: null,
    },
  ],
  ...over,
});

describe('mock inspection report', () => {
  it('names the file from the title and date', () => {
    expect(
      reportFileName(
        'Mock inspection, November 2026!',
        new Date('2026-11-17T10:00:00Z'),
      ),
    ).toBe('mock-cqc-inspection-mock-inspection-november-2026-2026-11-17.pdf');
    expect(reportFileName('***', new Date('2026-11-17T10:00:00Z'))).toBe(
      'mock-cqc-inspection-report-2026-11-17.pdf',
    );
  });

  it('writes one summary line per key question, with the limiter', () => {
    const k = report().result!.keyQuestions[0];
    expect(keyQuestionLine('Safe', k)).toBe(
      'Safe: Requires improvement (62.5%, 2/2 scored; limited from Good by a low score)',
    );
    expect(keyQuestionLine('Caring', undefined)).toBe('Caring: not scored yet');
  });

  it('builds a PDF, also for an inspection with nothing scored and no actions', async () => {
    const full = await buildMockInspectionPdf(report());
    expect(full.subarray(0, 5).toString()).toBe('%PDF-');
    const empty = await buildMockInspectionPdf(
      report({
        status: 'IN_PROGRESS',
        completedAt: null,
        result: null,
        actions: [],
        keyQuestions: [
          {
            code: 'SAFE',
            title: 'Safe',
            statements: [
              { ...report().keyQuestions[0].statements[0], score: null },
            ],
          },
        ],
      }),
    );
    expect(empty.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('lists every question of a statement with its answer, by part', () => {
    const parts = questionsWithAnswers(report().keyQuestions[0].statements[0]);
    expect(parts).toEqual([
      {
        label: 'Look at',
        questions: [
          { text: 'Incident reviews', answer: 'MET', note: null },
          { text: 'Team meeting minutes', answer: null, note: null },
        ],
      },
      {
        label: 'Ask staff',
        questions: [
          {
            text: 'What changed after the last incident?',
            answer: 'NOT_MET',
            note: 'Nobody could say',
          },
        ],
      },
    ]);
    expect(answerTally(parts)).toBe('1 met, 0 partially met, 1 not met, 1 not answered');
    // A statement without questions has none to show.
    expect(questionsWithAnswers(report().keyQuestions[0].statements[1])).toEqual([]);
  });

  it('names the statements with no evidence, or says none has any', () => {
    expect(gapLine(['Safeguarding'], 34)).toBe(
      'No current evidence for 1 statement(s): Safeguarding.',
    );
    expect(gapLine(['A', 'B'], 2)).toBe(
      'None of the 2 statements has current evidence. Add CQC evidence and refresh the inspection.',
    );
  });

  it('labels the evidence held for a statement', () => {
    const [withEvidence, gap] = report().keyQuestions[0].statements;
    expect(evidenceLabel(withEvidence)).toBe('2 items (1 hidden)');
    expect(evidenceLabel(gap)).toBe('None');
    expect(evidenceLabel({ ...withEvidence, hiddenEvidenceCount: 0 })).toBe(
      '1 item',
    );
  });
});
