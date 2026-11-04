import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InitialAssessmentCarePlanRecommendationStatus as StoredStatus } from '@prisma/client';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { InitialAssessmentsController } from './initial-assessments.controller';
import { InitialAssessmentCarePlanRulesService } from './initial-assessment-care-plan-rules.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';
import {
  applyCarePlanDecisions,
  findCarePlanRecommendation,
  type StoredCarePlanDecision,
} from './initial-assessment-care-plan-decisions.util';
import {
  planRecommendationPersistence,
  recommendationFromStoredRow,
  type StoredRecommendationRow,
} from './initial-assessment-care-plan-recommendation-store.util';

const FALLS_FORM = 'form-falls';
const MED_FORM = 'form-med';

function rec(
  over: Partial<CarePlanRecommendation> & { id: string },
): CarePlanRecommendation {
  return {
    carePlanArea: 'Falls',
    sectionNumber: 3,
    sectionTitle: 'Mobility',
    title: 'Falls',
    triggerCount: 1,
    triggers: [
      { questionId: 'q1', questionText: 'Any falls in the last 12 months?' },
    ],
    status: 'pending',
    source: 'rule',
    ...over,
  };
}

const fallsRec = rec({
  id: 'rule-r1',
  ruleId: 'r1',
  carePathwayFormId: FALLS_FORM,
  aliasIds: ['cp-3-environment'],
});
const medRec = rec({
  id: 'rule-r2',
  carePlanArea: 'Medication',
  title: 'Medication',
  carePathwayFormId: MED_FORM,
  sectionNumber: 9,
});
const legacyRec = rec({
  id: 'cp-12-oral-health',
  carePlanArea: 'Oral health',
  title: 'Oral health',
  source: 'legacy',
});

const accepted: StoredCarePlanDecision = {
  decision: 'accepted',
  reason: null,
  decidedAt: '2026-10-01T10:00:00.000Z',
  decidedById: 'manager-1',
};
const declined: StoredCarePlanDecision = {
  decision: 'declined',
  reason: 'Family manage this',
  decidedAt: '2026-10-02T10:00:00.000Z',
  decidedById: 'manager-1',
};

/** In-memory stand-in for the rows table, used as both the Prisma client and the transaction. */
function fakeDb(
  initialRows: Array<StoredRecommendationRow & { submissionId: string }> = [],
) {
  const rows = initialRows.map((r) => ({ ...r }));
  const table = {
    findMany: jest.fn(({ where }: { where: { submissionId: string } }) =>
      Promise.resolve(
        rows.filter((r) => r.submissionId === where.submissionId),
      ),
    ),
    createMany: jest.fn(
      ({ data }: { data: Array<Record<string, unknown>> }) => {
        let count = 0;
        for (const d of data) {
          const dup = rows.some(
            (r) =>
              r.submissionId === d.submissionId &&
              r.legacyRecommendationId === d.legacyRecommendationId,
          );
          if (dup) continue;
          rows.push({
            id: `row-${rows.length + 1}`,
            ...d,
          } as unknown as (typeof rows)[number]);
          count++;
        }
        return Promise.resolve({ count });
      },
    ),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: { id: string; status: StoredStatus };
        data: Record<string, unknown>;
      }) => {
        const hit = rows.filter(
          (r) => r.id === where.id && r.status === where.status,
        );
        hit.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hit.length });
      },
    ),
  };
  return { rows, db: { initialAssessmentCarePlanRecommendation: table } };
}

function serviceWith(db: unknown, calculated: CarePlanRecommendation[]) {
  const service = new InitialAssessmentCarePlanRulesService(
    db as PrismaService,
  );
  const resolve = jest
    .spyOn(service, 'resolveRecommendations')
    .mockResolvedValue(calculated);
  return { service, resolve };
}

const SUBMISSION = 'sub-1';
const SERVICE_USER = 'su-1';

