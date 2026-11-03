import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeReassessmentFlags } from './care-plan-reassessment.util';
import { CarePlanReassessmentService } from './care-plan-reassessment.service';
import { InitialAssessmentsService } from './initial-assessments.service';
import { CarePlanRiskLinkService } from '../service-user-care-plans/care-plan-risk-link.service';
import type { CarePlanRecommendation } from './initial-assessment-care-plan.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { InitialAssessmentCarePlanRulesService } from './initial-assessment-care-plan-rules.service';

const SU = 'su-1';
const rec = (
  formId: string,
  questionIds: string[],
): CarePlanRecommendation => ({
  id: `rule-${formId}`,
  carePlanArea: formId,
  sectionNumber: 1,
  sectionTitle: 's',
  title: formId,
  triggerCount: questionIds.length,
  triggers: questionIds.map((questionId) => ({
    questionId,
    questionText: questionId,
  })),
  status: 'pending',
  carePathwayFormId: formId,
});
const plan = (formId: string, linkedRiskTypes: string[] = []) => ({
  instanceId: `inst-${formId}`,
  carePathwayFormId: formId,
  formName: formId,
  linkedRiskTypes,
});

describe('Reassessment → care plan review (structured comparison)', () => {
  it('flags new, changed and no-longer-indicated needs and new linked risks; leaves unchanged plans alone', () => {
    const flags = computeReassessmentFlags({
      plans: [
        plan('falls', ['FALLS']),
        plan('meds'),
        plan('nutrition'),
        plan('skin'),
        plan('steady'),
      ],
      previous: {
        recommendations: [
          rec('meds', ['q1']),
          rec('nutrition', ['q5']),
          rec('steady', ['q9']),
        ],
        risks: [{ riskType: 'FALLS', riskLevel: 'LOW' }],
      },
      current: {
        recommendations: [
          rec('falls', ['q2']),
          rec('meds', ['q1', 'q3']),
          rec('steady', ['q9']),
        ],
        risks: [{ riskType: 'FALLS', riskLevel: 'HIGH' }],
      },
    });
    const byPlan = Object.fromEntries(
      flags.map((f) => [f.instanceId, f.changeTypes]),
    );
    expect(byPlan).toEqual({
      'inst-falls': ['NEW_NEED', 'NEW_RISK'],
      'inst-meds': ['CHANGED_NEED'],
      'inst-nutrition': ['NO_LONGER_INDICATED'],
    });
    expect(flags.find((f) => f.instanceId === 'inst-meds')!.details).toEqual({
      addedTriggerQuestionIds: ['q3'],
      removedTriggerQuestionIds: [],
    });
  });

  it('without an earlier assessment, every active plan gets a general review flag (no conclusions drawn)', () => {
    const flags = computeReassessmentFlags({
      plans: [plan('falls'), plan('meds')],
      previous: null,
      current: { recommendations: [rec('falls', ['q1'])], risks: [] },
    });
    expect(flags.map((f) => [f.instanceId, f.changeTypes])).toEqual([
      ['inst-falls', ['GENERAL']],
      ['inst-meds', ['GENERAL']],
    ]);
  });
});

