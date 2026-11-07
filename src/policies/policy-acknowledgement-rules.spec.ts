import { PolicyAcknowledgementStatus, PolicyAudienceTargetType } from '@prisma/client';
import {
  acknowledgementClockStart,
  acknowledgementDueAt,
  buildEmployeeMatchContext,
  employeeInManagerScope,
  employmentBranchIds,
  identityRoleNameForRbacLevel,
  isAcknowledgementOverdue,
  resolveAcknowledgementState,
  summariseAcknowledgementStates,
  type AckRow,
  type AckVersionRow,
} from './policy-acknowledgement-rules';
import { policyIsVisible } from './policy-targeting';

const d = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

const version = (id: string, major: number, minor: number, publishedAt: string | null, required = true): AckVersionRow => ({
  id,
  versionMajor: major,
  versionMinor: minor,
  publishedAt: publishedAt ? d(publishedAt) : null,
  acknowledgementRequired: required,
});

const ack = (versionId: string, status: PolicyAcknowledgementStatus, at: string): AckRow => ({
  id: `ack-${versionId}`,
  versionId,
  status,
  viewedAt: d(at),
  acknowledgedAt: status === PolicyAcknowledgementStatus.ACKNOWLEDGED ? d(at) : null,
});

describe('policy acknowledgement rules', () => {
  describe('employee match context', () => {
    it('uses employment role, job title, work area and branches', () => {
      const ctx = buildEmployeeMatchContext({
        employment: {
          roleId: 'lookup-role',
          jobTitleId: 'jt-1',
          workAreaId: 'wa-1',
          locationId: 'loc-a',
          baseLocationId: 'loc-b',
          floorLocations: [{ locationId: 'loc-c' }, { locationId: 'loc-a' }],
        },
        identityRoleIds: ['role-carer'],
      });
      expect(ctx.roleIds.sort()).toEqual(['lookup-role', 'role-carer']);
      expect(ctx.jobTitleId).toBe('jt-1');
      expect(ctx.workAreaId).toBe('wa-1');
      expect(ctx.assignedLocationIds?.sort()).toEqual(['loc-a', 'loc-b', 'loc-c']);
      expect(ctx.serviceTypeCode).toBeNull();
      expect(ctx.locationId).toBeNull();
    });

    it('is unrestricted (null branches) when the employee has no branch', () => {
      const ctx = buildEmployeeMatchContext({
        employment: { roleId: null, jobTitleId: null, workAreaId: null, locationId: null, baseLocationId: null },
      });
      expect(ctx.assignedLocationIds).toBeNull();
      expect(ctx.roleIds).toEqual([]);
      expect(buildEmployeeMatchContext({ employment: null }).assignedLocationIds).toBeNull();
    });

    it('maps the employment RBAC level to an identity role name', () => {
      expect(identityRoleNameForRbacLevel('Carer/Domestic')).toBe('Carer/Domestic');
      expect(identityRoleNameForRbacLevel('Administrator')).toBe('Admin');
      expect(identityRoleNameForRbacLevel('  ')).toBeNull();
      expect(identityRoleNameForRbacLevel(null)).toBeNull();
    });

    it('drives audience and applicability through policyIsVisible', () => {
      const ctx = buildEmployeeMatchContext({
        employment: { roleId: null, jobTitleId: 'jt-carer', workAreaId: null, locationId: 'loc-a', baseLocationId: null },
        identityRoleIds: ['role-carer'],
      });
      const audience = (targetType: PolicyAudienceTargetType, ids: Partial<Record<'roleId' | 'jobTitleId', string>>) => ({
        targetType,
        roleId: ids.roleId ?? null,
        jobTitleId: ids.jobTitleId ?? null,
        workAreaId: null,
        locationId: null,
      });
      const orgWide = [{ organisationWide: true, locationId: null, serviceTypeCode: null }];

      expect(policyIsVisible({ applicability: orgWide, audience: [], ctx })).toBe(true);
      expect(
        policyIsVisible({ applicability: orgWide, audience: [audience(PolicyAudienceTargetType.ROLE, { roleId: 'role-carer' })], ctx }),
      ).toBe(true);
      expect(
        policyIsVisible({ applicability: orgWide, audience: [audience(PolicyAudienceTargetType.ROLE, { roleId: 'role-manager' })], ctx }),
      ).toBe(false);
      expect(
        policyIsVisible({
          applicability: orgWide,
          audience: [audience(PolicyAudienceTargetType.JOB_TITLE, { jobTitleId: 'jt-nurse' })],
          ctx,
        }),
      ).toBe(false);
      expect(
        policyIsVisible({ applicability: [{ organisationWide: false, locationId: 'loc-a', serviceTypeCode: null }], audience: [], ctx }),
      ).toBe(true);
      expect(
        policyIsVisible({ applicability: [{ organisationWide: false, locationId: 'loc-b', serviceTypeCode: null }], audience: [], ctx }),
      ).toBe(false);
      // Service-type-only applicability applies to staff (no service context required).
      expect(
        policyIsVisible({
          applicability: [{ organisationWide: false, locationId: null, serviceTypeCode: 'DOMICILIARY' }],
          audience: [],
          ctx,
          requireServiceContext: false,
        }),
      ).toBe(true);
    });

    it('derives branch ids the same way as the user branch scope', () => {
      expect(
        employmentBranchIds({
          roleId: null,
          jobTitleId: null,
          workAreaId: null,
          locationId: 'a',
          baseLocationId: 'a',
          floorLocations: [{ locationId: 'b' }],
        }),
      ).toEqual(['a', 'b']);
      expect(employmentBranchIds(null)).toEqual([]);
    });
  });

  describe('due date and overdue', () => {
    it('is 14 days after publication', () => {
      const v = version('v1', 1, 0, '2026-10-01');
      const due = acknowledgementDueAt(acknowledgementClockStart(v, [v]));
      expect(due?.toISOString()).toBe('2026-10-15T09:00:00.000Z');
    });

    it('does not restart the clock for a minor version', () => {
      const v10 = version('v10', 1, 0, '2026-10-01');
      const v11 = version('v11', 1, 1, '2026-10-20');
      expect(acknowledgementClockStart(v11, [v10, v11])?.toISOString()).toBe(d('2026-10-01').toISOString());
    });

    it('restarts the clock for a major version', () => {
      const v10 = version('v10', 1, 0, '2026-10-01');
      const v20 = version('v20', 2, 0, '2026-10-20');
      expect(acknowledgementClockStart(v20, [v10, v20])?.toISOString()).toBe(d('2026-10-20').toISOString());
    });

    it('starts the clock when acknowledgement was first required in the major line', () => {
      const v10 = version('v10', 1, 0, '2026-10-01', false);
      const v11 = version('v11', 1, 1, '2026-10-20', true);
      expect(acknowledgementClockStart(v11, [v10, v11])?.toISOString()).toBe(d('2026-10-20').toISOString());
    });

    it('gives staff who start later 14 days from their start', () => {
      const due = acknowledgementDueAt(d('2026-01-01'), d('2026-10-01'));
      expect(due?.toISOString()).toBe('2026-10-15T09:00:00.000Z');
      expect(acknowledgementDueAt(d('2026-10-01'), d('2025-01-01'))?.toISOString()).toBe('2026-10-15T09:00:00.000Z');
    });

    it('is overdue only after the due date and only while not acknowledged', () => {
      const due = d('2026-10-15');
      expect(isAcknowledgementOverdue(due, null, d('2026-10-15'))).toBe(false);
      expect(isAcknowledgementOverdue(due, null, d('2026-10-16'))).toBe(true);
      expect(isAcknowledgementOverdue(due, d('2026-10-20'), d('2026-10-21'))).toBe(false);
      expect(isAcknowledgementOverdue(null, null, d('2030-01-01'))).toBe(false);
    });
  });

  describe('status and minor-version carry-over', () => {
    const v10 = version('v10', 1, 0, '2026-09-01');
    const v11 = version('v11', 1, 1, '2026-10-01');
    const v20 = version('v20', 2, 0, '2026-10-01');

    it('is PENDING and overdue with no record after the due date', () => {
      const state = resolveAcknowledgementState({ current: v10, versions: [v10], acknowledgements: [], now: d('2026-10-01') });
      expect(state.status).toBe(PolicyAcknowledgementStatus.PENDING);
      expect(state.overdue).toBe(true);
      expect(state.dueAt?.toISOString()).toBe('2026-09-15T09:00:00.000Z');
    });

    it('is VIEWED when opened but not acknowledged', () => {
      const state = resolveAcknowledgementState({
        current: v10,
        versions: [v10],
        acknowledgements: [ack('v10', PolicyAcknowledgementStatus.VIEWED, '2026-09-02')],
        now: d('2026-09-03'),
      });
      expect(state.status).toBe(PolicyAcknowledgementStatus.VIEWED);
      expect(state.viewedAt?.toISOString()).toBe(d('2026-09-02').toISOString());
      expect(state.overdue).toBe(false);
    });

    it('carries an acknowledgement of an earlier published minor version forward', () => {
      const state = resolveAcknowledgementState({
        current: v11,
        versions: [v10, v11],
        acknowledgements: [ack('v10', PolicyAcknowledgementStatus.ACKNOWLEDGED, '2026-09-05')],
        now: d('2026-12-01'),
      });
      expect(state.status).toBe(PolicyAcknowledgementStatus.ACKNOWLEDGED);
      expect(state.acknowledgedVersionId).toBe('v10');
      expect(state.acknowledgedAt?.toISOString()).toBe(d('2026-09-05').toISOString());
      expect(state.overdue).toBe(false);
    });

    it('needs a new acknowledgement for a new major version', () => {
      const state = resolveAcknowledgementState({
        current: v20,
        versions: [v10, v11, v20],
        acknowledgements: [ack('v11', PolicyAcknowledgementStatus.ACKNOWLEDGED, '2026-10-02')],
        now: d('2026-10-30'),
      });
      expect(state.status).toBe(PolicyAcknowledgementStatus.PENDING);
      expect(state.overdue).toBe(true);
    });

    it('ignores acknowledgements of versions that were never published', () => {
      const unpublished = version('v12', 1, 2, null);
      const state = resolveAcknowledgementState({
        current: { ...v11, versionMinor: 3, id: 'v13' },
        versions: [v10, v11, unpublished],
        acknowledgements: [ack('v12', PolicyAcknowledgementStatus.ACKNOWLEDGED, '2026-10-02')],
        now: d('2026-09-10'),
      });
      expect(state.status).toBe(PolicyAcknowledgementStatus.PENDING);
    });

    it('does not count a VIEWED record on an earlier minor version as acknowledged', () => {
      const state = resolveAcknowledgementState({
        current: v11,
        versions: [v10, v11],
        acknowledgements: [ack('v10', PolicyAcknowledgementStatus.VIEWED, '2026-09-05')],
        now: d('2026-09-10'),
      });
      expect(state.status).toBe(PolicyAcknowledgementStatus.PENDING);
    });
  });

  it('summarises totals for the manager report', () => {
    const totals = summariseAcknowledgementStates([
      { status: PolicyAcknowledgementStatus.ACKNOWLEDGED, overdue: false },
      { status: PolicyAcknowledgementStatus.VIEWED, overdue: true },
      { status: PolicyAcknowledgementStatus.PENDING, overdue: true },
      { status: PolicyAcknowledgementStatus.PENDING, overdue: false },
    ]);
    expect(totals).toEqual({ required: 4, acknowledged: 1, viewedOnly: 1, notOpened: 2, overdue: 2 });
  });

  it('scopes employees to the manager branches', () => {
    expect(employeeInManagerScope(null, [])).toBe(true);
    expect(employeeInManagerScope(['a'], ['a', 'b'])).toBe(true);
    expect(employeeInManagerScope(['a'], ['b'])).toBe(false);
    expect(employeeInManagerScope(['a'], [])).toBe(false);
    expect(employeeInManagerScope([], ['a'])).toBe(false);
  });
});
