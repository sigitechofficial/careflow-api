import { NotFoundException } from '@nestjs/common';
import { InitialAssessmentStatus } from '@prisma/client';
import { InitialAssessmentsService } from './initial-assessments.service';
import type { CarePlanRecommendationDecision } from './dto/initial-assessment-care-plan-decision.dto';
import {
  readCarePlanDecisions,
  type StoredCarePlanDecision,
} from './initial-assessment-care-plan-decisions.util';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';

export const SU = 'su-1';
export const SUB = 'sub-1';
export const MANAGER = 'manager-1';

export const falls: CarePlanRecommendation = {
  id: 'rule-falls',
  carePlanArea: 'Falls',
  sectionNumber: 3,
  sectionTitle: 'Mobility',
  title: 'Falls',
  triggerCount: 1,
  triggers: [
    { questionId: 'q1', questionText: 'Any falls in the last 12 months?' },
  ],
  status: 'pending',
  carePathwayFormId: 'form-falls',
  carePathwayFormName: 'Falls',
  source: 'rule',
  aliasIds: ['cp-3-environment'],
};

export const prior = (
  decision: StoredCarePlanDecision['decision'],
  reason: string | null = null,
  extra: Partial<StoredCarePlanDecision> = {},
): StoredCarePlanDecision => ({
  decision,
  reason,
  decidedAt: '2026-10-01T10:00:00.000Z',
  decidedById: 'manager-0',
  ...extra,
});

export type FakeInstance = {
  id: string;
  serviceUserId: string;
  carePathwayFormId: string;
  status: 'DRAFT' | 'PUBLISHED';
  draft: {
    id: string;
    valuesJson: unknown;
    composedFromJson?: unknown;
    gapsJson?: unknown;
  } | null;
  publishedVersions: Array<{ versionNumber: number; valuesJson: unknown }>;
};

export type ComposeData = {
  values: Record<string, string | boolean>;
  composedFrom: Record<string, unknown>;
  gaps: unknown[];
  provenance?: Record<string, unknown>;
  suggestionMode?: 'explicit' | 'hybrid' | 'generic';
};