/** In-memory tables for the reassessment and risk-link services. */
function world() {
  const state = {
    submissions: [
      {
        id: 'ia-1',
        serviceUserId: SU,
        status: 'REVIEWED',
        submittedAt: new Date('2026-06-01'),
        createdAt: new Date('2026-06-01'),
        deletedAt: null,
      },
      {
        id: 'ia-2',
        serviceUserId: SU,
        status: 'SUBMITTED',
        submittedAt: new Date('2026-11-01'),
        createdAt: new Date('2026-11-01'),
        deletedAt: null,
      },
    ],
    plans: [
      {
        id: 'inst-falls',
        serviceUserId: SU,
        carePathwayFormId: 'falls',
        status: 'PUBLISHED',
        lifecycleStatus: 'ACTIVE',
        name: 'Falls',
      },
      {
        id: 'inst-meds',
        serviceUserId: SU,
        carePathwayFormId: 'meds',
        status: 'PUBLISHED',
        lifecycleStatus: 'ACTIVE',
        name: 'Medication',
      },
      {
        id: 'inst-old',
        serviceUserId: SU,
        carePathwayFormId: 'old',
        status: 'PUBLISHED',
        lifecycleStatus: 'ARCHIVED',
        name: 'Old',
      },
    ],
    risks: [
      {
        id: 'r-old-falls',
        submissionId: 'ia-1',
        serviceUserId: SU,
        riskType: 'FALLS',
        riskLevel: 'LOW',
        severity: 'LOW',
        likelihood: 'LOW',
        status: 'OPEN',
        controlMeasures: 'Frame',
        description: 'Falls',
        supersedeReviewRequired: false,
        supersededBySubmissionId: null as string | null,
        createdAt: new Date(),
      },
      {
        id: 'r-old-fire',
        submissionId: 'ia-1',
        serviceUserId: SU,
        riskType: 'FIRE',
        riskLevel: 'MEDIUM',
        severity: 'MEDIUM',
        likelihood: 'LOW',
        status: 'OPEN',
        controlMeasures: null,
        description: 'Fire',
        supersedeReviewRequired: false,
        supersededBySubmissionId: null as string | null,
        createdAt: new Date(),
      },
      {
        id: 'r-new-falls',
        submissionId: 'ia-2',
        serviceUserId: SU,
        riskType: 'FALLS',
        riskLevel: 'HIGH',
        severity: 'HIGH',
        likelihood: 'HIGH',
        status: 'OPEN',
        controlMeasures: null,
        description: 'Falls',
        supersedeReviewRequired: false,
        supersededBySubmissionId: null as string | null,
        createdAt: new Date(),
      },
      {
        id: 'r-other',
        submissionId: 'x',
        serviceUserId: 'su-other',
        riskType: 'FALLS',
        riskLevel: 'LOW',
        severity: 'LOW',
        likelihood: 'LOW',
        status: 'OPEN',
        controlMeasures: null,
        description: 'x',
        supersedeReviewRequired: false,
        supersededBySubmissionId: null as string | null,
        createdAt: new Date(),
      },
    ],
    flags: [] as Array<Record<string, unknown>>,
    riskLinks: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
  };
  const recs: Record<string, CarePlanRecommendation[]> = {
    'ia-1': [rec('meds', ['q1'])],
    'ia-2': [rec('meds', ['q1', 'q3']), rec('falls', ['q2'])],
  };
  const riskWhere = (
    r: (typeof state.risks)[number],
    w: Record<string, unknown>,
  ) =>
    Object.entries(w).every(([k, v]) => {
      const val = (r as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && 'in' in v)
        return (v as { in: unknown[] }).in.includes(val);
      if (v && typeof v === 'object' && 'not' in v) return val !== v.not;
      return val === v;
    });
  const prisma: Record<string, unknown> = {
    initialAssessmentSubmission: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { id?: string | { not: string }; submittedAt?: { lt: Date } };
        }) => {
          if (typeof where.id === 'string')
            return Promise.resolve(
              state.submissions.find((s) => s.id === where.id) ?? null,
            );
          const lt = where.submittedAt!.lt;
          const prev = state.submissions
            .filter((s) => s.submittedAt < lt)
            .sort((a, b) => +b.submittedAt - +a.submittedAt)[0];
          return Promise.resolve(prev ?? null);
        },
      ),
    },
    serviceUserCarePlanInstance: {
      findMany: jest.fn(() =>
        Promise.resolve(
          state.plans
            .filter(
              (p) => p.status === 'PUBLISHED' && p.lifecycleStatus === 'ACTIVE',
            )
            .map((p) => ({
              id: p.id,
              carePathwayFormId: p.carePathwayFormId,
              carePathwayForm: { name: p.name },
              riskLinks: state.riskLinks
                .filter((l) => l.carePlanInstanceId === p.id)
                .map((l) => ({
                  riskRecord: {
                    riskType: state.risks.find((r) => r.id === l.riskRecordId)!
                      .riskType,
                  },
                })),
            })),
        ),
      ),
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            serviceUserId_carePathwayFormId: { carePathwayFormId: string };
          };
        }) => {
          const p = state.plans.find(
            (x) =>
              x.carePathwayFormId ===
              where.serviceUserId_carePathwayFormId.carePathwayFormId,
          );
          return Promise.resolve(
            p ? { id: p.id, lifecycleStatus: p.lifecycleStatus } : null,
          );
        },
      ),
    },
    initialAssessmentRiskRecord: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(state.risks.filter((r) => riskWhere(r, where))),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(state.risks.find((r) => riskWhere(r, where)) ?? null),
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const hit = state.risks.filter((r) => riskWhere(r, where));
          hit.forEach((r) => Object.assign(r, data));
          return Promise.resolve({ count: hit.length });
        },
      ),
    },
    carePlanReassessmentFlag: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          state.flags.some(
            (f) =>
              f.carePlanInstanceId === data.carePlanInstanceId &&
              f.triggeringSubmissionId === data.triggeringSubmissionId,
          )
        ) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'x',
            }),
          );
        }
        const row = {
          id: `flag-${state.flags.length + 1}`,
          status: 'OPEN',
          createdAt: new Date(),
          ...data,
        };
        state.flags.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(
        ({ where }: { where: { carePlanInstanceId: string } }) =>
          Promise.resolve(
            state.flags.filter(
              (f) => f.carePlanInstanceId === where.carePlanInstanceId,
            ),
          ),
      ),
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(state.flags.find((f) => f.id === where.id) ?? null),
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; status: string };
          data: Record<string, unknown>;
        }) => {
          const hit = state.flags.filter(
            (f) => f.id === where.id && f.status === where.status,
          );
          hit.forEach((f) => Object.assign(f, data));
          return Promise.resolve({ count: hit.length });
        },
      ),
    },
    carePlanRiskLink: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { riskRecordId: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          const hit = state.riskLinks.filter((l) =>
            where.riskRecordId.in.includes(l.riskRecordId as string),
          );
          hit.forEach((l) => Object.assign(l, data));
          return Promise.resolve({ count: hit.length });
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          state.riskLinks.some(
            (l) =>
              l.carePlanInstanceId === data.carePlanInstanceId &&
              l.riskRecordId === data.riskRecordId,
          )
        ) {
          return Promise.reject(
            new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'x',
            }),
          );
        }
        const row = {
          id: `rl-${state.riskLinks.length + 1}`,
          status: 'LINKED',
          linkedAt: new Date(),
          reviewedAt: null,
          reviewReason: null,
          ...data,
        };
        state.riskLinks.push(row);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(
        ({ where }: { where: { carePlanInstanceId: string } }) =>
          Promise.resolve(
            state.riskLinks
              .filter((l) => l.carePlanInstanceId === where.carePlanInstanceId)
              .map((l) => ({
                ...l,
                riskRecord: state.risks.find((r) => r.id === l.riskRecordId),
              })),
          ),
      ),
      findFirst: jest.fn(({ where }: { where: { id: string } }) => {
        const l = state.riskLinks.find((x) => x.id === where.id);
        return Promise.resolve(
          l
            ? {
                ...l,
                riskRecord: state.risks.find((r) => r.id === l.riskRecordId),
              }
            : null,
        );
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const l = state.riskLinks.find((x) => x.id === where.id)!;
          Object.assign(l, data);
          return Promise.resolve({ ...l });
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        state.riskLinks = state.riskLinks.filter((l) => l.id !== where.id);
        return Promise.resolve({});
      }),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const audit = {
    logAudit: jest.fn(
      (e: Record<string, unknown>) => (state.audits.push(e), Promise.resolve()),
    ),
  };
  const rules = {
    loadRecommendations: jest.fn((id: string) =>
      Promise.resolve(recs[id] ?? []),
    ),
  };
  const reassessment = new CarePlanReassessmentService(
    prisma as unknown as PrismaService,
    rules as unknown as InitialAssessmentCarePlanRulesService,
    audit as unknown as AuditLogsService,
  );
  const riskLinks = new CarePlanRiskLinkService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogsService,
  );
  return { state, prisma, reassessment, riskLinks };
}

