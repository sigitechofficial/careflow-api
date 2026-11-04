import { ServiceUserCarePlansService } from './service-user-care-plans.service';
import { CarePlanTaskReconciliationService } from './care-plan-task-reconciliation.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { InitialAssessmentCarePlanRulesService } from '../initial-assessments/initial-assessment-care-plan-rules.service';

export const SU = 'su-1';
export const FORM = 'form-falls';
export const AUTHOR = 'author-1';
export const MANAGER = 'manager-1';

export type Draft = {
  id: string;
  instanceId: string;
  valuesJson: Record<string, unknown>;
  composedFromJson: unknown;
  gapsJson: unknown;
  updatedAt: Date;
  updatedById: string | null;
  approvalStatus: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED';
  approvalContentHash: string | null;
  submittedForApprovalAt: Date | null;
  submittedForApprovalById: string | null;
  approvalDecidedAt: Date | null;
  approvalDecidedById: string | null;
  approvalReason: string | null;
};
export type Version = {
  id: string;
  instanceId: string;
  versionNumber: number;
  valuesJson: unknown;
  composedFromJson?: unknown;
  summary: string | null;
  publishedAt: Date;
  publishedById: string | null;
  supersededAt: Date | null;
  approvalJson?: unknown;
};

export type Assignment = {
  id: string;
  serviceUserId: string;
  medicationRoundCode: string;
  dueTime: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  task: { name: string };
};
export type Link = {
  id: string;
  serviceUserId: string;
  carePlanInstanceId: string;
  carePlanPublishedVersionId: string;
  visitTaskAssignmentId: string | null;
  requirementKey: string;
  requirementLabel: string | null;
  status: 'LINKED' | 'REVIEW_REQUIRED' | 'NOT_APPLICABLE';
  reason: string | null;
  linkedById: string | null;
  linkedAt: Date;
  reviewedById: string | null;
  reviewedAt: Date | null;
};