describe('Phase 2A — persisted IA care plan recommendations', () => {
  describe('1. persisted when an assessment is submitted', () => {
    it('stores every calculated recommendation with its evidence, form, source and legacy id', async () => {
      const { db, rows } = fakeDb();
      const { service } = serviceWith(db, [fallsRec, medRec, legacyRec]);

      const result = await service.persistRecommendations(db as never, {
        submissionId: SUBMISSION,
        serviceUserId: SERVICE_USER,
        metadata: {},
      });

      expect(result).toEqual({ created: 3, refreshed: 0 });
      expect(rows.map((r) => r.legacyRecommendationId)).toEqual([
        'rule-r1',
        'rule-r2',
        'cp-12-oral-health',
      ]);
      const falls = rows[0] as unknown as Record<string, unknown>;
      expect(falls).toMatchObject({
        submissionId: SUBMISSION,
        serviceUserId: SERVICE_USER,
        carePathwayFormId: FALLS_FORM,
        sourceType: 'rule',
        status: StoredStatus.PENDING,
        sortOrder: 0,
      });
      expect(falls.evidenceJson).toMatchObject({
        triggers: fallsRec.triggers,
        aliasIds: ['cp-3-environment'],
        ruleId: 'r1',
      });
      expect(rows[2]).toMatchObject({
        carePathwayFormId: null,
        sourceType: 'legacy',
      });
    });

    it('stores nothing when nothing is recommended', async () => {
      const { db, rows } = fakeDb();
      const { service } = serviceWith(db, []);
      await service.persistRecommendations(db as never, {
        submissionId: SUBMISSION,
        serviceUserId: SERVICE_USER,
        metadata: {},
      });
      expect(rows).toHaveLength(0);
      expect(
        db.initialAssessmentCarePlanRecommendation.createMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('2. repeated processing is idempotent', () => {
    it('a second submit creates no new rows', async () => {
      const { db, rows } = fakeDb();
      const { service } = serviceWith(db, [fallsRec, medRec]);
      const input = {
        submissionId: SUBMISSION,
        serviceUserId: SERVICE_USER,
        metadata: {},
      };
      await service.persistRecommendations(db as never, input);
      const second = await service.persistRecommendations(db as never, input);

      expect(second.created).toBe(0);
      expect(rows).toHaveLength(2);
    });

    it('does not add a second row for a form already stored under another id or alias', () => {
      const existing: StoredRecommendationRow[] = [
        {
          id: 'a',
          legacyRecommendationId: 'cp-3-environment',
          carePathwayFormId: null,
          status: StoredStatus.PENDING,
          evidenceJson: {},
        },
        {
          id: 'b',
          legacyRecommendationId: 'cp-9-medication',
          carePathwayFormId: MED_FORM,
          status: StoredStatus.PENDING,
          evidenceJson: {},
        },
      ];
      const plan = planRecommendationPersistence({
        recommendations: [fallsRec, medRec],
        existing,
        decisions: {},
      });
      expect(plan.create).toHaveLength(0);
    });

    it('does not duplicate when the same calculation lists a recommendation twice', () => {
      const plan = planRecommendationPersistence({
        recommendations: [fallsRec, fallsRec],
        existing: [],
        decisions: {},
      });
      expect(plan.create).toHaveLength(1);
    });
  });

  describe('3. existing decisions are preserved', () => {
    it('never changes an accepted or declined row on resubmission, and keeps rows no longer calculated', async () => {
      const { db, rows } = fakeDb([
        {
          id: 'row-a',
          submissionId: SUBMISSION,
          legacyRecommendationId: 'rule-r1',
          carePathwayFormId: FALLS_FORM,
          status: StoredStatus.ACCEPTED,
          evidenceJson: { title: 'Falls (old evidence)' },
        },
        {
          id: 'row-b',
          submissionId: SUBMISSION,
          legacyRecommendationId: 'rule-r2',
          carePathwayFormId: MED_FORM,
          status: StoredStatus.DECLINED,
          evidenceJson: { title: 'Medication (old evidence)' },
        },
        {
          id: 'row-c',
          submissionId: SUBMISSION,
          legacyRecommendationId: 'cp-7-sleep',
          carePathwayFormId: null,
          status: StoredStatus.PENDING,
          evidenceJson: { title: 'Sleep' },
        },
      ]);
      const changedFalls = { ...fallsRec, title: 'Falls (new evidence)' };
      const { service } = serviceWith(db, [changedFalls, medRec]);

      const result = await service.persistRecommendations(db as never, {
        submissionId: SUBMISSION,
        serviceUserId: SERVICE_USER,
        metadata: {},
      });

      expect(result).toEqual({ created: 0, refreshed: 0 });
      expect(rows.find((r) => r.id === 'row-a')).toMatchObject({
        status: StoredStatus.ACCEPTED,
        evidenceJson: { title: 'Falls (old evidence)' },
      });
      expect(rows.find((r) => r.id === 'row-b')?.status).toBe(
        StoredStatus.DECLINED,
      );
      expect(rows.find((r) => r.id === 'row-c')).toBeDefined();
    });

    it('refreshes the evidence of a pending row stored under the same id', async () => {
      const { db, rows } = fakeDb([
        {
          id: 'row-a',
          submissionId: SUBMISSION,
          legacyRecommendationId: 'rule-r1',
          carePathwayFormId: FALLS_FORM,
          status: StoredStatus.PENDING,
          evidenceJson: { title: 'old' },
        },
      ]);
      const { service } = serviceWith(db, [{ ...fallsRec, title: 'new' }]);
      await service.persistRecommendations(db as never, {
        submissionId: SUBMISSION,
        serviceUserId: SERVICE_USER,
        metadata: {},
      });
      expect(rows[0]).toMatchObject({
        status: StoredStatus.PENDING,
        evidenceJson: { title: 'new', status: 'pending' },
      });
    });

    it('carries decisions already in metadata.carePlanDecisions onto new rows — including ones stored under an alias', () => {
      const plan = planRecommendationPersistence({
        recommendations: [fallsRec, medRec, legacyRec],
        existing: [],
        decisions: { 'cp-3-environment': accepted, 'rule-r2': declined },
      });
      expect(
        plan.create.map((r) => [r.legacyRecommendationId, r.status]),
      ).toEqual([
        ['rule-r1', StoredStatus.ACCEPTED],
        ['rule-r2', StoredStatus.DECLINED],
        ['cp-12-oral-health', StoredStatus.PENDING],
      ]);
      expect(plan.create[1]).toMatchObject({
        decisionReason: 'Family manage this',
        decidedById: 'manager-1',
        decidedAt: new Date('2026-10-02T10:00:00.000Z'),
      });
      expect(plan.create[2]).toMatchObject({
        decisionReason: null,
        decidedById: null,
        decidedAt: null,
      });
    });

    it('does not store decision state inside the evidence snapshot', () => {
      const plan = planRecommendationPersistence({
        recommendations: [{ ...fallsRec, status: 'accepted' }],
        existing: [],
        decisions: {},
      });
      expect(plan.create[0].status).toBe(StoredStatus.PENDING);
      expect(plan.create[0].evidenceJson).toMatchObject({ status: 'pending' });
    });
  });

  describe('4. existing recommendation ids stay compatible', () => {
    const storedRow: StoredRecommendationRow = {
      id: 'uuid-row',
      legacyRecommendationId: 'rule-r1',
      carePathwayFormId: FALLS_FORM,
      status: StoredStatus.PENDING,
      evidenceJson: { ...fallsRec, id: 'ignored', status: 'pending' },
    };

    it('returns the legacy id (not the row uuid) in the existing response shape', () => {
      const out = recommendationFromStoredRow(storedRow);
      expect(out).toEqual({ ...fallsRec, id: 'rule-r1', status: 'pending' });
    });

    it('applies decisions stored under the id or an alias, and the decide lookup still accepts an alias', () => {
      const stored = [recommendationFromStoredRow(storedRow)];
      const [withDecision] = applyCarePlanDecisions(stored, {
        'cp-3-environment': declined,
      });
      expect(withDecision).toMatchObject({
        id: 'rule-r1',
        status: 'declined',
        declineReason: 'Family manage this',
      });
      expect(findCarePlanRecommendation(stored, 'cp-3-environment')?.id).toBe(
        'rule-r1',
      );
      expect(findCarePlanRecommendation(stored, 'rule-r1')?.id).toBe('rule-r1');
    });
  });

  describe('5. older assessments use the live calculation', () => {
    it('falls back to resolveRecommendations when nothing is stored', async () => {
      const { db } = fakeDb();
      const { service, resolve } = serviceWith(db, [fallsRec]);
      await expect(
        service.loadRecommendations('old-submission'),
      ).resolves.toEqual([fallsRec]);
      expect(resolve).toHaveBeenCalledWith('old-submission', db);
    });

    it('returns stored rows, in stored order, without recalculating when they exist', async () => {
      const { db } = fakeDb([
        {
          id: 'row-a',
          submissionId: SUBMISSION,
          legacyRecommendationId: 'rule-r2',
          carePathwayFormId: MED_FORM,
          status: StoredStatus.PENDING,
          evidenceJson: { ...medRec },
        },
      ]);
      const { service, resolve } = serviceWith(db, [fallsRec]);
      const out = await service.loadRecommendations(SUBMISSION);
      expect(out.map((r) => r.id)).toEqual(['rule-r2']);
      expect(resolve).not.toHaveBeenCalled();
      expect(
        db.initialAssessmentCarePlanRecommendation.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { submissionId: SUBMISSION } }),
      );
    });
  });

  describe('6. decisions require the review permission', () => {
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

    it('rejects a user who can only update assessments', () => {
      expect(() =>
        canDecide(['service_users.initial_assessment.update']),
      ).toThrow(ForbiddenException);
      expect(() =>
        canDecide(['service_users.initial_assessment.read']),
      ).toThrow(ForbiddenException);
    });

    it('allows a user with the review permission', () => {
      expect(canDecide(['service_users.initial_assessment.review'])).toBe(true);
    });
  });
});
