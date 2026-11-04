import {
  buildRequiredAssessments,
  loadRequiredAssessments,
  type RecommendationForRequiredAssessments,
  type RequiredAssessmentRule,
} from './initial-assessment-required-assessments.util';

const FALLS = '11111111-1111-4111-8111-111111111111';
const MOBILITY = '22222222-2222-4222-8222-222222222222';
const MEDICATION = '33333333-3333-4333-8333-333333333333';
const BED_RAIL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MANUAL_HANDLING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MED_ASSESSMENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const rec = (
  carePathwayFormId: string | undefined,
  status: RecommendationForRequiredAssessments['status'] = 'pending',
): RecommendationForRequiredAssessments => ({
  carePathwayFormId,
  title: 'x',
  status,
});

const rules: RequiredAssessmentRule[] = [
  {
    carePlanFormId: FALLS,
    carePlanFormName: 'Falls',
    assessmentFormId: BED_RAIL,
    assessmentFormName: 'Bed Rail Assessment',
  },
  {
    carePlanFormId: MOBILITY,
    carePlanFormName: 'Mobility',
    assessmentFormId: BED_RAIL,
    assessmentFormName: 'Bed Rail Assessment',
  },
  {
    carePlanFormId: MOBILITY,
    carePlanFormName: 'Mobility',
    assessmentFormId: MANUAL_HANDLING,
    assessmentFormName: 'Manual Handling',
  },
  {
    carePlanFormId: MEDICATION,
    carePlanFormName: 'Medication',
    assessmentFormId: MED_ASSESSMENT,
    assessmentFormName: 'Assessing For Medication in home care',
  },
];

describe('required assessments after an Initial Assessment', () => {
  it('lists each required assessment once, with every recommended care plan that needs it', () => {
    const items = buildRequiredAssessments(
      [rec(FALLS), rec(MOBILITY, 'accepted')],
      rules,
      new Map(),
    );
    expect(items.map((i) => i.assessmentFormName)).toEqual([
      'Bed Rail Assessment',
      'Manual Handling',
    ]);
    expect(items[0].requiredBy.map((r) => r.carePlanName)).toEqual([
      'Falls',
      'Mobility',
    ]);
    expect(items[1].requiredBy.map((r) => r.carePlanName)).toEqual([
      'Mobility',
    ]);
  });

  it('ignores declined recommendations and recommendations without a care plan form', () => {
    const items = buildRequiredAssessments(
      [rec(MEDICATION, 'declined'), rec(undefined), rec(FALLS, 'deferred')],
      rules,
      new Map(),
    );
    expect(items.map((i) => i.assessmentFormId)).toEqual([BED_RAIL]);
  });

  it('marks completed assessments and lists the ones not done first', () => {
    const done = new Date('2026-10-01T09:00:00Z');
    const items = buildRequiredAssessments(
      [rec(MOBILITY)],
      rules,
      new Map([[BED_RAIL, done]]),
    );
    expect(items.map((i) => [i.assessmentFormName, i.lastCompletedAt])).toEqual(
      [
        ['Manual Handling', null],
        ['Bed Rail Assessment', done.toISOString()],
      ],
    );
  });

  it('returns nothing when no care plan is configured with required assessments', () => {
    expect(buildRequiredAssessments([rec(FALLS)], [], new Map())).toEqual([]);
  });

  it('loads the configured rules and the latest completion for the service user (read-only)', async () => {
    const db = {
      carePlanRequiredAssessment: {
        findMany: jest.fn().mockResolvedValue([
          {
            carePlanFormId: FALLS,
            assessmentFormId: BED_RAIL,
            carePlanForm: { name: 'Falls' },
            assessmentForm: { name: 'Bed Rail Assessment' },
          },
        ]),
      },
      serviceUserAssessment: {
        findMany: jest.fn().mockResolvedValue([
          {
            carePathwayFormId: null,
            assessmentKey: BED_RAIL,
            completions: [{ completedAt: new Date('2026-09-01T00:00:00Z') }],
          },
          {
            carePathwayFormId: BED_RAIL,
            assessmentKey: 'bed-rail',
            completions: [{ completedAt: new Date('2026-10-05T00:00:00Z') }],
          },
        ]),
      },
    };
    const items = await loadRequiredAssessments(db as never, 'su-1', [
      rec(FALLS),
      rec(MEDICATION, 'declined'),
    ]);
    type Query = { where: Record<string, unknown> };
    const firstQuery = (fn: jest.Mock) => (fn.mock.calls as Query[][])[0]?.[0];
    expect(
      firstQuery(db.carePlanRequiredAssessment.findMany)?.where.carePlanFormId,
    ).toEqual({ in: [FALLS] });
    expect(
      firstQuery(db.serviceUserAssessment.findMany)?.where.serviceUserId,
    ).toBe('su-1');
    expect(items).toEqual([
      {
        assessmentFormId: BED_RAIL,
        assessmentFormName: 'Bed Rail Assessment',
        requiredBy: [{ carePathwayFormId: FALLS, carePlanName: 'Falls' }],
        lastCompletedAt: '2026-10-05T00:00:00.000Z',
      },
    ]);
  });

  it('does not query when nothing is recommended', async () => {
    const db = {
      carePlanRequiredAssessment: { findMany: jest.fn() },
      serviceUserAssessment: { findMany: jest.fn() },
    };
    expect(
      await loadRequiredAssessments(db as never, 'su-1', [
        rec(FALLS, 'declined'),
      ]),
    ).toEqual([]);
    expect(db.carePlanRequiredAssessment.findMany).not.toHaveBeenCalled();
  });
});
