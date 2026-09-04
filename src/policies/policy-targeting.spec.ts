import {
  PolicyAudienceTargetType,
  PolicyLinkModuleType,
  PolicyLinkScope,
} from '@prisma/client';
import {
  applicabilityMatches,
  assertApplicabilityShape,
  assertAudienceShape,
  assertLinkScopeAllowed,
  assertLinkShape,
  audienceMatches,
  findDuplicatePolicyLink,
  locationAclAllows,
  policyIsVisible,
  policyLinkMatches,
} from './policy-targeting';

const london = 'loc-london';
const birmingham = 'loc-birmingham';
const carerRole = 'role-carer';
const seniorRole = 'role-senior';
const nurseRole = 'role-nurse';

describe('policy-targeting', () => {
  describe('applicability', () => {
    it('treats empty rows as organisation-wide', () => {
      expect(
        applicabilityMatches([], { assignedLocationIds: [london], roleIds: [], jobTitleId: null, workAreaId: null }),
      ).toBe(true);
    });

    it('matches organisation-wide for branch and unrestricted users', () => {
      const rows = [{ organisationWide: true, locationId: null, serviceTypeCode: null }];
      expect(
        applicabilityMatches(rows, { assignedLocationIds: null, roleIds: [], jobTitleId: null, workAreaId: null }),
      ).toBe(true);
      expect(
        applicabilityMatches(rows, { assignedLocationIds: [london], roleIds: [], jobTitleId: null, workAreaId: null }),
      ).toBe(true);
    });

    it('hides a location-specific policy from another branch', () => {
      const rows = [{ organisationWide: false, locationId: london, serviceTypeCode: null }];
      expect(
        applicabilityMatches(rows, { assignedLocationIds: [birmingham], roleIds: [], jobTitleId: null, workAreaId: null }),
      ).toBe(false);
      expect(
        applicabilityMatches(rows, { assignedLocationIds: [london], roleIds: [], jobTitleId: null, workAreaId: null }),
      ).toBe(true);
    });

    it('matches service-type-specific rows', () => {
      const rows = [{ organisationWide: false, locationId: null, serviceTypeCode: 'DOMICILIARY' }];
      expect(
        applicabilityMatches(rows, {
          assignedLocationIds: [london],
          roleIds: [],
          jobTitleId: null,
          workAreaId: null,
          serviceTypeCode: 'DOMICILIARY',
        }),
      ).toBe(true);
      expect(
        applicabilityMatches(rows, {
          assignedLocationIds: [london],
          roleIds: [],
          jobTitleId: null,
          workAreaId: null,
          serviceTypeCode: 'RESIDENTIAL',
        }),
      ).toBe(false);
    });

    it('requires both location and service type for combined rows', () => {
      const rows = [{ organisationWide: false, locationId: london, serviceTypeCode: 'DOMICILIARY' }];
      expect(
        applicabilityMatches(rows, {
          assignedLocationIds: [london],
          roleIds: [],
          jobTitleId: null,
          workAreaId: null,
          serviceTypeCode: 'DOMICILIARY',
        }),
      ).toBe(true);
      expect(
        applicabilityMatches(rows, {
          assignedLocationIds: [london],
          roleIds: [],
          jobTitleId: null,
          workAreaId: null,
          serviceTypeCode: 'RESIDENTIAL',
        }),
      ).toBe(false);
      expect(
        applicabilityMatches(rows, {
          assignedLocationIds: [birmingham],
          roleIds: [],
          jobTitleId: null,
          workAreaId: null,
          serviceTypeCode: 'DOMICILIARY',
        }),
      ).toBe(false);
    });

    it('rejects invalid applicability shapes', () => {
      expect(
        assertApplicabilityShape({ organisationWide: true, locationId: london, serviceTypeCode: null }),
      ).toBeTruthy();
      expect(
        assertApplicabilityShape({ organisationWide: false, locationId: null, serviceTypeCode: null }),
      ).toBeTruthy();
      expect(
        assertApplicabilityShape({ organisationWide: false, locationId: london, serviceTypeCode: null }),
      ).toBeNull();
    });
  });

  describe('audience', () => {
    const base = {
      assignedLocationIds: [london] as string[] | null,
      roleIds: [carerRole],
      jobTitleId: 'jt-carer',
      workAreaId: 'wa-dom',
    };

    it('matches empty audience (all employees)', () => {
      expect(audienceMatches([], base)).toBe(true);
    });

    it('ORs multiple roles', () => {
      const rows = [
        { targetType: PolicyAudienceTargetType.ROLE, roleId: carerRole, jobTitleId: null, workAreaId: null, locationId: null },
        { targetType: PolicyAudienceTargetType.ROLE, roleId: seniorRole, jobTitleId: null, workAreaId: null, locationId: null },
      ];
      expect(audienceMatches(rows, { ...base, roleIds: [carerRole] })).toBe(true);
      expect(audienceMatches(rows, { ...base, roleIds: [seniorRole] })).toBe(true);
      expect(audienceMatches(rows, { ...base, roleIds: [nurseRole] })).toBe(false);
    });

    it('ANDs role and location dimensions', () => {
      const rows = [
        { targetType: PolicyAudienceTargetType.ROLE, roleId: carerRole, jobTitleId: null, workAreaId: null, locationId: null },
        { targetType: PolicyAudienceTargetType.ROLE, roleId: seniorRole, jobTitleId: null, workAreaId: null, locationId: null },
        { targetType: PolicyAudienceTargetType.LOCATION, roleId: null, jobTitleId: null, workAreaId: null, locationId: london },
      ];
      expect(audienceMatches(rows, { ...base, roleIds: [carerRole], assignedLocationIds: [london] })).toBe(true);
      expect(audienceMatches(rows, { ...base, roleIds: [carerRole], assignedLocationIds: [birmingham] })).toBe(false);
    });

    it('matches job title and work area', () => {
      expect(
        audienceMatches(
          [{ targetType: PolicyAudienceTargetType.JOB_TITLE, roleId: null, jobTitleId: 'jt-carer', workAreaId: null, locationId: null }],
          base,
        ),
      ).toBe(true);
      expect(
        audienceMatches(
          [{ targetType: PolicyAudienceTargetType.JOB_TITLE, roleId: null, jobTitleId: 'jt-nurse', workAreaId: null, locationId: null }],
          base,
        ),
      ).toBe(false);
      expect(
        audienceMatches(
          [{ targetType: PolicyAudienceTargetType.WORK_AREA, roleId: null, jobTitleId: null, workAreaId: 'wa-dom', locationId: null }],
          base,
        ),
      ).toBe(true);
    });

    it('does not require CARE_WORKER AND SENIOR_CARE_WORKER', () => {
      const rows = [
        { targetType: PolicyAudienceTargetType.ROLE, roleId: carerRole, jobTitleId: null, workAreaId: null, locationId: null },
        { targetType: PolicyAudienceTargetType.ROLE, roleId: seniorRole, jobTitleId: null, workAreaId: null, locationId: null },
      ];
      expect(audienceMatches(rows, { ...base, roleIds: [carerRole] })).toBe(true);
    });
  });

  describe('links', () => {
    it('matches a module-level link', () => {
      const links = [
        { moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE, recordId: null, sectionKey: null },
      ];
      expect(policyLinkMatches(links, { moduleType: PolicyLinkModuleType.MEDICATION })).toBe(true);
      expect(policyLinkMatches(links, { moduleType: PolicyLinkModuleType.INCIDENT })).toBe(false);
    });

    it('ORs multiple independent links', () => {
      const links = [
        { moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE, recordId: null, sectionKey: null },
        {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          scope: PolicyLinkScope.FORM_TEMPLATE,
          recordId: 'form-diabetes',
          sectionKey: null,
        },
      ];
      expect(policyLinkMatches(links, { moduleType: PolicyLinkModuleType.MEDICATION })).toBe(true);
      expect(
        policyLinkMatches(links, {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          recordId: 'form-diabetes',
        }),
      ).toBe(true);
      expect(policyLinkMatches(links, { moduleType: PolicyLinkModuleType.INCIDENT })).toBe(false);
    });

    it('matches whole care-plan (FORM_TEMPLATE) and individual RECORD', () => {
      const formId = 'form-diabetes';
      const instanceId = 'cp-margaret';
      const links = [
        {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          scope: PolicyLinkScope.FORM_TEMPLATE,
          recordId: formId,
          sectionKey: null,
        },
      ];
      expect(
        policyLinkMatches(links, {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          recordId: formId,
        }),
      ).toBe(true);
      expect(
        policyLinkMatches(
          [
            {
              moduleType: PolicyLinkModuleType.CARE_PLAN,
              scope: PolicyLinkScope.RECORD,
              recordId: instanceId,
              sectionKey: null,
            },
          ],
          { moduleType: PolicyLinkModuleType.CARE_PLAN, recordId: instanceId },
        ),
      ).toBe(true);
    });

    it('matches FORM_TEMPLATE via resolved formTemplateId for an instance, not other forms', () => {
      const links = [
        {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          scope: PolicyLinkScope.FORM_TEMPLATE,
          recordId: 'form-diabetes',
          sectionKey: null,
        },
      ];
      expect(
        policyLinkMatches(links, {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          recordId: 'cp-margaret',
          formTemplateId: 'form-diabetes',
        }),
      ).toBe(true);
      expect(
        policyLinkMatches(links, {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          recordId: 'cp-other',
          formTemplateId: 'form-falls',
        }),
      ).toBe(false);
      expect(policyLinkMatches(links, { moduleType: PolicyLinkModuleType.CARE_PLAN })).toBe(false);
    });

    it('matches RECORD only for the exact record', () => {
      const links = [
        {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          scope: PolicyLinkScope.RECORD,
          recordId: 'cp-margaret',
          sectionKey: null,
        },
      ];
      expect(
        policyLinkMatches(links, { moduleType: PolicyLinkModuleType.CARE_PLAN, recordId: 'cp-margaret' }),
      ).toBe(true);
      expect(
        policyLinkMatches(links, { moduleType: PolicyLinkModuleType.CARE_PLAN, recordId: 'cp-other' }),
      ).toBe(false);
    });

    it('surfaces MODULE links inside a specific record context', () => {
      const links = [
        { moduleType: PolicyLinkModuleType.CARE_PLAN, scope: PolicyLinkScope.MODULE, recordId: null, sectionKey: null },
      ];
      expect(
        policyLinkMatches(links, {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          recordId: 'cp-1',
        }),
      ).toBe(true);
    });

    it('still matches MODULE links when the client sends an exclusive RECORD scope', () => {
      const links = [
        { moduleType: PolicyLinkModuleType.CARE_PLAN, scope: PolicyLinkScope.MODULE, recordId: null, sectionKey: null },
      ];
      expect(
        policyLinkMatches(links, {
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          scope: PolicyLinkScope.RECORD,
          recordId: 'cp-1',
        }),
      ).toBe(true);
    });

    it('matches SECTION links only when the section key matches', () => {
      const links = [
        {
          moduleType: PolicyLinkModuleType.INITIAL_ASSESSMENT,
          scope: PolicyLinkScope.SECTION,
          recordId: null,
          sectionKey: '12',
        },
      ];
      expect(policyLinkMatches(links, { moduleType: PolicyLinkModuleType.INITIAL_ASSESSMENT })).toBe(false);
      expect(
        policyLinkMatches(links, { moduleType: PolicyLinkModuleType.INITIAL_ASSESSMENT, sectionKey: '12' }),
      ).toBe(true);
      expect(
        policyLinkMatches(links, { moduleType: PolicyLinkModuleType.INITIAL_ASSESSMENT, sectionKey: '5' }),
      ).toBe(false);
    });

    it('rejects duplicate link identities', () => {
      const rows = [
        { moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE, recordId: null, sectionKey: null },
        { moduleType: PolicyLinkModuleType.MEDICATION, scope: PolicyLinkScope.MODULE, recordId: null, sectionKey: null },
      ];
      expect(findDuplicatePolicyLink(rows)).toEqual(rows[1]);
      expect(
        findDuplicatePolicyLink([
          rows[0]!,
          {
            moduleType: PolicyLinkModuleType.INCIDENT,
            scope: PolicyLinkScope.MODULE,
            recordId: null,
            sectionKey: null,
          },
        ]),
      ).toBeNull();
    });

    it('rejects unsupported module/scope combinations', () => {
      expect(
        assertLinkScopeAllowed({
          moduleType: PolicyLinkModuleType.INCIDENT,
          scope: PolicyLinkScope.FORM_TEMPLATE,
          recordId: 'x',
          sectionKey: null,
        }),
      ).toBeTruthy();
      expect(
        assertLinkScopeAllowed({
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          scope: PolicyLinkScope.FORM_TEMPLATE,
          recordId: 'form-diabetes',
          sectionKey: null,
        }),
      ).toBeNull();
    });
  });

  describe('combined visibility', () => {
    it('hides on audience mismatch even when applicability matches', () => {
      expect(
        policyIsVisible({
          applicability: [{ organisationWide: true, locationId: null, serviceTypeCode: null }],
          audience: [
            {
              targetType: PolicyAudienceTargetType.ROLE,
              roleId: nurseRole,
              jobTitleId: null,
              workAreaId: null,
              locationId: null,
            },
          ],
          ctx: { assignedLocationIds: [london], roleIds: [carerRole], jobTitleId: null, workAreaId: null },
        }),
      ).toBe(false);
    });
  });

  describe('branch ACL helper', () => {
    it('allows unrestricted users any location', () => {
      expect(locationAclAllows(null, birmingham)).toBe(true);
    });
  });

  describe('shapes', () => {
    it('requires recordId for RECORD links', () => {
      expect(
        assertLinkShape({
          moduleType: PolicyLinkModuleType.CARE_PLAN,
          scope: PolicyLinkScope.RECORD,
          recordId: null,
          sectionKey: null,
        }),
      ).toBeTruthy();
    });

    it('requires roleId for ROLE audience', () => {
      expect(
        assertAudienceShape({
          targetType: PolicyAudienceTargetType.ROLE,
          roleId: null,
          jobTitleId: null,
          workAreaId: null,
          locationId: null,
        }),
      ).toBeTruthy();
    });
  });
});
