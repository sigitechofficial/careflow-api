import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ServiceUserCarePlansController } from './service-user-care-plans.controller';
import {
  FORM,
  MANAGER,
  SU,
  setup,
  type Assignment,
} from './care-plan.test-harness';

const FIELDS = [
  {
    key: 'mob:frame',
    label: 'I use a walking frame',
    fieldType: 'YES_NO',
    sectionTitle: 'Mobility',
  },
  {
    key: 'mob:transfer',
    label: 'Transfer support',
    fieldType: 'SELECT',
    sectionTitle: 'Mobility',
  },
  {
    key: 'mob:notes',
    label: 'How to help me',
    fieldType: 'TEXTAREA',
    sectionTitle: 'Mobility',
  },
  {
    key: 'mob:hoist',
    label: 'Hoist needed',
    fieldType: 'YES_NO',
    sectionTitle: 'Mobility',
  },
];

jest.mock('./compose/compose-context.loader', () => ({
  ...jest.requireActual<object>('./compose/compose-context.loader'),
  loadCarePlanFormFields: jest.fn(() =>
    Promise.resolve({
      formName: 'Mobility',
      fields: FIELDS,
      reviewFrequencyMonths: 6,
    }),
  ),
}));

const V1 = {
  'mob:frame': true,
  'mob:transfer': 'one_carer',
  // Free text: never read for tasks, even though it mentions some.
  'mob:notes': 'Please help me shower every morning and give my insulin',
  'mob:hoist': false,
};

const task = (
  id: string,
  name: string,
  over: Partial<Assignment> = {},
): Assignment => ({
  id,
  serviceUserId: SU,
  medicationRoundCode: 'MORNING',
  dueTime: null,
  isActive: true,
  deletedAt: null,
  task: { name },
  ...over,
});

const ASSIGNMENTS = [
  task('a-frame', 'Walking frame check'),
  task('a-shower', 'Assist with shower'),
  task('a-old', 'Old task', { deletedAt: new Date('2026-01-01') }),
  task('x-other', 'Other person task', { serviceUserId: 'su-other' }),
];

function plan() {
  return setup({
    published: true,
    publishedValues: V1,
    assignments: ASSIGNMENTS,
  });
}

