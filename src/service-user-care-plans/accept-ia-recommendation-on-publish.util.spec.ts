import {
  applyCarePlanDecisions,
  readCarePlanDecisions,
} from '../initial-assessments/initial-assessment-care-plan-decisions.util';
import type { CarePlanRecommendation } from '../initial-assessments/initial-assessment-care-plan.util';
import {
  buildAcceptedDecisionOnPublish,
  mergeCarePlanDecisionsIntoMetadata,
  pendingRecommendationFormNames,
  recommendationsMatchingPublishedForm,
} from './accept-ia-recommendation-on-publish.util';

const catalogue = [
  { id: 'form-falls', name: 'Falls' },
  { id: 'form-skin', name: 'Skin Integrity' },
  { id: 'form-psych', name: 'Psychological' },
  { id: 'form-test', name: 'Test' },
];

function rec(
  partial: Partial<CarePlanRecommendation> & Pick<CarePlanRecommendation, 'id' | 'carePlanArea'>,
): CarePlanRecommendation {
  return {
    sectionNumber: 1,
    sectionTitle: partial.carePlanArea,
    title: `${partial.carePlanArea} care plan update recommended`,
    triggerCount: 1,
    triggers: [],
    status: 'pending',
    ...partial,
  };
}

describe('accept-ia-recommendation-on-publish.util', () => {
  it('accepts a pending Skin Integrity recommendation when that form is published', () => {
    const recommendations = [
      rec({
        id: 'cp-skin',
        carePlanArea: 'Skin Integrity',
        carePathwayFormId: 'form-skin',
        carePathwayFormName: 'Skin Integrity',
      }),
      rec({
        id: 'cp-falls',
        carePlanArea: 'Mobility',
        carePathwayFormId: 'form-falls',
        carePathwayFormName: 'Falls',
      }),
    ];

    const matches = recommendationsMatchingPublishedForm(
      recommendations,
      'form-skin',
      'Skin Integrity',
      catalogue,
      {},
    );
    expect(matches.map((m) => m.id)).toEqual(['cp-skin']);

    const decidedAt = '2026-08-25T10:00:00.000Z';
    const additions = Object.fromEntries(
      matches.map((recommendation) => [
        recommendation.id,
        buildAcceptedDecisionOnPublish({
          userId: 'user-1',
          decidedAtIso: decidedAt,
          carePathwayFormId: 'form-skin',
          carePathwayFormName: 'Skin Integrity',
          recommendation,
        }),
      ]),
    );

    const nextMeta = mergeCarePlanDecisionsIntoMetadata({}, additions);
    const withStatus = applyCarePlanDecisions(recommendations, readCarePlanDecisions(nextMeta));

    expect(withStatus.find((r) => r.id === 'cp-skin')?.status).toBe('accepted');
    expect(withStatus.find((r) => r.id === 'cp-falls')?.status).toBe('pending');
    expect(pendingRecommendationFormNames(withStatus)).toEqual(['Falls']);
    expect(pendingRecommendationFormNames(withStatus)).not.toContain('Skin Integrity');
  });

  it('resolves Psychological / Test by area or form name when carePathwayFormId is missing', () => {
    const recommendations = [
      rec({
        id: 'cp-psych',
        carePlanArea: 'Mental Health',
        // form id missing — catalogue maps Mental Health → Psychological
      }),
      rec({
        id: 'cp-test',
        carePlanArea: 'Test',
        carePathwayFormName: 'Test',
      }),
    ];

    const psychMatches = recommendationsMatchingPublishedForm(
      recommendations,
      'form-psych',
      'Psychological',
      catalogue,
      {},
    );
    expect(psychMatches.map((m) => m.id)).toEqual(['cp-psych']);

    const testMatches = recommendationsMatchingPublishedForm(
      recommendations,
      'form-test',
      'Test',
      catalogue,
      {},
    );
    expect(testMatches.map((m) => m.id)).toEqual(['cp-test']);

    const additions = {
      ...Object.fromEntries(
        psychMatches.map((recommendation) => [
          recommendation.id,
          buildAcceptedDecisionOnPublish({
            userId: 'user-1',
            decidedAtIso: '2026-08-25T10:00:00.000Z',
            carePathwayFormId: 'form-psych',
            carePathwayFormName: 'Psychological',
            recommendation,
          }),
        ]),
      ),
      ...Object.fromEntries(
        testMatches.map((recommendation) => [
          recommendation.id,
          buildAcceptedDecisionOnPublish({
            userId: 'user-1',
            decidedAtIso: '2026-08-25T10:00:00.000Z',
            carePathwayFormId: 'form-test',
            carePathwayFormName: 'Test',
            recommendation,
          }),
        ]),
      ),
    };

    const withStatus = applyCarePlanDecisions(
      recommendations,
      readCarePlanDecisions(mergeCarePlanDecisionsIntoMetadata({}, additions)),
    );
    expect(withStatus.every((r) => r.status === 'accepted')).toBe(true);
    expect(pendingRecommendationFormNames(withStatus)).toEqual([]);
  });

  it('does not re-accept declined recommendations (Falls already decided stays stable)', () => {
    const recommendations = [
      rec({
        id: 'cp-falls',
        carePlanArea: 'Mobility',
        carePathwayFormId: 'form-falls',
        carePathwayFormName: 'Falls',
      }),
    ];
    const existing = {
      'cp-falls': {
        decision: 'accepted' as const,
        reason: null,
        decidedAt: '2026-08-01T00:00:00.000Z',
        decidedById: 'user-old',
        carePathwayFormId: 'form-falls',
        carePathwayFormName: 'Falls',
      },
    };

    expect(
      recommendationsMatchingPublishedForm(
        recommendations,
        'form-falls',
        'Falls',
        catalogue,
        existing,
      ),
    ).toEqual([]);
  });
});
