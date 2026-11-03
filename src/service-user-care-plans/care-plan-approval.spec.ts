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
  carePlanApprovalTransitionError,
  carePlanDraftContentHash,
} from './care-plan-approval.util';
import {
  AUTHOR,
  FORM,
  MANAGER,
  PLAN,
  SU,
  setup,
} from './care-plan.test-harness';

describe('Phase 3A — care plan review & approval', () => {
  it('2. submit for approval records submitter, time and a content hash, and is audited', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    const res = await t.submit();

    expect(t.db.draft).toMatchObject({
      approvalStatus: 'PENDING_APPROVAL',
      submittedForApprovalById: AUTHOR,
      approvalContentHash: carePlanDraftContentHash(t.db.draft!.valuesJson),
    });
    expect(t.db.draft!.submittedForApprovalAt).toBeInstanceOf(Date);
    expect(res.data?.draft?.approval).toMatchObject({
      status: 'PENDING_APPROVAL',
      submittedById: AUTHOR,
    });
    expect(res.data?.carePlanApprovalRequired).toBe(true);
    const entry = t.db.audits.find(
      (a) => a.action === 'care_plan_submitted_for_approval',
    )!;
    expect(entry).toMatchObject({
      recordType: 'ServiceUserCarePlanDraft',
      recordId: 'draft-1',
      oldValues: { status: 'DRAFT' },
      newValues: {
        status: 'PENDING_APPROVAL',
        submittedById: AUTHOR,
        contentHash: t.hash(),
      },
      metadata: { instanceId: 'inst-1', draftId: 'draft-1' },
    });
  });

  it('2b. refuses to submit without a draft, an empty draft, or twice', async () => {
    const t = setup({ approvalRequired: true });
    await expect(t.submit()).rejects.toThrow('Save a draft');
    // Same rule as publishing: a draft with no values cannot be submitted.
    await t.save({});
    t.db.draft!.valuesJson = {};
    await expect(t.submit()).rejects.toThrow('no values');
    await t.save(PLAN);
    await t.submit();
    await expect(t.submit()).rejects.toThrow('already been submitted');
  });

  it('3. approve records approver, time and keeps the reviewed hash', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await t.submit();
    const submittedHash = t.hash();
    await t.approve();
    expect(t.db.draft).toMatchObject({
      approvalStatus: 'APPROVED',
      approvalDecidedById: MANAGER,
      approvalContentHash: submittedHash,
    });
    expect(t.db.audits.at(-1)).toMatchObject({
      action: 'care_plan_approved',
      oldValues: { status: 'PENDING_APPROVAL' },
      newValues: {
        status: 'APPROVED',
        reviewedById: MANAGER,
        submittedById: AUTHOR,
        contentHash: submittedHash,
      },
    });
  });

  it('4. request changes returns the draft to DRAFT with the reason, keeping the content; the author can edit and resubmit', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await t.submit();
    await expect(t.requestChanges('no')).rejects.toThrow(BadRequestException);
    const res = await t.requestChanges('Add the night-time toileting plan');

    expect(t.db.draft).toMatchObject({
      approvalStatus: 'DRAFT',
      approvalReason: 'Add the night-time toileting plan',
    });
    expect(t.db.draft!.valuesJson).toMatchObject(PLAN);
    expect(res.data?.draft?.approval).toMatchObject({
      status: 'DRAFT',
      reason: 'Add the night-time toileting plan',
    });
    expect(t.db.audits.at(-1)).toMatchObject({
      action: 'care_plan_changes_requested',
      newValues: {
        status: 'DRAFT',
        reason: 'Add the night-time toileting plan',
      },
    });

    await t.save({ ...PLAN, 'risk:night': 'Commode by the bed' });
    await t.submit();
    expect(t.db.draft!.approvalStatus).toBe('PENDING_APPROVAL');
    expect(t.db.draft!.approvalReason).toBeNull();
  });

  it('5. invalid transitions are refused', async () => {
    expect(carePlanApprovalTransitionError('DRAFT', 'approve')).toMatch(
      /not awaiting approval/,
    );
    expect(carePlanApprovalTransitionError('DRAFT', 'request_changes')).toMatch(
      /not awaiting approval/,
    );
    expect(carePlanApprovalTransitionError('APPROVED', 'approve')).toMatch(
      /already approved/,
    );
    expect(carePlanApprovalTransitionError('APPROVED', 'submit')).toMatch(
      /already approved/,
    );
    expect(
      carePlanApprovalTransitionError('PENDING_APPROVAL', 'publish'),
    ).toMatch(/must be approved/);
    expect(carePlanApprovalTransitionError('DRAFT', 'publish')).toMatch(
      /must be approved/,
    );
    expect(carePlanApprovalTransitionError('APPROVED', 'publish')).toBeNull();

    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await expect(
      t.service.approveDraft(MANAGER, SU, FORM, {
        contentHash: 'x'.repeat(64),
      }),
    ).rejects.toThrow('not awaiting approval');
  });

  describe('6. unauthorised approval', () => {
    function can(
      handler: keyof ServiceUserCarePlansController,
      permissions: string[],
    ) {
      const context = {
        getHandler: () => ServiceUserCarePlansController.prototype[handler],
        getClass: () => ServiceUserCarePlansController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { roles: ['Care Coordinator'], permissions },
          }),
        }),
      } as unknown as ExecutionContext;
      return new PermissionsGuard(new Reflector()).canActivate(context);
    }

    it('approve and request changes need service_users.care_plan.approve; service_users.update is not enough', () => {
      for (const handler of ['approveDraft', 'requestDraftChanges'] as const) {
        expect(() => can(handler, ['service_users.update'])).toThrow(
          ForbiddenException,
        );
        expect(can(handler, ['service_users.care_plan.approve'])).toBe(true);
      }
      expect(can('submitForApproval', ['service_users.update'])).toBe(true);
    });
  });

  it('7. the submitter cannot approve their own draft', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await t.submit(MANAGER);
    await expect(t.approve(MANAGER)).rejects.toThrow(ForbiddenException);
    expect(t.db.draft!.approvalStatus).toBe('PENDING_APPROVAL');
  });

  it('8. a draft cannot be edited while it is pending approval', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await t.submit();
    await expect(t.save({ ...PLAN, 'risk:plan': 'changed' })).rejects.toThrow(
      ConflictException,
    );
    expect(t.db.draft!.valuesJson).toMatchObject(PLAN);
  });

  it('9. with enforcement on, publishing a DRAFT or PENDING_APPROVAL draft is refused', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await expect(t.publish()).rejects.toThrow('must be approved');
    await t.submit();
    await expect(t.publish()).rejects.toThrow('must be approved');
    expect(t.db.versions).toHaveLength(0);
  });

  it('10. an approved, unchanged draft publishes, consuming the approval and recording it on the version', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await t.submit();
    const reviewedHash = t.hash();
    await t.approve();
    const res = await t.publish();

    expect(t.db.versions).toHaveLength(1);
    expect(t.db.versions[0]).toMatchObject({
      versionNumber: 1,
      approvalJson: {
        contentHash: reviewedHash,
        submittedById: AUTHOR,
        approvedById: MANAGER,
        draftId: 'draft-1',
      },
    });
    expect(t.db.draft).toBeNull(); // consumed: the approval cannot authorise another revision
    expect(t.db.instance.status).toBe('PUBLISHED');
    expect(res.data?.latestPublishedVersion?.versionNumber).toBe(1);
    expect(t.db.audits.at(-1)).toMatchObject({
      action: 'care_plan_published',
      newValues: { approval: { contentHash: reviewedHash } },
    });

    // The next revision starts again as an unapproved draft.
    await t.save({ ...PLAN, 'risk:plan': 'Frame and pendant alarm' });
    expect(t.db.draft!.approvalStatus).toBe('DRAFT');
    await expect(t.publish()).rejects.toThrow('must be approved');
  });

  it('11. changing an approved draft withdraws the approval (re-saving identical content keeps it)', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await t.submit();
    await t.approve();

    await t.save(PLAN);
    expect(t.db.draft!.approvalStatus).toBe('APPROVED');

    await t.save({ ...PLAN, 'risk:plan': 'Changed after approval' });
    expect(t.db.draft).toMatchObject({
      approvalStatus: 'DRAFT',
      approvalContentHash: null,
    });
    expect(
      t.db.audits.find((a) => a.action === 'care_plan_approval_invalidated'),
    ).toMatchObject({
      oldValues: { status: 'APPROVED', approvedById: MANAGER },
      newValues: { status: 'DRAFT' },
    });
    await expect(t.publish()).rejects.toThrow('must be approved');
  });

  it('11b. content changed behind the approval (bypassing the editor) is caught at approve and at publish', async () => {
    const t = setup({ approvalRequired: true });
    await t.save(PLAN);
    await t.submit();
    t.db.draft!.valuesJson = { ...PLAN, 'risk:plan': 'tampered' };
    await expect(t.approve(MANAGER, t.hash())).rejects.toThrow(
      'changed since it was submitted',
    );

    const p = setup({ approvalRequired: true });
    await p.save(PLAN);
    await p.submit();
    await p.approve();
    p.db.draft!.valuesJson = { ...PLAN, 'risk:plan': 'tampered' };
    await expect(p.publish()).rejects.toThrow('changed after it was approved');
    expect(p.db.versions).toHaveLength(0);

    const stale = setup({ approvalRequired: true });
    await stale.save(PLAN);
    await stale.submit();
    await expect(stale.approve(MANAGER, 'f'.repeat(64))).rejects.toThrow(
      ConflictException,
    );
  });

  it('12. with enforcement off, publishing works exactly as before (no approval needed, none recorded)', async () => {
    const t = setup({ approvalRequired: false });
    await t.save(PLAN);
    const res = await t.publish(AUTHOR);
    expect(t.db.versions).toHaveLength(1);
    expect(t.db.versions[0].approvalJson).toBeUndefined();
    expect(res.data?.carePlanApprovalRequired).toBe(false);
    expect(res.data?.draft).toBeNull();
  });

  it('1 & 13. a published plan stays live (status, version) while its revision is pending and approved', async () => {
    const t = setup({ approvalRequired: true, published: true });
    await t.save({ summary: 'Revised plan v2' });
    await t.submit();

    const pending = await t.service.getInstance(SU, FORM);
    expect(pending.data).toMatchObject({
      status: 'PUBLISHED',
      displayStatus: 'PUBLISHED_WITH_DRAFT',
      latestPublishedVersion: { id: 'ver-1', versionNumber: 1 },
      draft: { approval: { status: 'PENDING_APPROVAL' } },
    });

    await t.approve();
    const approved = await t.service.getInstance(SU, FORM);
    expect(approved.data?.latestPublishedVersion?.versionNumber).toBe(1);
    expect(t.db.versions[0].supersededAt).toBeNull();

    await t.publish();
    expect(
      t.db.versions.map((v) => [v.versionNumber, v.supersededAt === null]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(t.db.versions[0].valuesJson).toEqual({
      summary: 'Published plan v1',
    }); // history unchanged
  });
});