describe('Phase 4A — care plan ↔ visit task reconciliation', () => {
  it('11. only structured, switched-on fields are requirements; free text creates nothing', async () => {
    const t = plan();
    const view = (await t.reconciliation.getReconciliation(SU, FORM)).data!;
    expect(view.publishedVersion).toEqual({ id: 'ver-1', versionNumber: 1 });
    expect(view.hasStructuredRequirements).toBe(true);
    expect(view.requirements.map((r) => [r.key, r.state])).toEqual([
      ['mob:frame', 'UNLINKED'],
      ['mob:transfer', 'UNLINKED'],
    ]);
    // Existing tasks are offered for linking, nothing is created or claimed missing.
    expect(view.unlinkedAssignments.map((a) => a.id)).toEqual([
      'a-frame',
      'a-shower',
    ]);
    expect(view.links).toEqual([]);
    expect(t.db.links).toEqual([]);

    const freeTextOnly = setup({
      published: true,
      publishedValues: { 'mob:notes': 'Shower daily' },
      assignments: ASSIGNMENTS,
    });
    const none = (await freeTextOnly.reconciliation.getReconciliation(SU, FORM))
      .data!;
    expect(none.hasStructuredRequirements).toBe(false);
    expect(none.requirements).toEqual([]);
  });

  it('1. links an existing task to a requirement, against the current published version, with audit', async () => {
    const t = plan();
    const res = await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-frame',
      requirementKey: 'mob:frame',
    });
    expect(t.db.links).toEqual([
      expect.objectContaining({
        serviceUserId: SU,
        carePlanInstanceId: 'inst-1',
        carePlanPublishedVersionId: 'ver-1',
        visitTaskAssignmentId: 'a-frame',
        requirementKey: 'mob:frame',
        requirementLabel: 'I use a walking frame',
        status: 'LINKED',
        linkedById: MANAGER,
      }),
    ]);
    expect(
      res.data!.requirements.find((r) => r.key === 'mob:frame')!.state,
    ).toBe('LINKED');
    expect(res.data!.links[0]).toMatchObject({
      state: 'LINKED',
      task: { name: 'Walking frame check' },
      confirmedForCurrentVersion: true,
    });
    expect(t.db.audits.at(-1)).toMatchObject({
      action: 'care_plan_task_linked',
      recordType: 'CarePlanVisitTaskLink',
      userId: MANAGER,
      newValues: {
        visitTaskAssignmentId: 'a-frame',
        requirementKey: 'mob:frame',
        status: 'LINKED',
        taskName: 'Walking frame check',
      },
      metadata: {
        carePlanInstanceId: 'inst-1',
        carePlanPublishedVersionId: 'ver-1',
        serviceUserId: SU,
      },
    });
  });

  it('2. refuses a duplicate link (a plan-level link to the same task is separate)', async () => {
    const t = plan();
    await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-frame',
      requirementKey: 'mob:frame',
    });
    await expect(
      t.reconciliation.link(MANAGER, SU, FORM, {
        visitTaskAssignmentId: 'a-frame',
        requirementKey: 'mob:frame',
      }),
    ).rejects.toThrow(ConflictException);
    await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-frame',
    });
    expect(t.db.links.map((l) => l.requirementKey)).toEqual(['mob:frame', '']);
  });

  it('3. refuses another service user’s task, a removed task, and unknown or free-text requirements', async () => {
    const t = plan();
    await expect(
      t.reconciliation.link(MANAGER, SU, FORM, {
        visitTaskAssignmentId: 'x-other',
      }),
    ).rejects.toThrow('not assigned to this service user');
    await expect(
      t.reconciliation.link(MANAGER, SU, FORM, {
        visitTaskAssignmentId: 'a-old',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      t.reconciliation.link(MANAGER, SU, FORM, {
        visitTaskAssignmentId: 'a-shower',
        requirementKey: 'mob:notes',
      }),
    ).rejects.toThrow('not in the published care plan');
    await expect(
      t.reconciliation.link(MANAGER, SU, FORM, {
        visitTaskAssignmentId: 'a-shower',
        requirementKey: 'mob:hoist',
      }),
    ).rejects.toThrow('not in the published care plan');
    expect(t.db.links).toEqual([]);
  });

  it('4. unlink removes the link but keeps it in the audit log; the task is untouched', async () => {
    const t = plan();
    await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-shower',
      requirementKey: 'mob:transfer',
    });
    const linkId = t.db.links[0].id;
    await t.reconciliation.unlink(MANAGER, SU, FORM, linkId, {
      reason: 'Shower is not a transfer task',
    });
    expect(t.db.links).toEqual([]);
    expect(t.db.audits.at(-1)).toMatchObject({
      action: 'care_plan_task_unlinked',
      recordId: linkId,
      oldValues: {
        visitTaskAssignmentId: 'a-shower',
        requirementKey: 'mob:transfer',
        status: 'LINKED',
      },
      newValues: { removed: true, reason: 'Shower is not a transfer task' },
    });
    expect(t.db.assignments).toEqual(ASSIGNMENTS);
  });

  it('5. not applicable needs a reason and a structured requirement', async () => {
    const t = plan();
    await expect(
      t.reconciliation.markNotApplicable(MANAGER, SU, FORM, {
        requirementKey: 'mob:transfer',
        reason: 'no',
      }),
    ).rejects.toThrow('reason is required');
    await expect(
      t.reconciliation.markNotApplicable(MANAGER, SU, FORM, {
        requirementKey: '',
        reason: 'Family do this',
      }),
    ).rejects.toThrow(BadRequestException);

    const res = await t.reconciliation.markNotApplicable(MANAGER, SU, FORM, {
      requirementKey: 'mob:transfer',
      reason: 'Family do transfers',
    });
    expect(t.db.links[0]).toMatchObject({
      status: 'NOT_APPLICABLE',
      visitTaskAssignmentId: null,
      reason: 'Family do transfers',
    });
    expect(
      res.data!.requirements.find((r) => r.key === 'mob:transfer'),
    ).toMatchObject({ state: 'NOT_APPLICABLE' });
    expect(res.data!.links[0]).toMatchObject({
      state: 'NOT_APPLICABLE',
      reason: 'Family do transfers',
    });
    expect(t.db.audits.at(-1)).toMatchObject({
      action: 'care_plan_task_not_applicable',
      newValues: { reason: 'Family do transfers' },
    });
    await expect(
      t.reconciliation.markNotApplicable(MANAGER, SU, FORM, {
        requirementKey: 'mob:transfer',
        reason: 'again',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('6, 9 & 10. tasks, completions and carer workflow are never written to', async () => {
    const t = plan();
    await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-frame',
      requirementKey: 'mob:frame',
    });
    await t.reconciliation.markNotApplicable(MANAGER, SU, FORM, {
      requirementKey: 'mob:transfer',
      reason: 'Family do it',
    });
    await t.reconciliation.unlink(MANAGER, SU, FORM, t.db.links[0].id, {});
    // The fake exposes only reads on assignments and nothing for visits, completions or schedules:
    // any write or access there would throw.
    const assignments = t.prisma.serviceUserVisitTaskAssignment as Record<
      string,
      unknown
    >;
    expect(Object.keys(assignments).sort()).toEqual(['findFirst', 'findMany']);
    expect(t.prisma).not.toHaveProperty('scheduledVisitTaskCompletion');
    expect(t.prisma).not.toHaveProperty('scheduledVisit');
    expect(t.db.assignments).toEqual(ASSIGNMENTS);
  });

  it('7 & 8. publishing a new version flags links for review, keeps their old version, and never blocks', async () => {
    const t = plan();
    await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-frame',
      requirementKey: 'mob:frame',
    });
    await t.reconciliation.markNotApplicable(MANAGER, SU, FORM, {
      requirementKey: 'mob:transfer',
      reason: 'Family do it',
    });
    const v1 = structuredClone(t.db.versions[0]);

    // v2: frame unchanged, transfer support switched off.
    await t.save({ 'mob:frame': 'true', 'mob:notes': 'Updated notes' });
    t.db.draft!.valuesJson = {
      'mob:frame': true,
      'mob:notes': 'Updated notes',
    };
    await t.publish();

    expect(
      t.db.links.map((l) => [
        l.requirementKey,
        l.status,
        l.carePlanPublishedVersionId,
      ]),
    ).toEqual([
      ['mob:frame', 'REVIEW_REQUIRED', 'ver-1'],
      ['mob:transfer', 'REVIEW_REQUIRED', 'ver-1'],
    ]);
    expect(
      t.db.audits.find((a) => a.action === 'care_plan_task_links_flagged'),
    ).toMatchObject({
      newValues: { count: 2, status: 'REVIEW_REQUIRED' },
    });
    expect(t.db.versions[0]).toMatchObject({
      ...v1,
      supersededAt: t.db.versions[0].supersededAt,
    });
    expect(t.db.versions[0].valuesJson).toEqual(V1);

    const view = (await t.reconciliation.getReconciliation(SU, FORM)).data!;
    expect(view.publishedVersion.versionNumber).toBe(2);
    const frame = view.links.find((l) => l.requirementKey === 'mob:frame')!;
    const transfer = view.links.find(
      (l) => l.requirementKey === 'mob:transfer',
    )!;
    expect(frame).toMatchObject({
      state: 'REVIEW_REQUIRED',
      suggestedReuse: true,
      confirmedForVersionNumber: 1,
    });
    expect(transfer).toMatchObject({
      state: 'REVIEW_REQUIRED',
      requirementGone: true,
      suggestedReuse: false,
    });

    // A manager confirms the unchanged one; the removed requirement must be unlinked instead.
    await t.reconciliation.markReviewed(MANAGER, SU, FORM, frame.id);
    expect(t.db.links.find((l) => l.id === frame.id)).toMatchObject({
      status: 'LINKED',
      carePlanPublishedVersionId: t.db.versions[1].id,
      reviewedById: MANAGER,
    });
    await expect(
      t.reconciliation.markReviewed(MANAGER, SU, FORM, transfer.id),
    ).rejects.toThrow('Unlink it instead');
  });

  it('a link whose task was later removed shows as needing review', async () => {
    const t = plan();
    await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-shower',
    });
    t.db.assignments.find((a) => a.id === 'a-shower')!.deletedAt = new Date();
    const view = (await t.reconciliation.getReconciliation(SU, FORM)).data!;
    expect(view.links[0]).toMatchObject({
      state: 'REVIEW_REQUIRED',
      assignmentInactive: true,
    });
  });

  it('archived plans are read-only; unpublished plans have nothing to reconcile', async () => {
    const t = plan();
    t.db.instance.lifecycleStatus = 'ARCHIVED';
    await expect(
      t.reconciliation.link(MANAGER, SU, FORM, {
        visitTaskAssignmentId: 'a-frame',
      }),
    ).rejects.toThrow('archived');
    const draftOnly = setup({ assignments: ASSIGNMENTS });
    await expect(
      draftOnly.reconciliation.getReconciliation(SU, FORM),
    ).resolves.toEqual({ data: null });
  });

  describe('12 & permissions', () => {
    const guard = new PermissionsGuard(new Reflector());
    const can = (
      handler: keyof ServiceUserCarePlansController,
      permissions: string[],
    ) =>
      guard.canActivate({
        getHandler: () => ServiceUserCarePlansController.prototype[handler],
        getClass: () => ServiceUserCarePlansController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { roles: ['Carer/Domestic'], permissions },
          }),
        }),
      } as unknown as ExecutionContext);

    it('changing links needs the manager-level permission; carers with visit task access cannot', () => {
      for (const h of [
        'linkVisitTask',
        'unlinkVisitTask',
        'reviewVisitTaskLink',
        'markRequirementNotApplicable',
      ] as const) {
        expect(() =>
          can(h, ['service_users.visit_tasks.write', 'service_users.update']),
        ).toThrow(ForbiddenException);
        expect(can(h, ['service_users.care_plan.approve'])).toBe(true);
      }
      expect(
        can('getTaskReconciliation', ['service_users.visit_tasks.read']),
      ).toBe(true);
    });

    it('existing care plan endpoints keep their permissions and response shape', async () => {
      expect(can('get', ['service_users.read'])).toBe(true);
      expect(can('publish', ['service_users.update'])).toBe(true);
      const t = plan();
      const res = await t.service.getInstance(SU, FORM);
      expect(res.data).toMatchObject({
        id: 'inst-1',
        status: 'PUBLISHED',
        displayStatus: 'PUBLISHED',
        latestPublishedVersion: { id: 'ver-1', versionNumber: 1 },
        draft: null,
      });
      expect(res.data?.review).toBeDefined();
    });
  });
});