/** In-memory care plan tables behind the real ServiceUserCarePlansService. */
export function setup(
  opts: {
    approvalRequired?: boolean;
    published?: boolean;
    nextReviewDueAt?: Date | null;
    /** Published v1 values (with published: true). */
    publishedValues?: Record<string, unknown>;
    assignments?: Assignment[];
  } = {},
) {
  let clock = Date.parse('2026-11-03T09:00:00Z');
  const tick = () => new Date((clock += 1000));
  const db = {
    settings: { carePlanApprovalRequired: opts.approvalRequired ?? false },
    instance: {
      id: 'inst-1',
      serviceUserId: SU,
      carePathwayFormId: FORM,
      carePathwayFormVersionId: null as string | null,
      status: opts.published ? 'PUBLISHED' : 'DRAFT',
      nextReviewDueAt: opts.nextReviewDueAt ?? null,
      lifecycleStatus: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
      lifecycleReason: null as string | null,
      lifecycleChangedAt: null as Date | null,
      lifecycleChangedById: null as string | null,
      lastReviewedAt: null as Date | null,
      lastReviewedById: null as string | null,
      createdAt: tick(),
      updatedAt: tick(),
    },
    draft: null as Draft | null,
    versions: (opts.published
      ? [
          {
            id: 'ver-1',
            instanceId: 'inst-1',
            versionNumber: 1,
            valuesJson: opts.publishedValues ?? {
              summary: 'Published plan v1',
            },
            summary: 'v1',
            publishedAt: new Date('2026-10-01T09:00:00Z'),
            publishedById: 'someone',
            supersededAt: null,
          },
        ]
      : []) as Version[],
    audits: [] as Array<Record<string, unknown>>,
    links: [] as Link[],
    reassessmentFlags: [] as Array<Record<string, unknown>>,
    assignments: structuredClone(opts.assignments ?? []),
  };
  const instanceRow = () => ({
    ...db.instance,
    draft: db.draft ? { ...db.draft } : null,
    publishedVersions: db.versions
      .filter((v) => !v.supersededAt)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .slice(0, 1),
  });
  const matches = (d: Draft, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v instanceof Date
        ? (d as Record<string, unknown>)[k] instanceof Date &&
          (d as unknown as Record<string, Date>)[k].getTime() === v.getTime()
        : (d as Record<string, unknown>)[k] === v,
    );
  const draftTable = {
    findUnique: jest.fn(
      ({ where }: { where: { id?: string; instanceId?: string } }) =>
        Promise.resolve(
          db.draft &&
            (where.id === db.draft.id ||
              where.instanceId === db.draft.instanceId)
            ? { ...db.draft }
            : null,
        ),
    ),
    findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...db.draft! })),
    upsert: jest.fn(
      ({
        create,
        update,
      }: {
        create: Partial<Draft>;
        update: Partial<Draft>;
      }) => {
        if (db.draft) Object.assign(db.draft, update, { updatedAt: tick() });
        else
          db.draft = {
            id: 'draft-1',
            instanceId: db.instance.id,
            composedFromJson: null,
            gapsJson: null,
            updatedById: null,
            approvalStatus: 'DRAFT',
            approvalContentHash: null,
            submittedForApprovalAt: null,
            submittedForApprovalById: null,
            approvalDecidedAt: null,
            approvalDecidedById: null,
            approvalReason: null,
            valuesJson: {},
            ...create,
            updatedAt: tick(),
          };
        return Promise.resolve({ ...db.draft });
      },
    ),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Draft>;
      }) => {
        if (!db.draft || !matches(db.draft, where))
          return Promise.resolve({ count: 0 });
        Object.assign(db.draft, data, { updatedAt: tick() });
        return Promise.resolve({ count: 1 });
      },
    ),
    deleteMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
      if (db.draft && matches(db.draft, where)) {
        db.draft = null;
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    }),
  };
  let txQueue: Promise<unknown> = Promise.resolve();
  const prisma: Record<string, unknown> = {
    serviceUser: { findFirst: jest.fn(() => Promise.resolve({ id: SU })) },
    carePathwayForm: {
      findFirst: jest.fn(() =>
        Promise.resolve({
          id: FORM,
          name: 'Falls',
          currentVersionId: 'fv-1',
          reviewFrequencyMonths: 6,
          pictureUrl: null,
        }),
      ),
    },
    organisationGeneralSettings: {
      findFirst: jest.fn(() => Promise.resolve({ ...db.settings })),
    },
    serviceUserCarePlanInstance: {
      findUnique: jest.fn(() => Promise.resolve(instanceRow())),
      create: jest.fn(),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(db.instance, data);
        return Promise.resolve(instanceRow());
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; lifecycleStatus?: string };
          data: Record<string, unknown>;
        }) => {
          if (
            where.id !== db.instance.id ||
            (where.lifecycleStatus &&
              where.lifecycleStatus !== db.instance.lifecycleStatus)
          ) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(db.instance, data);
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    serviceUserCarePlanDraft: draftTable,
    serviceUserCarePlanPublishedVersion: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(db.versions.filter((v) => where.id.in.includes(v.id))),
      ),
      findFirst: jest.fn(() =>
        Promise.resolve(
          [...db.versions].sort(
            (a, b) => b.versionNumber - a.versionNumber,
          )[0] ?? null,
        ),
      ),
      updateMany: jest.fn(({ data }: { data: { supersededAt: Date } }) => {
        db.versions
          .filter((v) => !v.supersededAt)
          .forEach((v) => (v.supersededAt = data.supersededAt));
        return Promise.resolve({ count: 1 });
      }),
      create: jest.fn(
        ({
          data,
        }: {
          data: Omit<Version, 'id' | 'publishedAt' | 'supersededAt'>;
        }) => {
          const v = {
            ...data,
            id: `ver-${db.versions.length + 1}`,
            publishedAt: tick(),
            supersededAt: null,
          } as Version;
          db.versions.push(v);
          return Promise.resolve(v);
        },
      ),
    },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    carePlanReassessmentFlag: { findMany: jest.fn(() => Promise.resolve(db.reassessmentFlags)) },
    carePlanRiskLink: { count: jest.fn(() => Promise.resolve(0)) },
    carePlanVisitTaskLink: {
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { carePlanInstanceId: string; status: { in: string[] } };
          data: Partial<Link>;
        }) => {
          const hit = db.links.filter(
            (l) =>
              l.carePlanInstanceId === where.carePlanInstanceId &&
              where.status.in.includes(l.status),
          );
          hit.forEach((l) => Object.assign(l, data));
          return Promise.resolve({ count: hit.length });
        },
      ),
      findMany: jest.fn(
        ({ where }: { where: { carePlanInstanceId: string } }) =>
          Promise.resolve(
            db.links
              .filter((l) => l.carePlanInstanceId === where.carePlanInstanceId)
              .map((l) => ({ ...l })),
          ),
      ),
      findFirst: jest.fn(({ where }: { where: Partial<Link> }) =>
        Promise.resolve(
          db.links.find((l) =>
            Object.entries(where).every(
              ([k, v]) => (l as Record<string, unknown>)[k] === v,
            ),
          ) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: Partial<Link> }) => {
        const dup = db.links.some(
          (l) =>
            l.carePlanInstanceId === data.carePlanInstanceId &&
            l.visitTaskAssignmentId === data.visitTaskAssignmentId &&
            data.visitTaskAssignmentId !== null &&
            l.requirementKey === (data.requirementKey ?? ''),
        );
        if (dup) return Promise.reject(new Error('unique violation'));
        const row = {
          id: `link-${db.links.length + 1}`,
          requirementKey: '',
          requirementLabel: null,
          status: 'LINKED',
          reason: null,
          linkedById: null,
          reviewedById: null,
          reviewedAt: null,
          ...data,
          linkedAt: tick(),
        } as Link;
        db.links.push(row);
        return Promise.resolve({ ...row });
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<Link> }) => {
          const row = db.links.find((l) => l.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        db.links = db.links.filter((l) => l.id !== where.id);
        return Promise.resolve({});
      }),
    },
    serviceUserVisitTaskAssignment: {
      findMany: jest.fn(({ where }: { where: { serviceUserId: string } }) =>
        Promise.resolve(
          db.assignments.filter((a) => a.serviceUserId === where.serviceUserId),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: Partial<Assignment> }) =>
        Promise.resolve(
          db.assignments.find((a) =>
            Object.entries(where).every(
              ([k, v]) => (a as Record<string, unknown>)[k] === v,
            ),
          ) ?? null,
        ),
      ),
    },
    // Interactive transactions run one at a time (like the row lock taken in publish) and are
    // rolled back on error.
    $transaction: jest.fn((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const run = txQueue.then(async () => {
        const snapshot = structuredClone({
          draft: db.draft,
          versions: db.versions,
          instance: db.instance,
          links: db.links,
        });
        try {
          return await (arg as (tx: unknown) => Promise<unknown>)(prisma);
        } catch (error) {
          db.draft = snapshot.draft;
          db.versions = snapshot.versions;
          db.instance = snapshot.instance;
          db.links = snapshot.links;
          throw error;
        }
      });
      txQueue = run.catch(() => undefined);
      return run;
    }),
  };
  const audit = {
    logAudit: jest.fn((entry: Record<string, unknown>) => {
      db.audits.push(entry);
      return Promise.resolve();
    }),
  };
  const service = new ServiceUserCarePlansService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogsService,
    {} as InitialAssessmentCarePlanRulesService,
  );
  const reconciliation = new CarePlanTaskReconciliationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogsService,
  );
  // Publishing also auto-accepts matching IA recommendations; not under test here.
  jest
    .spyOn(
      service as unknown as {
        acceptMatchingIaRecommendationsOnPublish: () => Promise<void>;
      },
      'acceptMatchingIaRecommendationsOnPublish',
    )
    .mockResolvedValue(undefined);

  const save = (values: Record<string, string>, user = AUTHOR) =>
    service.saveDraft(user, SU, FORM, { values });
  const submit = (user = AUTHOR) => service.submitForApproval(user, SU, FORM);
  const hash = () => db.draft!.approvalContentHash!;
  const approve = (user = MANAGER, contentHash = hash()) =>
    service.approveDraft(user, SU, FORM, { contentHash });
  const requestChanges = (reason: string, user = MANAGER) =>
    service.requestDraftChanges(user, SU, FORM, { reason });
  const publish = (user = MANAGER) => service.publish(user, SU, FORM, {});
  return {
    db,
    prisma,
    service,
    reconciliation,
    save,
    submit,
    approve,
    requestChanges,
    publish,
    hash,
  };
}

export const PLAN = {
  'risk:summary': 'Two falls this year',
  'risk:plan': 'Walking frame at all times',
};
