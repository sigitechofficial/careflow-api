import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ServiceUserCarePlansController } from './service-user-care-plans.controller';
import { EmployeeAppClientDetailService } from '../employee-app/employee-app-client-detail.service';
import { DEFAULT_REVIEW_SETTINGS } from '../organisation-general-settings/review-settings.util';
import {
  AUTHOR,
  FORM,
  MANAGER,
  PLAN,
  SU,
  setup,
} from './care-plan.test-harness';

const reason = 'Admitted to hospital';

function publishedPlan(opts: Parameters<typeof setup>[0] = {}) {
  return setup({ published: true, ...opts });
}

describe('Phase 3B — publication, version control & lifecycle', () => {
  describe('publication', () => {
    it('1. an approved draft publishes as the next version and consumes the approval', async () => {
      const t = setup({ approvalRequired: true });
      await t.save(PLAN);
      await t.submit();
      await t.approve();
      await t.publish();
      expect(t.db.versions.map((v) => v.versionNumber)).toEqual([1]);
      expect(t.db.draft).toBeNull();
      await t.save({ ...PLAN, 'risk:plan': 'next revision' });
      await expect(t.publish()).rejects.toThrow('must be approved');
    });

    it('2. with approval off, publishing works as before', async () => {
      const t = setup();
      await t.save(PLAN);
      await t.publish(AUTHOR);
      expect(t.db.versions).toHaveLength(1);
      expect(t.db.instance.status).toBe('PUBLISHED');
    });

    it('3. repeated and concurrent publish requests create exactly one version', async () => {
      const t = setup();
      await t.save(PLAN);
      const results = await Promise.allSettled([t.publish(), t.publish()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictException);
      expect(t.db.versions).toHaveLength(1);

      await expect(t.publish()).rejects.toThrow(BadRequestException); // no draft left
      expect(t.db.versions).toHaveLength(1);
    });

    it('3b. a draft edited during publication is not half-published', async () => {
      const t = setup();
      await t.save(PLAN);
      // Someone saves a newer draft between the read and the consume step.
      const original = t.prisma.serviceUserCarePlanDraft as {
        deleteMany: jest.Mock;
      };
      original.deleteMany.mockImplementationOnce(() =>
        Promise.resolve({ count: 0 }),
      );
      await expect(t.publish()).rejects.toThrow(ConflictException);
      expect(t.db.versions).toHaveLength(0);
      expect(t.db.instance.status).toBe('DRAFT');
    });

    it('4 & 5 & 13. versions increase by one, the previous one is superseded, and history is untouched', async () => {
      const t = publishedPlan();
      const v1 = structuredClone(t.db.versions[0]);
      await t.save({ summary: 'v2' });
      await t.publish();
      await t.save({ summary: 'v3' });
      await t.publish();

      expect(t.db.versions.map((v) => v.versionNumber)).toEqual([1, 2, 3]);
      expect(
        t.db.versions
          .filter((v) => v.supersededAt === null)
          .map((v) => v.versionNumber),
      ).toEqual([3]);
      expect(t.db.versions[0]).toMatchObject({
        ...v1,
        supersededAt: t.db.versions[0].supersededAt,
      });
      expect(t.db.versions[0].supersededAt).toBeInstanceOf(Date);
      const latest = await t.service.getInstance(SU, FORM);
      expect(latest.data?.latestPublishedVersion?.versionNumber).toBe(3);
    });
  });

  describe('lifecycle', () => {
    it('6. suspend keeps the published version, records reason/who/when and the version, and audits', async () => {
      const t = publishedPlan();
      const res = await t.service.suspend(MANAGER, SU, FORM, { reason });

      expect(t.db.instance).toMatchObject({
        status: 'PUBLISHED',
        lifecycleStatus: 'SUSPENDED',
        lifecycleReason: reason,
        lifecycleChangedById: MANAGER,
      });
      expect(t.db.versions[0]).toMatchObject({
        versionNumber: 1,
        supersededAt: null,
      });
      expect(res.data).toMatchObject({
        lifecycle: { status: 'SUSPENDED', reason, changedById: MANAGER },
        latestPublishedVersion: { versionNumber: 1 },
      });
      expect(t.db.audits.at(-1)).toMatchObject({
        action: 'care_plan_suspended',
        recordType: 'ServiceUserCarePlanInstance',
        recordId: 'inst-1',
        oldValues: { lifecycleStatus: 'ACTIVE' },
        newValues: {
          lifecycleStatus: 'SUSPENDED',
          reason,
          changedById: MANAGER,
          publishedVersionId: 'ver-1',
          publishedVersionNumber: 1,
        },
      });
    });

    it('6b. only published, active plans can be suspended', async () => {
      const draftOnly = setup();
      await draftOnly.save(PLAN);
      await expect(
        draftOnly.service.suspend(MANAGER, SU, FORM, { reason }),
      ).rejects.toThrow('Only a published');

      const t = publishedPlan();
      await t.service.suspend(MANAGER, SU, FORM, { reason });
      await expect(
        t.service.suspend(MANAGER, SU, FORM, { reason }),
      ).rejects.toThrow('cannot be suspended');
    });

    it('7. resume needs confirmation, refuses an overdue plan, and records who and why', async () => {
      const t = publishedPlan({
        nextReviewDueAt: new Date('2027-05-01'),
      });
      await t.service.suspend(MANAGER, SU, FORM, { reason });
      await expect(
        t.service.resume(MANAGER, SU, FORM, {
          reason: 'Home from hospital',
          reviewConfirmed: false,
        }),
      ).rejects.toThrow('Confirm the care plan');

      await t.service.resume(MANAGER, SU, FORM, {
        reason: 'Home from hospital',
        reviewConfirmed: true,
      });
      expect(t.db.instance).toMatchObject({
        lifecycleStatus: 'ACTIVE',
        lifecycleReason: 'Home from hospital',
      });
      expect(t.db.audits.at(-1)).toMatchObject({
        action: 'care_plan_resumed',
        oldValues: { lifecycleStatus: 'SUSPENDED', reason },
        newValues: { lifecycleStatus: 'ACTIVE', changedById: MANAGER },
      });

      const overdue = publishedPlan({
        nextReviewDueAt: new Date('2026-01-01'),
      });
      await overdue.service.suspend(MANAGER, SU, FORM, { reason });
      await expect(
        overdue.service.resume(MANAGER, SU, FORM, {
          reason: 'Back home',
          reviewConfirmed: true,
        }),
      ).rejects.toThrow('overdue for review');
      expect(overdue.db.instance.lifecycleStatus).toBe('SUSPENDED');

      // Reviewing it: the reviewer sets the next review date and publishes a new version. The plan
      // stays suspended until a manager resumes it.
      await overdue.save({
        summary: 'Reviewed after hospital',
        '__meta.nextReviewDate': '2027-06-01',
      });
      await overdue.publish();
      expect(overdue.db.instance.lifecycleStatus).toBe('SUSPENDED');
      expect(overdue.db.instance.nextReviewDueAt!.getTime()).toBeGreaterThan(
        Date.now(),
      );
      await overdue.service.resume(MANAGER, SU, FORM, {
        reason: 'Back home',
        reviewConfirmed: true,
      });
      expect(overdue.db.instance.lifecycleStatus).toBe('ACTIVE');
    });

    it('8. archive keeps every record, blocks editing and publishing, and cannot be undone here', async () => {
      const t = publishedPlan();
      await t.save({ summary: 'unpublished draft' });
      await t.service.archive(MANAGER, SU, FORM, { reason: 'Service ended' });

      expect(t.db.instance).toMatchObject({
        lifecycleStatus: 'ARCHIVED',
        status: 'PUBLISHED',
      });
      expect(t.db.versions).toHaveLength(1);
      expect(t.db.draft).not.toBeNull();
      await expect(t.save({ summary: 'x' })).rejects.toThrow('archived');
      await expect(t.publish()).rejects.toThrow('archived');
      await expect(t.submit()).rejects.toThrow('archived');
      await expect(
        t.service.resume(MANAGER, SU, FORM, {
          reason: 'Back',
          reviewConfirmed: true,
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        t.service.archive(MANAGER, SU, FORM, { reason: 'again' }),
      ).rejects.toThrow('cannot be archived');
      expect(t.db.audits.at(-1)).toMatchObject({
        action: 'care_plan_archived',
        newValues: { reason: 'Service ended' },
      });

      const suspended = publishedPlan();
      await suspended.service.suspend(MANAGER, SU, FORM, { reason });
      await suspended.service.archive(MANAGER, SU, FORM, {
        reason: 'Moved to residential care',
      });
      expect(suspended.db.instance.lifecycleStatus).toBe('ARCHIVED');
    });

    it('9. every lifecycle change needs a reason', async () => {
      const t = publishedPlan();
      await expect(
        t.service.suspend(MANAGER, SU, FORM, { reason: ' ' }),
      ).rejects.toThrow('reason is required');
      await expect(
        t.service.archive(MANAGER, SU, FORM, { reason: 'no' }),
      ).rejects.toThrow('reason is required');
      await t.service.suspend(MANAGER, SU, FORM, { reason });
      await expect(
        t.service.resume(MANAGER, SU, FORM, {
          reason: '',
          reviewConfirmed: true,
        }),
      ).rejects.toThrow('reason is required');
      expect(t.db.instance.lifecycleStatus).toBe('SUSPENDED');
    });

    it('10. suspend, resume and archive need the manager-level approve permission', () => {
      for (const handler of ['suspend', 'resume', 'archive'] as const) {
        const ctx = (permissions: string[]) =>
          ({
            getHandler: () => ServiceUserCarePlansController.prototype[handler],
            getClass: () => ServiceUserCarePlansController,
            switchToHttp: () => ({
              getRequest: () => ({
                user: { roles: ['Care Coordinator'], permissions },
              }),
            }),
          }) as unknown as ExecutionContext;
        const guard = new PermissionsGuard(new Reflector());
        expect(() => guard.canActivate(ctx(['service_users.update']))).toThrow(
          ForbiddenException,
        );
        expect(
          guard.canActivate(ctx(['service_users.care_plan.approve'])),
        ).toBe(true);
      }
    });
  });

  describe('11 & 12. carer visibility', () => {
    type Plan = {
      id: string;
      serviceUserId: string;
      lifecycleStatus: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
      nextReviewDueAt: Date | null;
      carePathwayForm: { name: string };
      draftApproval?: string;
      publishedVersions: Array<{
        versionNumber: number;
        summary: string | null;
        publishedAt: Date;
        valuesJson: unknown;
      }>;
    };
    const v = (n: number) => ({
      versionNumber: n,
      summary: `Plan v${n}`,
      publishedAt: new Date(`2026-0${n}-01`),
      valuesJson: {},
    });
    const plans: Plan[] = [
      {
        id: 'active',
        serviceUserId: SU,
        lifecycleStatus: 'ACTIVE',
        nextReviewDueAt: null,
        carePathwayForm: { name: 'Falls' },
        publishedVersions: [v(1)],
      },
      // Published v2 is live while a revision waits for approval.
      {
        id: 'revising',
        serviceUserId: SU,
        lifecycleStatus: 'ACTIVE',
        nextReviewDueAt: null,
        carePathwayForm: { name: 'Medication' },
        draftApproval: 'PENDING_APPROVAL',
        publishedVersions: [v(2), v(1)],
      },
      {
        id: 'suspended',
        serviceUserId: SU,
        lifecycleStatus: 'SUSPENDED',
        nextReviewDueAt: null,
        carePathwayForm: { name: 'Mobility' },
        publishedVersions: [v(1)],
      },
      {
        id: 'archived',
        serviceUserId: SU,
        lifecycleStatus: 'ARCHIVED',
        nextReviewDueAt: null,
        carePathwayForm: { name: 'Night' },
        publishedVersions: [v(1)],
      },
      {
        id: 'draft-only',
        serviceUserId: SU,
        lifecycleStatus: 'ACTIVE',
        nextReviewDueAt: null,
        carePathwayForm: { name: 'Draft' },
        publishedVersions: [],
      },
      {
        id: 'pending-only',
        serviceUserId: SU,
        lifecycleStatus: 'ACTIVE',
        nextReviewDueAt: null,
        carePathwayForm: { name: 'Pending' },
        draftApproval: 'PENDING_APPROVAL',
        publishedVersions: [],
      },
      {
        id: 'approved-unpublished',
        serviceUserId: SU,
        lifecycleStatus: 'ACTIVE',
        nextReviewDueAt: null,
        carePathwayForm: { name: 'Approved' },
        draftApproval: 'APPROVED',
        publishedVersions: [],
      },
    ];
    // Evaluates the parts of the where clause these queries use.
    const matches = (p: Plan, where: Record<string, unknown>) =>
      (where.id === undefined || where.id === p.id) &&
      (where.serviceUserId === undefined ||
        where.serviceUserId === p.serviceUserId) &&
      (where.lifecycleStatus === undefined ||
        where.lifecycleStatus === p.lifecycleStatus) &&
      (where.publishedVersions === undefined || p.publishedVersions.length > 0);
    const prisma = {
      serviceUserCarePlanInstance: {
        findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(plans.filter((p) => matches(p, where))),
        ),
        findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
          Promise.resolve(plans.find((p) => matches(p, where)) ?? null),
        ),
      },
      serviceUser: {
        findFirst: jest.fn(() =>
          Promise.resolve({ id: SU, firstName: 'Ann', lastName: 'Lee' }),
        ),
      },
    };
    const carer = Object.assign(
      Object.create(EmployeeAppClientDetailService.prototype) as object,
      {
        prisma,
        clientsService: {
          assertClientOnRound: jest.fn(() => Promise.resolve()),
        },
        orgSettings: {
          getReviewSettings: jest.fn(() => Promise.resolve(DEFAULT_REVIEW_SETTINGS)),
        },
      },
    ) as {
      loadPublishedCarePlanList: (
        clientId: string,
      ) => Promise<Array<{ id: string; versionNumber: number }>>;
      getCarePlanDetail: (
        employeeId: string,
        clientId: string,
        instanceId: string,
      ) => Promise<unknown>;
    };

    it('lists only active, published plans — with the live version while a revision is pending', async () => {
      const list = await carer.loadPublishedCarePlanList(SU);
      expect(list.map((p) => [p.id, p.versionNumber]).sort()).toEqual([
        ['active', 1],
        ['revising', 2],
      ]);
    });

    it('a suspended or archived plan cannot be opened by a carer', async () => {
      await expect(
        carer.getCarePlanDetail('emp-1', SU, 'suspended'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        carer.getCarePlanDetail('emp-1', SU, 'archived'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        carer.getCarePlanDetail('emp-1', SU, 'draft-only'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('14. review dates', () => {
    it('publishing sets the review date from the form frequency; suspend/resume keep it', async () => {
      const t = setup();
      await t.save(PLAN);
      await t.publish();
      const due = t.db.instance.nextReviewDueAt!;
      expect(due).toBeInstanceOf(Date);
      // Form reviewFrequencyMonths = 6 in the harness.
      const months =
        (due.getUTCFullYear() - new Date().getUTCFullYear()) * 12 +
        due.getUTCMonth() -
        new Date().getUTCMonth();
      expect(months).toBe(6);

      await t.service.suspend(MANAGER, SU, FORM, { reason });
      await t.service.resume(MANAGER, SU, FORM, {
        reason: 'Back home',
        reviewConfirmed: true,
      });
      expect(t.db.instance.nextReviewDueAt).toEqual(due);
    });

    it('the review queue only counts active plans and never changes lifecycle', async () => {
      const t = setup();
      const findMany = jest.fn(() => Promise.resolve([]));
      (
        t.prisma.serviceUserCarePlanInstance as { findMany?: jest.Mock }
      ).findMany = findMany;
      await t.service.reviewQueue({ status: 'overdue' });
      const [args] = findMany.mock.calls[0] as unknown as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toMatchObject({
        status: 'PUBLISHED',
        lifecycleStatus: 'ACTIVE',
      });
      expect(t.db.instance.lifecycleStatus).toBe('ACTIVE');
    });
  });
});
