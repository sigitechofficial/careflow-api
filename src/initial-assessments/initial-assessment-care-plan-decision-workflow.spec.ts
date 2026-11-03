import 'reflect-metadata';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InitialAssessmentStatus } from '@prisma/client';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { InitialAssessmentsController } from './initial-assessments.controller';
import {
  CarePlanRecommendationDecision as Decision,
  InitialAssessmentCarePlanDecisionDto,
} from './dto/initial-assessment-care-plan-decision.dto';
import {
  applyCarePlanDecisions,
  readCarePlanDecisions,
  type StoredCarePlanDecision,
} from './initial-assessment-care-plan-decisions.util';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';
import { recommendationsMatchingPublishedForm } from '../service-user-care-plans/accept-ia-recommendation-on-publish.util';
import {
  MANAGER,
  SU,
  SUB,
  falls,
  harness,
  prior,
} from './initial-assessment-care-plan-decision.test-harness';

describe('Phase 2B — manager decision workflow', () => {
  it('1. accepts, records the form, mirrors the stored row and keeps other metadata', async () => {
    const h = harness({});
    const res = await h.decide(Decision.ACCEPTED);

    expect(h.decisions()['rule-falls']).toMatchObject({
      decision: 'accepted',
      reason: null,
      decidedById: MANAGER,
      carePathwayFormId: 'form-falls',
    });
    expect(h.state.submission.metadata.other).toBe('kept');
    expect(h.state.rowUpdates[0].where).toEqual({
      submissionId: SUB,
      legacyRecommendationId: 'rule-falls',
    });
    expect(h.state.rowUpdates[0].data).toMatchObject({
      status: 'ACCEPTED',
      decidedById: MANAGER,
    });
    expect(res.data.recommendation?.status).toBe('accepted');
  });

  it('1b. an accept note is optional and kept when given', async () => {
    const h = harness({});
    await h.decide(Decision.ACCEPTED, '  Agreed with family  ');
    expect(h.decisions()['rule-falls'].reason).toBe('Agreed with family');
  });

  it('2. declines only with a reason', async () => {
    await expect(harness({}).decide(Decision.DECLINED)).rejects.toThrow(
      'A decline reason is required',
    );
    await expect(harness({}).decide(Decision.DECLINED, 'no')).rejects.toThrow(
      BadRequestException,
    );

    const h = harness({});
    await h.decide(Decision.DECLINED, 'Family provide this support');
    expect(h.decisions()['rule-falls']).toMatchObject({
      decision: 'declined',
      reason: 'Family provide this support',
    });
    expect(h.lastRowStatus()).toBe('DECLINED');
  });

  it('3. defers only with a reason, creating nothing and recording no care plan form', async () => {
    await expect(harness({}).decide(Decision.DEFERRED)).rejects.toThrow(
      'A reason for deferring is required',
    );

    const h = harness({});
    const res = await h.decide(Decision.DEFERRED, 'Waiting for the GP letter');
    const stored = h.decisions()['rule-falls'];
    expect(stored).toMatchObject({
      decision: 'deferred',
      reason: 'Waiting for the GP letter',
    });
    expect(stored.carePathwayFormId).toBeUndefined();
    expect(h.lastRowStatus()).toBe('DEFERRED');
    expect(res.data.recommendation).toMatchObject({
      status: 'deferred',
      decisionReason: 'Waiting for the GP letter',
    });
  });

  it('4. a deferred recommendation can later be accepted', async () => {
    const h = harness({
      decisions: { 'rule-falls': prior('deferred', 'Waiting for OT') },
    });
    await h.decide(Decision.ACCEPTED);
    expect(h.decisions()['rule-falls'].decision).toBe('accepted');
    expect(h.lastRowStatus()).toBe('ACCEPTED');
    // Accept also logs the care plan draft it created; the decision entry is last.
    expect(h.state.audits.at(-1)!.oldValues).toMatchObject({
      status: 'deferred',
      reason: 'Waiting for OT',
    });
  });

  it('5. a deferred recommendation can later be declined (with a reason)', async () => {
    const h = harness({
      decisions: { 'rule-falls': prior('deferred', 'Waiting for OT') },
    });
    await expect(h.decide(Decision.DECLINED)).rejects.toThrow(
      BadRequestException,
    );
    await h.decide(Decision.DECLINED, 'OT says not needed');
    expect(h.decisions()['rule-falls']).toMatchObject({
      decision: 'declined',
      reason: 'OT says not needed',
    });
    expect(h.lastRowStatus()).toBe('DECLINED');
  });

  describe('6. unauthorised decisions', () => {
    function canDecide(permissions: string[]) {
      const context = {
        getHandler: () =>
          // eslint-disable-next-line @typescript-eslint/unbound-method -- only read as a metadata key
          InitialAssessmentsController.prototype.decideCarePlanRecommendation,
        getClass: () => InitialAssessmentsController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { roles: ['Care Coordinator'], permissions },
          }),
        }),
      } as unknown as ExecutionContext;
      return new PermissionsGuard(new Reflector()).canActivate(context);
    }

    it('needs the review permission; update alone is refused', () => {
      expect(() =>
        canDecide(['service_users.initial_assessment.update']),
      ).toThrow(ForbiddenException);
      expect(canDecide(['service_users.initial_assessment.review'])).toBe(true);
    });

    it('refuses a decision through another service user (no cross-service-user access)', async () => {
      const h = harness({});
      await expect(
        h.decide(Decision.ACCEPTED, undefined, 'rule-falls', 'someone-else'),
      ).rejects.toThrow(NotFoundException);
      expect(h.tx.initialAssessmentSubmission.update).not.toHaveBeenCalled();
    });

    it('refuses a recommendation that does not belong to the assessment', async () => {
      await expect(
        harness({}).decide(Decision.ACCEPTED, undefined, 'rule-other'),
      ).rejects.toThrow('Care plan recommendation not found');
    });

    it('refuses a recommendation whose care plan form is no longer available', async () => {
      const h = harness({ catalogue: [] });
      await expect(h.decide(Decision.DEFERRED, 'later')).rejects.toThrow(
        'no longer available',
      );
      expect(h.tx.initialAssessmentSubmission.update).not.toHaveBeenCalled();
    });

    it('validates the decision value and reason length in the request body', () => {
      const errors = (body: object) =>
        validateSync(
          plainToInstance(InitialAssessmentCarePlanDecisionDto, body),
        ).map((e) => e.property);
      expect(
        errors({ decision: 'deferred', reason: 'Waiting for GP' }),
      ).toEqual([]);
      expect(errors({ decision: 'accepted' })).toEqual([]);
      expect(errors({ decision: 'postponed' })).toEqual(['decision']);
      expect(
        errors({ decision: 'declined', reason: 'x'.repeat(2001) }),
      ).toEqual(['reason']);
    });
  });

  it('7. refuses decisions unless the assessment is REVIEWED', async () => {
    for (const status of [
      InitialAssessmentStatus.DRAFT,
      InitialAssessmentStatus.IN_PROGRESS,
      InitialAssessmentStatus.SUBMITTED,
      InitialAssessmentStatus.ARCHIVED,
    ]) {
      const h = harness({ status });
      await expect(h.decide(Decision.DEFERRED, 'later')).rejects.toThrow(
        'only allowed after manager review',
      );
      expect(h.tx.initialAssessmentSubmission.update).not.toHaveBeenCalled();
    }
  });

  describe('8. decision audit history', () => {
    it('records ids, previous and new status, reason, decider and time', async () => {
      const h = harness({});
      await h.decide(Decision.DEFERRED, 'Waiting for GP letter');
      expect(h.state.audits).toHaveLength(1);
      const entry = h.state.audits[0];
      expect(entry).toMatchObject({
        userId: MANAGER,
        recordType: 'InitialAssessmentSubmission',
        recordId: SUB,
        metadata: {
          serviceUserId: SU,
          submissionId: SUB,
          recommendationId: 'rule-falls',
        },
        oldValues: {
          recommendationId: 'rule-falls',
          status: 'pending',
          reason: null,
        },
        newValues: {
          recommendationId: 'rule-falls',
          previousStatus: 'pending',
          newStatus: 'deferred',
          reason: 'Waiting for GP letter',
          decidedById: MANAGER,
          correction: false,
        },
      });
      expect(entry.tx).toBe('tx');
      const newValues = entry.newValues as { decidedAt: string };
      expect(newValues.decidedAt).toBe(h.decisions()['rule-falls'].decidedAt);
    });

    it('a correction of an accepted or declined decision needs a reason and is flagged in the audit', async () => {
      const h = harness({ decisions: { 'rule-falls': prior('accepted') } });
      await expect(h.decide(Decision.DEFERRED)).rejects.toThrow(
        BadRequestException,
      );
      await expect(h.decide(Decision.ACCEPTED)).rejects.toThrow(
        'already accepted',
      );

      await h.decide(
        Decision.DECLINED,
        'Accepted in error, family provide this',
      );
      expect(h.state.audits[0]).toMatchObject({
        oldValues: { status: 'accepted', decidedById: 'manager-0' },
        newValues: {
          previousStatus: 'accepted',
          newStatus: 'declined',
          correction: true,
        },
      });

      const d = harness({
        decisions: { 'rule-falls': prior('declined', 'Family manage') },
      });
      await expect(d.decide(Decision.ACCEPTED)).rejects.toThrow(
        'A reason is required to change a declined',
      );
      await expect(d.decide(Decision.DECLINED, 'again')).rejects.toThrow(
        'already declined',
      );
    });
  });

  it('9. grouped recommendations: a decision made through a merged (alias) id lands on the merged recommendation', async () => {
    const h = harness({});
    await h.decide(Decision.DEFERRED, 'Waiting for OT', 'cp-3-environment');
    expect(Object.keys(h.decisions())).toEqual(['rule-falls']);
    expect(h.state.rowUpdates[0].where).toEqual({
      submissionId: SUB,
      legacyRecommendationId: 'rule-falls',
    });
    expect(h.state.audits[0].newValues).toMatchObject({
      recommendationId: 'rule-falls',
      requestedRecommendationId: 'cp-3-environment',
    });
  });

  describe('10. existing JSON decisions stay compatible', () => {
    it('an old accepted decision stored under a merged id still counts and is not re-accepted', async () => {
      const h = harness({
        decisions: { 'cp-3-environment': prior('accepted') },
      });
      await expect(h.decide(Decision.ACCEPTED)).rejects.toThrow(
        'already accepted',
      );
    });

    it('old decisions are kept untouched next to new ones', async () => {
      const old = prior('declined', 'Family manage');
      const other: CarePlanRecommendation = {
        ...falls,
        id: 'rule-med',
        aliasIds: [],
        carePathwayFormId: undefined,
      };
      const h = harness({
        decisions: { 'rule-med': old },
        recommendations: [falls, other],
      });
      await h.decide(Decision.DEFERRED, 'Waiting for OT');
      expect(h.decisions()['rule-med']).toEqual(old);
    });

    it('publishing a care plan never auto-accepts a deferred recommendation', () => {
      const match = (decisions: Record<string, StoredCarePlanDecision>) =>
        recommendationsMatchingPublishedForm(
          [falls],
          'form-falls',
          'Falls',
          [],
          decisions,
        ).map((r) => r.id);
      expect(match({})).toEqual(['rule-falls']);
      expect(
        match({ 'rule-falls': prior('deferred', 'Waiting for OT') }),
      ).toEqual([]);
      expect(
        match({ 'cp-3-environment': prior('deferred', 'Waiting for OT') }),
      ).toEqual([]);
    });

    it('reads accepted, declined and deferred entries; declineReason stays for declined only', () => {
      const decisions = readCarePlanDecisions({
        carePlanDecisions: {
          a: prior('accepted'),
          b: prior('declined', 'Family manage'),
          c: prior('deferred', 'Waiting for OT'),
          d: { decision: 'maybe', decidedAt: 'x', decidedById: 'y' },
        },
      });
      expect(Object.keys(decisions)).toEqual(['a', 'b', 'c']);
      const recs = ['a', 'b', 'c', 'e'].map((id) => ({
        ...falls,
        id,
        aliasIds: [],
      }));
      const out = applyCarePlanDecisions(recs, decisions);
      expect(out.map((r) => r.status)).toEqual([
        'accepted',
        'declined',
        'deferred',
        'pending',
      ]);
      expect(out[1]).toMatchObject({
        declineReason: 'Family manage',
        decisionReason: 'Family manage',
      });
      expect(out[2]).toMatchObject({
        declineReason: null,
        decisionReason: 'Waiting for OT',
      });
    });
  });
});
