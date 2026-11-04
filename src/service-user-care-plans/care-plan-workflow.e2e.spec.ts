import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { AUTHOR, FORM, MANAGER, SU, setup } from './care-plan.test-harness';

jest.mock('./compose/compose-context.loader', () => ({
  ...jest.requireActual<object>('./compose/compose-context.loader'),
  loadCarePlanFormFields: jest.fn(() =>
    Promise.resolve({
      formName: 'Mobility',
      reviewFrequencyMonths: 6,
      fields: [
        {
          key: 'mob:frame',
          label: 'I use a walking frame',
          fieldType: 'YES_NO',
          sectionTitle: 'Mobility',
        },
      ],
    }),
  ),
}));

const SECOND_MANAGER = 'manager-2';

/**
 * One walk through the care plan side of IA → care plan → carer visit, on the shared in-memory
 * tables: approval, publication, carer notification, visit task reconciliation, a new version,
 * lifecycle and reassessment review. (IA decisions → draft are covered in
 * initial-assessment-care-plan-accept-draft.spec.ts; acknowledgement and carer access in
 * care-plan-carer-acknowledgement.spec.ts.)
 */
describe('Care plan workflow — end to end (in-memory)', () => {
  it('draft → approval → publish → notify → reconcile → new version → review flags → lifecycle', async () => {
    const t = setup({
      approvalRequired: true,
      assignments: [
        {
          id: 'a-frame',
          serviceUserId: SU,
          medicationRoundCode: 'MORNING',
          dueTime: null,
          isActive: true,
          deletedAt: null,
          task: { name: 'Walking frame check' },
        },
      ],
    });
    const notify = jest.fn(() =>
      Promise.resolve({ notified: ['emp-a'], alreadyNotified: [] }),
    );
    (
      t.service as unknown as { carerNotifications: unknown }
    ).carerNotifications = { notifyCurrentVersion: notify };
    const assignmentsBefore = structuredClone(t.db.assignments);

    // 6–8. Draft → submit → a different manager approves → publish.
    await t.save({ 'mob:frame': 'true' });
    t.db.draft!.valuesJson = { 'mob:frame': true };
    await t.submit(AUTHOR);
    await expect(t.approve(AUTHOR)).rejects.toThrow(ForbiddenException);
    await expect(t.publish()).rejects.toThrow('must be approved');
    expect(notify).not.toHaveBeenCalled();
    await t.approve(SECOND_MANAGER);
    await t.publish(SECOND_MANAGER);
    expect(
      t.db.versions.map((v) => [v.versionNumber, v.supersededAt === null]),
    ).toEqual([[1, true]]);
    const v1Values = structuredClone(t.db.versions[0].valuesJson);

    // 10. Carers on upcoming visits are notified of v1 (post-commit).
    expect(notify).toHaveBeenCalledTimes(1);

    // 13. Link an existing visit task; the task itself is unchanged.
    await t.reconciliation.link(MANAGER, SU, FORM, {
      visitTaskAssignmentId: 'a-frame',
      requirementKey: 'mob:frame',
    });
    expect(t.db.links).toHaveLength(1);

    // 9 & 12. A new version needs approval again; publishing it keeps v1 and flags the task link.
    await t.save({ 'mob:frame': 'true', extra: 'Pendant alarm' });
    t.db.draft!.valuesJson = { 'mob:frame': true, extra: 'Pendant alarm' };
    await expect(t.publish()).rejects.toThrow('must be approved');
    await t.submit(AUTHOR);
    await t.approve(SECOND_MANAGER);
    await t.publish(SECOND_MANAGER);
    expect(
      t.db.versions.map((v) => [v.versionNumber, v.supersededAt === null]),
    ).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(t.db.versions[0].valuesJson).toEqual(v1Values);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(t.db.links[0].status).toBe('REVIEW_REQUIRED');
    const rec = (await t.reconciliation.getReconciliation(SU, FORM)).data!;
    expect(rec.links[0]).toMatchObject({
      suggestedReuse: true,
      confirmedForVersionNumber: 1,
    });
    await t.reconciliation.markReviewed(MANAGER, SU, FORM, rec.links[0].id);
    expect(t.db.links[0]).toMatchObject({
      status: 'LINKED',
      carePlanPublishedVersionId: t.db.versions[1].id,
    });
    expect(t.db.assignments).toEqual(assignmentsBefore);

    // 14. A reassessment flag (written by the IA module) shows as review required on the plan.
    t.db.reassessmentFlags.push({
      id: 'flag-1',
      changeTypes: ['CHANGED_NEED'],
      reason:
        'Reassessment: the assessment answers behind this care plan have changed. Review Mobility.',
      triggeringSubmissionId: 'ia-2',
      createdAt: new Date(),
    });
    const withFlag = await t.service.getInstance(SU, FORM);
    expect(withFlag.data?.reassessmentReview).toMatchObject({
      required: true,
      flags: [{ id: 'flag-1' }],
    });
    // The published plan is untouched by the flag.
    expect(withFlag.data).toMatchObject({
      status: 'PUBLISHED',
      latestPublishedVersion: { versionNumber: 2 },
    });

    // 16. Suspend hides it from carers (lifecycle), keeps versions; resume needs confirmation.
    await t.service.suspend(MANAGER, SU, FORM, { reason: 'In hospital' });
    expect(t.db.instance.lifecycleStatus).toBe('SUSPENDED');
    expect(t.db.versions).toHaveLength(2);
    await t.service.resume(MANAGER, SU, FORM, {
      reason: 'Home again',
      reviewConfirmed: true,
    });
    expect(notify).toHaveBeenCalledTimes(3); // resumed: carers not yet told are notified (deduped per version)
  });
});