describe('Reassessment review flags and risk integration', () => {
  it('a new assessment flags affected active plans once, records the trigger, and never touches the plans', async () => {
    const w = world();
    const res = await w.reassessment.onAssessmentCompleted('ia-2', 'mgr');
    expect(res.flagged).toBe(2);
    expect(
      w.state.flags.map((f) => [
        f.carePlanInstanceId,
        f.changeTypes,
        f.triggeringSubmissionId,
        f.previousSubmissionId,
      ]),
    ).toEqual([
      ['inst-falls', ['NEW_NEED'], 'ia-2', 'ia-1'],
      ['inst-meds', ['CHANGED_NEED'], 'ia-2', 'ia-1'],
    ]);
    // Archived plans are not active instructions and are not flagged; plans are unchanged.
    expect(w.state.flags.some((f) => f.carePlanInstanceId === 'inst-old')).toBe(
      false,
    );
    expect(w.state.plans.map((p) => p.lifecycleStatus)).toEqual([
      'ACTIVE',
      'ACTIVE',
      'ARCHIVED',
    ]);

    // Submit then review: the same assessment does not flag twice.
    const again = await w.reassessment.onAssessmentCompleted('ia-2', 'mgr');
    expect(again.flagged).toBe(0);
    expect(w.state.flags).toHaveLength(2);
  });

  it('earlier risks of the same type need an authorised decision; status is never changed and history is kept', async () => {
    const w = world();
    await w.riskLinks.linkRisk('mgr', SU, 'falls', 'r-old-falls');
    const res = await w.reassessment.onAssessmentCompleted('ia-2', 'mgr');
    expect(res.risksForReview).toBe(1);
    const old = w.state.risks.find((r) => r.id === 'r-old-falls')!;
    expect(old).toMatchObject({
      status: 'OPEN',
      supersedeReviewRequired: true,
      supersededBySubmissionId: 'ia-2',
    });
    // A different risk type, and other people's risks, are untouched.
    expect(
      w.state.risks.find((r) => r.id === 'r-old-fire')!.supersedeReviewRequired,
    ).toBe(false);
    expect(
      w.state.risks.find((r) => r.id === 'r-other')!.supersedeReviewRequired,
    ).toBe(false);
    // The plan linked to the old risk must re-check its controls; it is also flagged for the higher risk.
    expect(w.state.riskLinks[0]).toMatchObject({ status: 'REVIEW_REQUIRED' });
    expect(
      w.state.flags.find((f) => f.carePlanInstanceId === 'inst-falls')!
        .changeTypes,
    ).toEqual(['NEW_NEED', 'NEW_RISK']);
    expect(w.state.risks).toHaveLength(4);
  });

  it('reassessment failures never surface to the assessment action', async () => {
    const w = world();
    (
      w.prisma.initialAssessmentSubmission as { findFirst: jest.Mock }
    ).findFirst.mockRejectedValueOnce(new Error('db down'));
    await expect(
      w.reassessment.onAssessmentCompleted('ia-2', 'mgr'),
    ).resolves.toMatchObject({
      error: expect.stringContaining('db down') as string,
    });
  });

  it('risk links: same service user only, no closed risks, no duplicates; review refreshes the snapshot', async () => {
    const w = world();
    await expect(
      w.riskLinks.linkRisk('mgr', SU, 'falls', 'r-other'),
    ).rejects.toThrow(BadRequestException);
    w.state.risks.find((r) => r.id === 'r-old-fire')!.status = 'CLOSED';
    await expect(
      w.riskLinks.linkRisk('mgr', SU, 'falls', 'r-old-fire'),
    ).rejects.toThrow('closed');
    await w.riskLinks.linkRisk('mgr', SU, 'falls', 'r-new-falls');
    await expect(
      w.riskLinks.linkRisk('mgr', SU, 'falls', 'r-new-falls'),
    ).rejects.toThrow(ConflictException);

    const link = w.state.riskLinks[0];
    expect(link.riskSnapshotJson).toMatchObject({
      riskLevel: 'HIGH',
      controlMeasures: null,
    });
    w.state.risks.find((r) => r.id === 'r-new-falls')!.controlMeasures =
      'Pendant alarm';
    link.status = 'REVIEW_REQUIRED';
    const view = await w.riskLinks.reviewRiskLink(
      'mgr',
      SU,
      'falls',
      link.id as string,
    );
    expect(view.data!.links[0]).toMatchObject({
      status: 'LINKED',
      snapshot: { controlMeasures: 'Pendant alarm' },
    });
    expect(w.state.audits.map((a) => a.action)).toEqual([
      'care_plan_risk_linked',
      'care_plan_risk_reviewed',
    ]);

    // Unlinking keeps the risk record itself.
    await w.riskLinks.unlinkRisk('mgr', SU, 'falls', link.id as string);
    expect(w.state.riskLinks).toEqual([]);
    expect(w.state.risks.find((r) => r.id === 'r-new-falls')).toBeDefined();
  });

  it('a manager resolves a review flag with a note; resolving twice is refused', async () => {
    const w = world();
    await w.reassessment.onAssessmentCompleted('ia-2', 'mgr');
    const flagId = w.state.flags[0].id as string;
    await expect(
      w.riskLinks.resolveReassessmentFlag('mgr', SU, 'falls', flagId, 'ok'),
    ).rejects.toThrow(BadRequestException);
    const view = await w.riskLinks.resolveReassessmentFlag(
      'mgr',
      SU,
      'falls',
      flagId,
      'Reviewed — new falls plan drafted',
    );
    expect(view.data!.reassessmentFlags[0]).toMatchObject({
      status: 'RESOLVED',
      resolutionNote: 'Reviewed — new falls plan drafted',
    });
    await expect(
      w.riskLinks.resolveReassessmentFlag('mgr', SU, 'falls', flagId, 'again'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('existing risk update endpoint', () => {
  function call(
    existing: Record<string, unknown>,
    dto: Record<string, unknown>,
  ) {
    const updates: Array<Record<string, unknown>> = [];
    const linkUpdates: Array<Record<string, unknown>> = [];
    const self = Object.assign(
      Object.create(InitialAssessmentsService.prototype) as object,
      {
        getSubmissionOrThrow: jest.fn(() => Promise.resolve({ id: 'ia-1' })),
        logDataAccess: jest.fn(() => Promise.resolve()),
        mapRiskRecord: (r: unknown) => r,
        prisma: {
          initialAssessmentRiskRecord: {
            findFirst: jest.fn(() => Promise.resolve(existing)),
            update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
              updates.push(data);
              const next = { ...existing } as Record<string, unknown>;
              for (const [k, v] of Object.entries(data))
                if (v !== undefined) next[k] = v;
              return Promise.resolve(next);
            }),
          },
          carePlanRiskLink: {
            updateMany: jest.fn(
              (args: Record<string, unknown>) => (
                linkUpdates.push(args),
                Promise.resolve({ count: 1 })
              ),
            ),
          },
        },
      },
    );
    const run = (
      InitialAssessmentsService.prototype.updateRiskRecord as (
        ...a: unknown[]
      ) => Promise<unknown>
    ).call(self, 'mgr', SU, 'ia-1', 'r1', dto);
    return { run, updates, linkUpdates };
  }
  const base = {
    id: 'r1',
    likelihood: 'LOW',
    severity: 'LOW',
    riskLevel: 'LOW',
    status: 'OPEN',
    controlMeasures: 'Frame',
    supersedeReviewRequired: true,
  };

  it('setting a status is the authorised decision that clears the supersede review, and flags linked plans', async () => {
    const c = call(base, { status: 'CONTROLLED' });
    await c.run;
    expect(c.updates[0]).toMatchObject({
      status: 'CONTROLLED',
      supersedeReviewRequired: false,
    });
    expect(c.linkUpdates[0]).toMatchObject({
      where: { riskRecordId: 'r1' },
      data: { status: 'REVIEW_REQUIRED' },
    });
  });

  it('editing only the description neither clears the review nor flags plans; risks are never closed automatically', async () => {
    const c = call(base, { description: 'Clarified wording' });
    await c.run;
    expect(c.updates[0]).not.toHaveProperty('supersedeReviewRequired');
    expect(c.updates[0].status).toBeUndefined();
    expect(c.linkUpdates).toEqual([]);
  });
});