export type DecideResult = {
  data: {
    recommendation: {
      status: string;
      decisionReason?: string | null;
      carePlanInstanceId?: string | null;
      linkedCarePlan?: {
        instanceId: string;
        status: string;
        hasDraft: boolean;
      };
      linkedCarePlanReviewRequired?: boolean;
    } | null;
    carePlan?: {
      instanceId: string;
      action: string;
      prefilled?: boolean;
      status: string;
    };
  };
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Runs the real `decideCarePlanRecommendation` against in-memory collaborators: the submission and
 * its metadata JSON, stored recommendation rows, the care plan catalogue, care plan instances and
 * drafts, compose and the audit log. `$transaction` restores every in-memory store if the callback
 * throws, like a database rollback.
 */
export function harness(opts: {
  status?: InitialAssessmentStatus;
  decisions?: Record<string, StoredCarePlanDecision>;
  recommendations?: CarePlanRecommendation[];
  catalogue?: Array<{ id: string; name: string }>;
  instances?: FakeInstance[];
  compose?: ComposeData | (() => Promise<{ data: ComposeData }>);
  failDraftInsert?: boolean;
}) {
  const state = {
    submission: {
      id: SUB,
      serviceUserId: SU,
      status: opts.status ?? InitialAssessmentStatus.REVIEWED,
      metadata: {
        carePlanDecisions: opts.decisions ?? {},
        other: 'kept',
      } as Record<string, unknown>,
    },
    instances: clone(opts.instances ?? []),
    rowUpdates: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
    audits: [] as Array<Record<string, unknown>>,
  };
  const catalogue = opts.catalogue ?? [{ id: 'form-falls', name: 'Falls' }];
  let nextId = 1;
  const findInstance = (serviceUserId: string, carePathwayFormId: string) =>
    state.instances.find(
      (i) =>
        i.serviceUserId === serviceUserId &&
        i.carePathwayFormId === carePathwayFormId,
    );
  const instanceView = (i: FakeInstance) => ({
    ...i,
    draft: i.draft ? { id: i.draft.id } : null,
  });
  type UniqueWhere = {
    serviceUserId_carePathwayFormId: {
      serviceUserId: string;
      carePathwayFormId: string;
    };
  };

  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id: SUB }])),
    initialAssessmentSubmission: {
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({
          status: state.submission.status,
          metadata: clone(state.submission.metadata),
        }),
      ),
      update: jest.fn(
        ({ data }: { data: { metadata: Record<string, unknown> } }) => {
          state.submission.metadata = data.metadata;
          return Promise.resolve({ ...state.submission });
        },
      ),
    },
    initialAssessmentRiskRecord: { count: jest.fn(() => Promise.resolve(0)) },
    initialAssessmentCarePlanRecommendation: {
      updateMany: jest.fn(
        (args: { where: unknown; data: Record<string, unknown> }) => {
          state.rowUpdates.push(args);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    serviceUserCarePlanInstance: {
      createMany: jest.fn(
        ({
          data,
        }: {
          data: Array<{ serviceUserId: string; carePathwayFormId: string }>;
        }) => {
          let count = 0;
          for (const d of data) {
            if (findInstance(d.serviceUserId, d.carePathwayFormId)) continue;
            state.instances.push({
              id: `inst-${nextId++}`,
              ...d,
              status: 'DRAFT',
              draft: null,
              publishedVersions: [],
            });
            count++;
          }
          return Promise.resolve({ count });
        },
      ),
      findUniqueOrThrow: jest.fn(({ where }: { where: UniqueWhere }) => {
        const i = findInstance(
          where.serviceUserId_carePathwayFormId.serviceUserId,
          where.serviceUserId_carePathwayFormId.carePathwayFormId,
        );
        return i
          ? Promise.resolve(instanceView(i))
          : Promise.reject(new Error('not found'));
      }),
    },
    serviceUserCarePlanDraft: {
      createMany: jest.fn(
        ({
          data,
        }: {
          data: Array<{
            instanceId: string;
            valuesJson: unknown;
            composedFromJson?: unknown;
            gapsJson?: unknown;
          }>;
        }) => {
          if (opts.failDraftInsert)
            return Promise.reject(new Error('draft insert failed'));
          let count = 0;
          for (const d of data) {
            const i = state.instances.find((x) => x.id === d.instanceId)!;
            if (i.draft) continue;
            i.draft = {
              id: `draft-${nextId++}`,
              valuesJson: d.valuesJson,
              composedFromJson: d.composedFromJson,
              gapsJson: d.gapsJson,
            };
            count++;
          }
          return Promise.resolve({ count });
        },
      ),
    },
  };

  const compose = jest.fn((serviceUserId: string, formId: string) => {
    void serviceUserId;
    void formId;
    if (typeof opts.compose === 'function') return opts.compose();
    return Promise.resolve({
      data: opts.compose ?? {
        values: { 'risk:summary': 'Two falls in the last year' },
        composedFrom: { iaSubmissionId: SUB, mapping: 'falls' },
        gaps: [{ fieldKey: 'risk:plan', severity: 'warning' }],
        provenance: {},
        suggestionMode: 'generic' as const,
      },
    });
  });

  const self = Object.assign(
    Object.create(InitialAssessmentsService.prototype) as object,
    {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      getSubmissionOrThrow: jest.fn(
        (serviceUserId: string, submissionId: string) =>
          serviceUserId === SU && submissionId === SUB
            ? Promise.resolve(clone(state.submission))
            : Promise.reject(
                new NotFoundException('Initial assessment not found'),
              ),
      ),
      carePlanRules: {
        loadRecommendations: jest.fn(() =>
          Promise.resolve(opts.recommendations ?? [falls]),
        ),
      },
      carePlanCompose: { compose },
      prisma: {
        carePathwayForm: {
          findMany: jest.fn(() => Promise.resolve(catalogue)),
          findFirst: jest.fn(({ where }: { where: { id: string } }) => {
            const form = catalogue.find((f) => f.id === where.id);
            return Promise.resolve(
              form ? { ...form, reviewFrequencyMonths: 6 } : null,
            );
          }),
        },
        serviceUserCarePlanInstance: {
          findUnique: jest.fn(({ where }: { where: UniqueWhere }) => {
            const i = findInstance(
              where.serviceUserId_carePathwayFormId.serviceUserId,
              where.serviceUserId_carePathwayFormId.carePathwayFormId,
            );
            return Promise.resolve(i ? { id: i.id } : null);
          }),
          findMany: jest.fn(
            ({
              where,
            }: {
              where: { id: { in: string[] }; serviceUserId: string };
            }) =>
              Promise.resolve(
                state.instances
                  .filter(
                    (i) =>
                      where.id.in.includes(i.id) &&
                      i.serviceUserId === where.serviceUserId,
                  )
                  .map(instanceView),
              ),
          ),
        },
        $transaction: jest.fn(
          async (fn: (t: typeof tx) => Promise<unknown>) => {
            const snapshot = clone({
              submission: state.submission,
              instances: state.instances,
              rowUpdates: state.rowUpdates,
              audits: state.audits,
            });
            try {
              return await fn(tx);
            } catch (error) {
              Object.assign(state, snapshot);
              throw error;
            }
          },
        ),
      },
      audit: {
        logAudit: jest.fn((entry: Record<string, unknown>) => {
          state.audits.push({
            ...entry,
            tx: entry.tx === tx ? 'tx' : entry.tx,
          });
          return Promise.resolve();
        }),
      },
      mapSubmission: (row: unknown) => row,
    },
  );

  const decide = (
    decision: CarePlanRecommendationDecision,
    reason?: string,
    recommendationId = 'rule-falls',
    serviceUserId = SU,
  ) =>
    (
      InitialAssessmentsService.prototype.decideCarePlanRecommendation as (
        ...args: unknown[]
      ) => Promise<DecideResult>
    ).call(self, MANAGER, serviceUserId, SUB, recommendationId, {
      decision,
      reason,
    });

  return {
    state,
    decide,
    decisions: () => readCarePlanDecisions(state.submission.metadata),
    lastRowStatus: () => state.rowUpdates.at(-1)?.data.status,
    tx,
    compose,
  };
}
