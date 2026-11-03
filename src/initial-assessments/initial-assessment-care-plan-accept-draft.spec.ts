import 'reflect-metadata';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CarePlanRecommendationDecision as Decision } from './dto/initial-assessment-care-plan-decision.dto';
import {
  SU,
  SUB,
  falls,
  harness,
  prior,
  type FakeInstance,
} from './initial-assessment-care-plan-decision.test-harness';
import { buildAcceptedRecommendationDraft } from '../service-user-care-plans/ia-accepted-recommendation-draft.util';

const existingDraft = (): FakeInstance => ({
  id: 'inst-existing',
  serviceUserId: SU,
  carePathwayFormId: 'form-falls',
  status: 'DRAFT',
  draft: {
    id: 'draft-existing',
    valuesJson: { 'risk:summary': 'Edited by the manager' },
    composedFromJson: { manual: true },
  },
  publishedVersions: [],
});

const existingPublished = (): FakeInstance => ({
  id: 'inst-published',
  serviceUserId: SU,
  carePathwayFormId: 'form-falls',
  status: 'PUBLISHED',
  draft: null,
  publishedVersions: [
    { versionNumber: 3, valuesJson: { 'risk:summary': 'Published text' } },
  ],
});

describe('Phase 2C — accepted recommendation → draft care plan', () => {
  it('1. accept creates the care plan and a draft pre-filled from the accepted assessment', async () => {
    const h = harness({});
    const res = await h.decide(Decision.ACCEPTED);

    expect(h.state.instances).toHaveLength(1);
    const [instance] = h.state.instances;
    expect(instance).toMatchObject({
      serviceUserId: SU,
      carePathwayFormId: 'form-falls',
      status: 'DRAFT',
    });
    expect(instance.draft?.valuesJson).toMatchObject({
      'risk:summary': 'Two falls in the last year',
    });
    expect(instance.draft?.composedFromJson).toMatchObject({
      iaSubmissionId: SUB,
      mapping: 'falls',
      acceptedRecommendation: {
        submissionId: SUB,
        recommendationId: 'rule-falls',
      },
    });
    expect(instance.draft?.gapsJson).toEqual([
      { fieldKey: 'risk:plan', severity: 'warning' },
    ]);

    // Link recorded in the decision JSON, on the stored row, in the response and in the audit.
    expect(h.decisions()['rule-falls'].carePlanInstanceId).toBe(instance.id);
    expect(h.state.rowUpdates.at(-1)!.data).toMatchObject({
      status: 'ACCEPTED',
      carePlanInstanceId: instance.id,
    });
    expect(res.data.carePlan).toMatchObject({
      instanceId: instance.id,
      action: 'created',
      prefilled: true,
      status: 'DRAFT',
    });
    expect(res.data.recommendation).toMatchObject({
      status: 'accepted',
      carePlanInstanceId: instance.id,
      linkedCarePlan: {
        instanceId: instance.id,
        status: 'DRAFT',
        hasDraft: true,
      },
    });
    expect(h.state.audits.map((a) => a.action)).toEqual([
      'care_plan_draft_saved',
      'initial_assessment_care_plan_decision',
    ]);
    expect(h.state.audits[1].newValues).toMatchObject({
      carePlanInstanceId: instance.id,
      carePlan: { action: 'created' },
    });
  });

  it('2 & 4. accept reuses an existing draft and leaves its contents untouched', async () => {
    const before = existingDraft();
    const h = harness({ instances: [before] });
    const res = await h.decide(Decision.ACCEPTED);

    expect(h.state.instances).toEqual([before]);
    expect(h.compose).not.toHaveBeenCalled();
    expect(h.tx.serviceUserCarePlanDraft.createMany).not.toHaveBeenCalled();
    expect(res.data.carePlan).toMatchObject({
      instanceId: 'inst-existing',
      action: 'linked',
      status: 'DRAFT',
    });
    expect(h.decisions()['rule-falls'].carePlanInstanceId).toBe(
      'inst-existing',
    );
  });

  it('3 & 5. accept links an existing published plan without creating a draft or touching versions', async () => {
    const before = existingPublished();
    const h = harness({ instances: [before] });
    const res = await h.decide(Decision.ACCEPTED);

    expect(h.state.instances).toEqual([before]);
    expect(h.tx.serviceUserCarePlanDraft.createMany).not.toHaveBeenCalled();
    expect(res.data.carePlan).toMatchObject({
      instanceId: 'inst-published',
      action: 'linked',
      status: 'PUBLISHED',
    });
    expect(res.data.recommendation?.linkedCarePlan).toMatchObject({
      status: 'PUBLISHED',
      hasDraft: false,
    });
  });

  it('6. repeated accept creates no duplicate care plan or draft', async () => {
    const h = harness({});
    await h.decide(Decision.ACCEPTED);
    await expect(h.decide(Decision.ACCEPTED)).rejects.toThrow(
      'already accepted',
    );
    expect(h.state.instances).toHaveLength(1);
  });

  it('6b. an instance created by someone else between the check and the transaction is linked, not duplicated', async () => {
    const h = harness({});
    // Compose runs before the transaction; simulate another request creating the plan meanwhile.
    h.compose.mockImplementationOnce(() => {
      h.state.instances.push(existingDraft());
      return Promise.resolve({
        data: {
          values: { 'risk:summary': 'x' },
          composedFrom: { iaSubmissionId: SUB },
          gaps: [],
          suggestionMode: 'generic',
        },
      });
    });
    const res = await h.decide(Decision.ACCEPTED);
    expect(h.state.instances).toHaveLength(1);
    expect(h.state.instances[0].draft?.valuesJson).toEqual({
      'risk:summary': 'Edited by the manager',
    });
    expect(res.data.carePlan).toMatchObject({
      instanceId: 'inst-existing',
      action: 'linked',
    });
    // Decisions are serialised under a row lock on the submission.
    expect(h.tx.$queryRaw).toHaveBeenCalled();
  });

  it('7. decline creates nothing', async () => {
    const h = harness({});
    await h.decide(Decision.DECLINED, 'Family provide this support');
    expect(h.state.instances).toHaveLength(0);
    expect(h.compose).not.toHaveBeenCalled();
    expect(h.decisions()['rule-falls'].carePlanInstanceId).toBeUndefined();
  });

  it('8. defer creates nothing', async () => {
    const h = harness({});
    await h.decide(Decision.DEFERRED, 'Waiting for the GP letter');
    expect(h.state.instances).toHaveLength(0);
    expect(h.compose).not.toHaveBeenCalled();
  });

  it('8b. declining a previously accepted recommendation keeps the plan and its link, flagged for review', async () => {
    const plan = existingDraft();
    const h = harness({
      instances: [plan],
      decisions: {
        'rule-falls': prior('accepted', null, { carePlanInstanceId: plan.id }),
      },
    });
    const res = await h.decide(Decision.DECLINED, 'Accepted in error');
    expect(h.state.instances).toEqual([plan]);
    expect(h.decisions()['rule-falls']).toMatchObject({
      decision: 'declined',
      carePlanInstanceId: plan.id,
      linkedCarePlanReviewRequired: true,
    });
    expect(res.data.recommendation).toMatchObject({
      linkedCarePlanReviewRequired: true,
      linkedCarePlan: { instanceId: plan.id },
    });
    expect(h.state.rowUpdates.at(-1)!.data).not.toHaveProperty(
      'carePlanInstanceId',
    );
  });

  it('9. invalid form is rejected: no matching form, or the form is no longer active', async () => {
    const unmapped = {
      ...falls,
      carePathwayFormId: undefined,
      carePathwayFormName: undefined,
      carePlanArea: 'Unknown area',
    };
    const h = harness({ recommendations: [unmapped] });
    await expect(h.decide(Decision.ACCEPTED)).rejects.toThrow(
      'No active care plan form matches',
    );
    expect(h.state.instances).toHaveLength(0);
    expect(h.decisions()['rule-falls']).toBeUndefined();

    const gone = harness({ catalogue: [] });
    await expect(gone.decide(Decision.ACCEPTED)).rejects.toThrow(
      BadRequestException,
    );
    expect(gone.state.instances).toHaveLength(0);
  });

  it('10. a failed draft creation leaves no decision, no row update, no care plan and no audit', async () => {
    const failing = harness({ failDraftInsert: true });
    await expect(failing.decide(Decision.ACCEPTED)).rejects.toThrow(
      'draft insert failed',
    );
    expect(failing.state.instances).toHaveLength(0);
    expect(failing.decisions()).toEqual({});
    expect(failing.state.rowUpdates).toHaveLength(0);
    expect(failing.state.audits).toHaveLength(0);

    const composeDown = harness({
      compose: () => Promise.reject(new Error('compose crashed')),
    });
    await expect(composeDown.decide(Decision.ACCEPTED)).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(composeDown.decide(Decision.ACCEPTED)).rejects.toThrow(
      'The decision was not saved',
    );
    expect(composeDown.decisions()).toEqual({});
    expect(composeDown.state.instances).toHaveLength(0);
  });

  it('11. legacy ids: accepting through a merged id links the plan under the recommendation id', async () => {
    const h = harness({});
    const res = await h.decide(
      Decision.ACCEPTED,
      undefined,
      'cp-3-environment',
    );
    expect(Object.keys(h.decisions())).toEqual(['rule-falls']);
    expect(h.decisions()['rule-falls'].carePlanInstanceId).toBe(
      h.state.instances[0].id,
    );
    expect(res.data.recommendation?.carePlanInstanceId).toBe(
      h.state.instances[0].id,
    );
  });

  it('11b. an old accepted decision without a link still reads and blocks a duplicate accept', async () => {
    const h = harness({ decisions: { 'cp-3-environment': prior('accepted') } });
    await expect(h.decide(Decision.ACCEPTED)).rejects.toThrow(
      'already accepted',
    );
    expect(h.state.instances).toHaveLength(0);
  });

  describe('draft pre-fill source', () => {
    const base = {
      formName: 'Falls',
      reviewFrequencyMonths: 6,
      submissionId: SUB,
      recommendationId: 'rule-falls',
      now: new Date('2026-11-03T09:00:00Z'),
    };

    it('does not pre-fill from a different (newer) assessment', () => {
      const draft = buildAcceptedRecommendationDraft({
        ...base,
        compose: {
          values: { 'risk:summary': 'From newer IA' },
          composedFrom: { iaSubmissionId: 'newer' },
          gaps: [],
          suggestionMode: 'generic',
        },
      });
      expect(draft.prefilled).toBe(false);
      expect(draft.valuesJson).not.toHaveProperty('risk:summary');
      expect(draft.prefillSkippedReason).toMatch(/newer initial assessment/);
      expect(draft.composedFromJson).toEqual({
        acceptedRecommendation: {
          submissionId: SUB,
          recommendationId: 'rule-falls',
          acceptedAt: '2026-11-03T09:00:00.000Z',
        },
      });
    });

    it('does not pre-fill when compose does not say which assessment it used', () => {
      const draft = buildAcceptedRecommendationDraft({
        ...base,
        compose: {
          values: { 'risk:summary': 'x' },
          composedFrom: {},
          gaps: [],
          suggestionMode: 'generic',
        },
      });
      expect(draft.prefilled).toBe(false);
    });

    it('explicit suggestion mode leaves fields for the manager (suggestions only), keeping provenance and gaps', () => {
      const draft = buildAcceptedRecommendationDraft({
        ...base,
        compose: {
          values: { 'risk:summary': 'Suggested' },
          composedFrom: { iaSubmissionId: SUB },
          gaps: [{ fieldKey: 'a', severity: 'blocking' }] as never,
          suggestionMode: 'explicit',
        },
      });
      expect(draft.prefilled).toBe(true);
      expect(draft.valuesJson).not.toHaveProperty('risk:summary');
      expect(draft.composedFromJson).toMatchObject({ iaSubmissionId: SUB });
      expect(draft.gapsJson).toEqual([{ fieldKey: 'a', severity: 'blocking' }]);
    });
  });
});
